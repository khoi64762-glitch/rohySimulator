/**
 * HeartRateAggregator — windows the per-sample rPPG estimates from
 * `HeartRateEstimator.estimate()`, mirroring the other aggregators' cadence
 * and ISO-string conventions.
 *
 * Each consumed frame is an estimate object ({bpm, snr, confidence, …}) or
 * null (buffer not yet full). Per window it emits bpm mean/std, the last valid
 * BPM, mean SNR/confidence, and how many frames produced a usable estimate.
 */

import { robustBpm } from './heartRateRobust.js';

const MODEL_VERSION = 'rppg-v1';

export class HeartRateAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 1000,
      // Anomaly-filter config for the robust mean (see heartRateRobust.js).
      robust: {},
      // Cross-window slew limit (bpm/sec). 0 disables → bpm_tracked === bpm_robust.
      maxSlewBpmPerS: 0,
      // Rolling robust median across the last N window values — anchors the
      // LEVEL (slew alone only bounds the rate, so a run of bad windows drags
      // the tracker). 1 disables the rolling anchor.
      trackerWindows: 1,
      // A window must contribute at least this many surviving estimates before
      // it can seed/feed the anchor. A 1-estimate window is not evidence, and
      // seeding the tracker from it poisons the anchor for many windows.
      minEstimatesForAnchor: 2,
      // Re-seed guard: if the sensor disagrees with the tracker by more than
      // resetBpm for resetWindows consecutive windows (same direction), the
      // TRACKER is wrong, not the sensor — jump to the recent median instead of
      // crawling. Catches a bad seed and a genuine large HR change alike.
      resetBpm: 10,
      resetWindows: 3,
      // Plausibility prior. 60-100 bpm is the clinical normal resting range, so
      // an ADOPTED value (seed or re-seed) inside it is believable immediately.
      // Outside it — bradycardic/tachycardic, or an artifact — we require
      // corroboration from this many consecutive agreeing windows before
      // committing. Real captures seeded at 50 bpm from one bad window and were
      // wrong for ~25 s; this makes that value earn its place first.
      plausibleMinBpm: 60,
      plausibleMaxBpm: 100,
      implausibleCorroboration: 3,
      ...options,
    };
    this.windowStart = null;
    this.frames = [];
    this._lastRobustBpm = null; // prior-HR reference across windows
    this._trackedBpm = null;    // slew-limited cross-window HR
    this._history = [];         // recent per-window robust values for the anchor
    this._diverge = [];         // consecutive same-side disagreements with the tracker
    this._seedCandidates = [];  // corroboration buffer for an implausible seed
  }

  consumeFrame(estimate, timestamp = Date.now()) {
    if (this.windowStart === null) this.windowStart = timestamp;
    const valid = estimate != null && Number.isFinite(estimate.bpm);
    this.frames.push({
      bpm: valid ? estimate.bpm : null,
      snr: valid && Number.isFinite(estimate.snr) ? estimate.snr : null,
      confidence: valid && Number.isFinite(estimate.confidence) ? estimate.confidence : null,
      window_seconds: valid && Number.isFinite(estimate.window_seconds) ? estimate.window_seconds : null,
      method: valid && typeof estimate.method === 'string' ? estimate.method : null,
      valid,
    });
    if (timestamp - this.windowStart >= this.options.windowMs) {
      return this.flush(timestamp);
    }
    return null;
  }

  flush(end = Date.now()) {
    if (this.frames.length === 0 && this.windowStart === null) return null;

    const frames = this.frames;
    const windowStart = this.windowStart;
    this.frames = [];
    this.windowStart = null;

    const totalFrames = frames.length;
    const durationMs = Math.max(0, end - (windowStart ?? end));
    const expectedSamples = Math.floor(durationMs / this.options.sampleIntervalMs) + 1;

    const validFrames = frames.filter((f) => f.valid);
    const bpms = validFrames.map((f) => f.bpm).filter(Number.isFinite);
    const snrs = validFrames.map((f) => f.snr).filter(Number.isFinite);
    const confs = validFrames.map((f) => f.confidence).filter(Number.isFinite);

    // Robust, anomaly-filtered central BPM (fold octaves → Hampel/MAD gate →
    // confidence-weighted mean). Weight each reading by its own confidence; the
    // previous window's robust BPM seeds the optional prior-HR gate.
    const robust = robustBpm(
      validFrames
        .filter((f) => Number.isFinite(f.bpm))
        .map((f) => ({ bpm: f.bpm, weight: Number.isFinite(f.confidence) ? f.confidence : 1 })),
      { ...this.options.robust, priorBpm: this._lastRobustBpm },
    );
    if (Number.isFinite(robust.bpm)) this._lastRobustBpm = robust.bpm;

    // Cross-window slew limit. A resting HR moves only a few bpm/sec, so a whole
    // window that coherently locked onto a wrong rate (no intra-window outlier
    // for the MAD gate to catch) shows up as a physiologically impossible jump.
    // Clamp the move; a genuine sustained change still converges over a few
    // windows, while a one-off flip barely shifts the tracked value.
    let trackedBpm = robust.bpm;
    let slewClamped = false;
    // An unsupported window (too few surviving estimates) must not SEED the
    // tracker either — a single reading is not evidence, and seeding from it
    // poisons the anchor for many windows afterwards.
    const plausible = (v) => v >= this.options.plausibleMinBpm && v <= this.options.plausibleMaxBpm;

    if (Number.isFinite(robust.bpm) && this._trackedBpm == null) {
      // SEEDING. Require support, and — for a value outside the plausible
      // resting band — corroboration from consecutive agreeing windows before
      // committing. An in-band value is believable straight away.
      if (robust.kept < this.options.minEstimatesForAnchor) {
        trackedBpm = null; // not evidence; keep settling
      } else if (plausible(robust.bpm)) {
        trackedBpm = robust.bpm;
        this._trackedBpm = trackedBpm;
        this._seedCandidates = [];
        this._history = [{ bpm: robust.bpm, weight: mean(confs) ?? 1 }];
      } else {
        const agrees = this._seedCandidates.length === 0
          || Math.abs(robust.bpm - this._seedCandidates[0]) <= this.options.resetBpm;
        if (!agrees) this._seedCandidates = [];
        this._seedCandidates.push(robust.bpm);
        if (this._seedCandidates.length >= this.options.implausibleCorroboration) {
          trackedBpm = median(this._seedCandidates);
          this._trackedBpm = trackedBpm;
          this._history = this._seedCandidates.map((b) => ({ bpm: b, weight: 1 }));
          this._seedCandidates = [];
        } else {
          trackedBpm = null; // implausible and not yet corroborated
        }
      }
    } else if (Number.isFinite(robust.bpm)) {
      // Level anchor: rolling robust median/MAD across the last N window values.
      // Slew alone only bounds the RATE, so a run of coherently-wrong windows
      // walks the tracker away from the true level one clamp at a time.
      const n = Math.max(1, Math.round(this.options.trackerWindows));
      // Only reasonably-supported windows may feed the anchor. A single-estimate
      // window is noise, and letting it seed the tracker corrupts the anchor's
      // own median for the next N windows.
      const supported = robust.kept >= this.options.minEstimatesForAnchor;
      if (supported) {
        this._history.push({ bpm: robust.bpm, weight: mean(confs) ?? 1 });
        if (this._history.length > n) this._history.shift();
      }

      // Re-seed guard: track consecutive same-side disagreements between what
      // the sensor reports and what we believe. Sustained disagreement means the
      // TRACKER is stale (bad seed, or a real HR change) — jump, don't crawl.
      if (supported && Number.isFinite(this._trackedBpm)) {
        const diff = robust.bpm - this._trackedBpm;
        if (Math.abs(diff) > this.options.resetBpm) {
          const sameSide = this._diverge.length === 0
            || Math.sign(diff) === Math.sign(this._diverge[0].diff);
          if (!sameSide) this._diverge = [];
          this._diverge.push({ bpm: robust.bpm, diff });
        } else {
          this._diverge = [];
        }
      }

      // Re-seeding obeys the same plausibility prior: adopting an out-of-band
      // rate takes more corroboration than an in-band one.
      const candidate = this._diverge.length > 0 ? median(this._diverge.map((d) => d.bpm)) : null;
      const needed = candidate != null && !plausible(candidate)
        ? this.options.resetWindows + this.options.implausibleCorroboration - 1
        : this.options.resetWindows;
      const reseeding = this._diverge.length >= needed;
      if (reseeding) {
        // The sensor has been consistently elsewhere — adopt it outright,
        // bypassing both anchor and slew (they are what held us back).
        trackedBpm = median(this._diverge.map((d) => d.bpm));
        this._history = this._diverge.map((d) => ({ bpm: d.bpm, weight: 1 }));
        this._diverge = [];
      } else {
        if (n > 1 && this._history.length > 1) {
          const anchored = robustBpm(this._history, { ...this.options.robust });
          if (Number.isFinite(anchored.bpm)) trackedBpm = anchored.bpm;
        }
        const slew = this.options.maxSlewBpmPerS;
        if (slew > 0 && Number.isFinite(this._trackedBpm)) {
          const maxMove = slew * Math.max(0.001, durationMs / 1000);
          const delta = trackedBpm - this._trackedBpm; // from the anchored candidate
          if (Math.abs(delta) > maxMove) {
            trackedBpm = this._trackedBpm + Math.sign(delta) * maxMove;
            slewClamped = true;
          }
        }
      }
      this._trackedBpm = trackedBpm;
    } else {
      trackedBpm = null; // no reading this window; hold the tracker for the next
    }

    const last = validFrames.length > 0 ? validFrames[validFrames.length - 1] : null;
    const method = last ? last.method : null;
    // The integration window each BPM reflects — distinct from the emotion
    // window duration. Makes the "this number is not instantaneous" contract
    // explicit in the payload.
    const analysisWindowSeconds = last && Number.isFinite(last.window_seconds) ? last.window_seconds : null;
    // Distinct BPM samples actually observed this window (throttled to ~1 Hz),
    // i.e. how many independent estimates the mean averages.
    let distinct = 0;
    let prev = null;
    for (const f of validFrames) {
      if (f.bpm !== prev) { distinct += 1; prev = f.bpm; }
    }

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      total_frames: totalFrames,
      valid_frames: validFrames.length,
      valid_frame_ratio: totalFrames > 0 ? validFrames.length / totalFrames : 0,
      bpm_mean: mean(bpms),
      bpm_median: median(bpms),
      // Robust anomaly-filtered central BPM (within this window).
      bpm_robust: robust.bpm,
      // Cross-window slew-limited HR — the stable number to display/trust.
      bpm_tracked: trackedBpm,
      slew_clamped: slewClamped,
      bpm_std: std(bpms),
      bpm_last: bpms.length > 0 ? bpms[bpms.length - 1] : null,
      anomaly: {
        folded: robust.folded,
        dropped: robust.dropped,
        kept: robust.kept,
        total: robust.total,
        corrected_fraction: Number(robust.corrected_fraction.toFixed(3)),
      },
      snr_mean: mean(snrs),
      confidence_mean: mean(confs),
      analysis_window_seconds: analysisWindowSeconds,
      distinct_estimates: distinct,
      method,
      model_version: MODEL_VERSION,
    };
  }
}

function mean(a) {
  if (a.length === 0) return null;
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function median(a) {
  if (a.length === 0) return null;
  const s = a.slice().sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function std(a) {
  if (a.length < 2) return a.length === 1 ? 0 : null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}
