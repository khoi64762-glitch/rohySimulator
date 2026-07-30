/**
 * RespirationAggregator — windows the per-sample breathing-rate estimates.
 *
 * Deliberately simpler than HeartRateAggregator: the estimator already
 * integrates over ~45 s and recomputes only every ~5 s, so within a 10 s
 * window there are at most a couple of genuinely independent values. The
 * elaborate cross-window tracker that heart rate needs would be filtering
 * noise that the long analysis window has already removed.
 */

const MODEL_VERSION = 'respiration-v2';

export class RespirationAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 1000,
      // Floor on the per-estimate weight. A low-confidence reading is still
      // evidence — zeroing it would make the mean discontinuous as readings
      // cross the threshold, which is exactly the hard-clustering behaviour
      // soft weighting exists to avoid.
      minWeight: 0.1,
      ...options,
    };
    this.windowStart = null;
    this.frames = [];
  }

  consumeFrame(estimate, timestamp = Date.now()) {
    if (this.windowStart === null) this.windowStart = timestamp;
    const valid = estimate != null && Number.isFinite(estimate.brpm);
    this.frames.push(valid ? estimate : null);
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

    const valid = frames.filter((f) => f != null);
    const brpms = valid.map((f) => f.brpm).filter(Number.isFinite);
    const confs = valid.map((f) => f.confidence).filter(Number.isFinite);
    const snrs = valid.map((f) => f.snr).filter(Number.isFinite);

    // The estimator repeats its throttled answer between recomputes, so the
    // count that matters is how many DISTINCT estimates the window saw.
    let distinct = 0;
    let prev = null;
    for (const b of brpms) {
      if (b !== prev) { distinct += 1; prev = b; }
    }

    const last = valid.length > 0 ? valid[valid.length - 1] : null;
    const rgbAvailable = valid.filter(f => f.rgb_corroboration?.available === true);
    const rgbAgreed = rgbAvailable.filter(f => f.rgb_corroboration?.agrees === true);

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: Math.max(0, end - (windowStart ?? end)),
      total_frames: frames.length,
      valid_frames: valid.length,
      valid_frame_ratio: frames.length > 0 ? valid.length / frames.length : 0,
      // CONFIDENCE-WEIGHTED, not a plain average. A window mixes readings taken
      // under different conditions — the subject moved, the light dipped — and
      // an unweighted mean lets a barely-trusted estimate pull the result as
      // hard as a clean one. Weighting by each estimate's own confidence is
      // soft membership: nothing is discarded outright (which would throw away
      // information and make the mean jump as readings cross a threshold), but
      // poor readings contribute in proportion to how much they are believed.
      // Matches what heart rate already does via robustBpm's weighted mean.
      brpm_mean: weightedMean(
        valid.map((f) => f.brpm),
        valid.map((f) => f.confidence),
        this.options.minWeight,
      ),
      // The unweighted mean is kept alongside so the effect of weighting is
      // auditable rather than hidden — per the project data policy.
      brpm_mean_unweighted: mean(brpms),
      /** Sum of weights ÷ count: 1.0 = every estimate fully trusted. */
      mean_weight: mean(valid.map((f) => clampWeight(f.confidence, this.options.minWeight))),
      brpm_median: median(brpms),
      brpm_last: brpms.length > 0 ? brpms[brpms.length - 1] : null,
      brpm_std: std(brpms),
      confidence_mean: mean(confs),
      snr_mean: mean(snrs),
      // The integration window each reading reflects — makes the "this is not
      // instantaneous" contract explicit in the payload, as heart rate does.
      analysis_window_seconds: last && Number.isFinite(last.window_seconds) ? last.window_seconds : null,
      distinct_estimates: distinct,
      method: last ? last.method : null,
      sample_rate_hz: finiteOrNull(last?.sampling_quality?.sample_rate_hz),
      median_sample_interval_ms: finiteOrNull(last?.sampling_quality?.median_sample_interval_ms),
      max_sample_gap_ms: finiteOrNull(last?.sampling_quality?.max_sample_gap_ms),
      sampling_adequate: last?.sampling_quality?.adequate === true,
      rgb_corroboration_available_ratio: valid.length > 0 ? rgbAvailable.length / valid.length : null,
      rgb_corroboration_agreement_ratio: rgbAvailable.length > 0 ? rgbAgreed.length / rgbAvailable.length : null,
      rgb_corroboration_required: last?.rgb_corroboration?.required === true,
      model_version: MODEL_VERSION,
    };
  }
}

/** Confidence-weighted mean; falls back to the plain mean if no usable weights. */
function weightedMean(values, weights, minWeight = 0.1) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    const w = clampWeight(weights[i], minWeight);
    num += v * w;
    den += w;
  }
  if (den <= 0) return mean(values.filter(Number.isFinite));
  return num / den;
}

/** Confidence -> weight in [minWeight, 1]. Module-level default mirrors the
 *  aggregator option; kept simple because the floor is not per-instance data. */
function clampWeight(confidence, minWeight = 0.1) {
  const c = Number.isFinite(confidence) ? confidence : 0;
  return Math.max(minWeight, Math.min(1, c));
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

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
