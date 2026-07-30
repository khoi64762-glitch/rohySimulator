/*
 * voiceChartMath — pure derivation/geometry functions behind the voice
 * charts on /analyze/voice: VoiceSpeechStrip and VoicePitchContour (per-turn
 * time series), VoicePitchDistribution and VoiceLoudnessEnvelope (per-turn
 * distribution/dynamics), VoiceTurnComposition (per-turn structure) and
 * VoiceTurnTrends (ACROSS turns — the session trajectory).
 *
 * Plain JS with a hand-written .d.ts sibling (same pattern as
 * typingChartMath.js / timelineSlots.js) so the repo's framework-less node
 * test chain (tests/app-voice-charts.test.js) can exercise every function
 * directly — these derivations are real analysis logic, not presentation,
 * and must be testable without React or a DOM.
 *
 * Input shape: the compact per-frame sample the voice test hook records
 * alongside each `voice-v1` window (`frame_series` on the stored row —
 * an app-level additive field, NOT part of the library's voice-v1 profile):
 *
 *   { t, rms, p, f0, conf, voiced, clipped, playback, muted }
 *
 *   t        monotonic ms of the frame (the controller's clock)
 *   rms      per-frame RMS in [0, ~1]
 *   p        VAD speech probability, or null when no VAD ran on the frame
 *   f0       estimated F0 in Hz, or null on an unvoiced frame (never 0)
 *   conf     NSDF pitch confidence in [0, 1]
 *   voiced   whether the pitch estimator called the frame voiced
 *   clipped  whether any sample in the frame clipped
 *   playback whether the frame fell inside a host AI-playback interval
 *   muted    whether the track was muted during the frame
 *
 * Honesty rules these functions enforce (mirroring typingChartMath.js and
 * the VoiceTurnAggregator's own conventions):
 *
 *  - NOTHING is interpolated or invented. Pitch points exist only for
 *    observed voiced frames; unvoiced frames are GAPS — `pitchSegments`
 *    breaks the polyline at every unvoiced frame so no line ever bridges
 *    audio where pitch was not measured.
 *
 *  - Statistics mirror the aggregator EXACTLY. `keptPitchPoints` applies
 *    the same two gates the aggregator applies (voiced + finite f0, then
 *    confidence >= minConfidence, excluding playback/muted frames), and
 *    `pitchTrend`'s median (R type-7 quantile) and OLS slope (Hz per
 *    SECOND) reproduce `pitch_median_hz` / `pitch_slope_hz_per_s` —
 *    asserted against the real VoiceTurnAggregator in
 *    tests/app-voice-charts.test.js.
 *
 *  - The speech strip's time axis is FRAME time (index × frameMs) — the
 *    same deterministic accounting the aggregator uses for every duration
 *    it reports, so the strip's segment widths sum exactly to the window's
 *    speech/silence durations. Wall-clock gaps from dropped frames are
 *    therefore not represented; the strip states frame-time coverage
 *    rather than silently stretching segments.
 *
 *  - Playback caveat: the aggregator's internal-pause accounting runs on a
 *    structural timeline that EXCLUDES playback frames, so a silence run
 *    interrupted by playback merges into one structural run there. The
 *    strip draws the literal per-frame runs instead (playback shown as its
 *    own labelled band), so on playback-interleaved turns the strip's
 *    'pause' labels can differ from `internal_pause_count`. On turns
 *    without playback (every modal-recorded turn) the two agree exactly —
 *    asserted in tests.
 */

// ── Speech strip segmentation ───────────────────────────────────────────────

/**
 * Classify every frame and merge consecutive same-kind frames into runs.
 * Kind precedence per frame: playback > muted > speech/silence (by
 * `p >= vadThreshold`; a null probability is NOT speech — no VAD, no claim).
 * Internal silence runs (speech somewhere before AND after) at/above
 * `pauseThresholdMs` are relabelled 'pause' — the same threshold the
 * aggregator uses for `internal_pause_count`.
 *
 * @param {Array<object>} frames  per-frame samples (see file header)
 * @param {{frameMs?: number, vadThreshold?: number, pauseThresholdMs?: number}} [options]
 * @returns {{segments: Array<{kind: 'speech'|'silence'|'pause'|'playback'|'muted', startMs: number, endMs: number}>, totalMs: number}}
 *   segment bounds in frame time (index × frameMs); empty input → no segments.
 */
export function speechStripSegments(frames, { frameMs = 32, vadThreshold = 0.5, pauseThresholdMs = 500 } = {}) {
  const usable = Array.isArray(frames) ? frames : [];
  if (usable.length === 0) return { segments: [], totalMs: 0 };

  const kindOf = (frame) => {
    if (frame.playback === true) return 'playback';
    if (frame.muted === true) return 'muted';
    const speechLike = Number.isFinite(frame.p) && frame.p >= vadThreshold;
    return speechLike ? 'speech' : 'silence';
  };

  const segments = [];
  usable.forEach((frame, index) => {
    const kind = kindOf(frame);
    const startMs = index * frameMs;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
      last.endMs = startMs + frameMs;
    } else {
      segments.push({ kind, startMs, endMs: startMs + frameMs });
    }
  });

  // Relabel internal silence runs that meet the pause threshold. "Internal"
  // means a speech run exists somewhere earlier AND somewhere later — initial
  // and trailing silence are structural, never pauses (aggregator rule).
  const speechIndices = segments
    .map((segment, index) => (segment.kind === 'speech' ? index : -1))
    .filter((index) => index >= 0);
  if (speechIndices.length > 0) {
    const first = speechIndices[0];
    const last = speechIndices[speechIndices.length - 1];
    for (let i = first + 1; i < last; i += 1) {
      const segment = segments[i];
      if (segment.kind === 'silence' && segment.endMs - segment.startMs >= pauseThresholdMs) {
        segment.kind = 'pause';
      }
    }
  }

  return { segments, totalMs: usable.length * frameMs };
}

/**
 * Runs of consecutive clipped frames, in frame time — drawn as damage marks
 * on the strip. Clipping destroys loudness and spectral measurement, so a
 * clipped stretch must be visible, not averaged away.
 *
 * @param {Array<object>} frames
 * @param {{frameMs?: number}} [options]
 * @returns {Array<{startMs: number, endMs: number}>}
 */
export function clippedRuns(frames, { frameMs = 32 } = {}) {
  const usable = Array.isArray(frames) ? frames : [];
  const runs = [];
  usable.forEach((frame, index) => {
    if (frame.clipped !== true) return;
    const startMs = index * frameMs;
    const last = runs[runs.length - 1];
    if (last && last.endMs === startMs) {
      last.endMs = startMs + frameMs;
    } else {
      runs.push({ startMs, endMs: startMs + frameMs });
    }
  });
  return runs;
}

// ── Pitch contour ───────────────────────────────────────────────────────────

/**
 * Contiguous voiced stretches as polyline segments: one point per voiced
 * frame with a finite f0, a NEW segment whenever an unvoiced frame
 * intervenes or consecutive voiced frames are further apart than
 * `maxJoinGapMs` (a dropped-frame gap must not be bridged). Single-point
 * segments are legitimate — one voiced frame between unvoiced neighbours
 * renders as an isolated dot, never a line to anywhere.
 *
 * Playback/muted frames are INCLUDED as points when voiced (the pitch was
 * measured; the chart shades the interval as excluded) — but they still
 * break/continue segments by their own voicing like any other frame.
 *
 * @param {Array<object>} frames
 * @param {{maxJoinGapMs?: number}} [options]
 * @returns {Array<Array<{t: number, f0: number, confidence: number, playback: boolean, muted: boolean}>>}
 */
export function pitchSegments(frames, { maxJoinGapMs = 100 } = {}) {
  const usable = Array.isArray(frames) ? frames : [];
  const segments = [];
  let current = null;
  for (const frame of usable) {
    const voiced = frame.voiced === true && Number.isFinite(frame.f0);
    if (!voiced) {
      current = null; // unvoiced frame = gap; never interpolate across it
      continue;
    }
    const point = {
      t: frame.t,
      f0: frame.f0,
      confidence: Number.isFinite(frame.conf) ? frame.conf : 0,
      playback: frame.playback === true,
      muted: frame.muted === true,
    };
    if (current && point.t - current[current.length - 1].t <= maxJoinGapMs) {
      current.push(point);
    } else {
      current = [point];
      segments.push(current);
    }
  }
  return segments;
}

/**
 * The pitch points the AGGREGATOR keeps for its statistics: voiced frames
 * with a finite f0 whose confidence reaches `minConfidence`, excluding
 * playback and muted frames (the aggregator never lets those into pitch).
 * These are the points `pitchTrend` must run on to reproduce the window's
 * `pitch_median_hz` / `pitch_slope_hz_per_s`.
 *
 * @param {Array<object>} frames
 * @param {{minConfidence?: number}} [options]  default 0.6 = the aggregator's
 *   `minPitchConfidence` default
 * @returns {Array<{t: number, f0: number, confidence: number}>}
 */
export function keptPitchPoints(frames, { minConfidence = 0.6 } = {}) {
  const usable = Array.isArray(frames) ? frames : [];
  return usable
    .filter((frame) => frame.playback !== true
      && frame.muted !== true
      && frame.voiced === true
      && Number.isFinite(frame.f0)
      && Number.isFinite(frame.conf)
      && frame.conf >= minConfidence)
    .map((frame) => ({ t: frame.t, f0: frame.f0, confidence: frame.conf }));
}

/**
 * Median + OLS trend over kept pitch points — the chart-side mirror of the
 * aggregator's `pitch_median_hz` and `pitch_slope_hz_per_s` so the overlay
 * lines are drawn from exactly the statistics the window reports.
 *
 *  - median: R type-7 linear-interpolation quantile of the sorted f0s
 *    (same `quantileSorted` the aggregator uses).
 *  - slope: OLS of f0 (Hz) against time (SECONDS), 0 for a degenerate time
 *    axis — identical math to the aggregator's `olsSlopePerSecond`. `null`
 *    with fewer than 2 points (a single observation has no trend).
 *  - meanT/meanF0: the fit's centroid — the anchor the trend line passes
 *    through (an OLS line always passes through the mean point).
 *
 * @param {Array<{t: number, f0: number}>} points  from `keptPitchPoints`
 * @returns {{n: number, median: number, slope: number|null, meanT: number, meanF0: number} | null}
 *   `null` for an empty input — no points, no statistics.
 */
export function pitchTrend(points) {
  const usable = Array.isArray(points) ? points : [];
  const n = usable.length;
  if (n === 0) return null;

  const f0s = usable.map((point) => point.f0).sort((a, b) => a - b);
  const median = quantileSorted(f0s, 0.5);

  let sumT = 0;
  let sumF0 = 0;
  for (const point of usable) {
    sumT += point.t;
    sumF0 += point.f0;
  }
  const meanT = sumT / n;
  const meanF0 = sumF0 / n;

  if (n < 2) return { n, median, slope: null, meanT, meanF0 };

  // Same computation as the aggregator: seconds since the first sample.
  const t0 = usable[0].t;
  let covXY = 0;
  let varX = 0;
  const meanX = (meanT - t0) / 1000;
  for (const point of usable) {
    const dx = (point.t - t0) / 1000 - meanX;
    covXY += dx * (point.f0 - meanF0);
    varX += dx * dx;
  }
  const slope = varX > 0 ? covXY / varX : 0;
  return { n, median, slope, meanT, meanF0 };
}

/**
 * Linear-interpolation quantile (R type-7) of an ASCENDING-sorted array —
 * verbatim mirror of the aggregator's `quantileSorted` so the chart's
 * median agrees with `pitch_median_hz` to the bit.
 *
 * @param {number[]} sorted  ascending, length >= 1
 * @param {number} p  in [0, 1]
 * @returns {number}
 */
export function quantileSorted(sorted, p) {
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const t = position - lower;
  return sorted[lower] * (1 - t) + sorted[upper] * t;
}

// ── Pitch distribution ──────────────────────────────────────────────────────

/**
 * Histogram + quartiles of the KEPT pitch points — the distributional view
 * behind `pitch_median_hz` / `pitch_iqr_hz`. A median and an IQR describe a
 * shape that the two numbers cannot: bimodality (two registers), a long
 * high tail (strain / raised pitch on questions), or a tight spike
 * (monotone).
 *
 * Quartiles use the SAME `quantileSorted` the aggregator uses, so `q3 - q1`
 * reproduces `pitch_iqr_hz` exactly — the drawn IQR band IS the reported
 * statistic, not a lookalike.
 *
 * Bin width is chosen from the data (Freedman–Diaconis, floored at
 * `minBinHz`) rather than fixed, because F0 spread differs by an order of
 * magnitude between a monotone turn and an animated one; a fixed width
 * would render one of them as a single bar.
 *
 * @param {Array<{f0: number}>} points  from `keptPitchPoints`
 * @param {{minBinHz?: number, maxBins?: number}} [options]
 * @returns {{bins: Array<{lo: number, hi: number, count: number}>, binHz: number,
 *   n: number, min: number, max: number, q1: number, median: number, q3: number} | null}
 *   `null` for empty input — no points, no distribution.
 */
export function pitchHistogram(points, { minBinHz = 2, maxBins = 40 } = {}) {
  const usable = (Array.isArray(points) ? points : []).filter((point) => Number.isFinite(point.f0));
  const n = usable.length;
  if (n === 0) return null;

  const sorted = usable.map((point) => point.f0).sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[n - 1];
  const q1 = quantileSorted(sorted, 0.25);
  const median = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);

  // Freedman–Diaconis: bin width 2·IQR·n^(-1/3). Degenerate (zero IQR, or a
  // single distinct value) falls back to the floor — a spike stays a spike.
  const fd = 2 * (q3 - q1) * Math.pow(n, -1 / 3);
  let binHz = Math.max(minBinHz, Number.isFinite(fd) && fd > 0 ? fd : minBinHz);
  const span = Math.max(max - min, binHz);
  if (span / binHz > maxBins) binHz = span / maxBins;

  const lo = Math.floor(min / binHz) * binHz;
  const binCount = Math.max(1, Math.ceil((max - lo) / binHz) || 1);
  const bins = Array.from({ length: binCount }, (_, index) => ({
    lo: lo + index * binHz,
    hi: lo + (index + 1) * binHz,
    count: 0,
  }));
  for (const f0 of sorted) {
    const index = Math.min(binCount - 1, Math.floor((f0 - lo) / binHz));
    bins[index].count += 1;
  }

  return { bins, binHz, n, min, max, q1, median, q3 };
}

// ── Loudness envelope ───────────────────────────────────────────────────────

/**
 * Per-frame loudness over turn time, with the aggregator's OWN scoping made
 * visible: `rms_mean` is speech-scoped (silence frames would drag it toward
 * the noise floor), so the envelope marks which frames actually entered the
 * mean and draws the rest as context.
 *
 * `speechMean` reproduces the window's `rms_mean` — same three gates the
 * aggregator applies in `recordFrame`: not playback, not muted, VAD-speech,
 * and a FINITE rms (a missing rms is an absent measurement, never a 0 that
 * drags the mean down). `peak` is the max rms among those same frames.
 *
 * Note this is the mean of per-frame RMS, not the aggregator's
 * `peak_to_average_ratio`, whose numerator is the per-frame PEAK SAMPLE —
 * a quantity the compact frame series does not carry. The envelope
 * therefore draws mean and rms-peak only, and never claims to redraw
 * peak-to-average.
 *
 * @param {Array<object>} frames
 * @param {{vadThreshold?: number, nearSilenceRms?: number}} [options]
 * @returns {{points: Array<{t: number, rms: number, speech: boolean, excluded: boolean, clipped: boolean}>,
 *   speechMean: number|null, peak: number|null, nearSilenceRms: number,
 *   speechFrames: number, measuredFrames: number}}
 */
export function loudnessEnvelope(frames, { vadThreshold = 0.5, nearSilenceRms = 0.01 } = {}) {
  const usable = Array.isArray(frames) ? frames : [];
  const points = [];
  let sum = 0;
  let speechFrames = 0;
  let peak = null;

  for (const frame of usable) {
    if (!Number.isFinite(frame.rms)) continue; // absent measurement — not a 0
    const excluded = frame.playback === true || frame.muted === true;
    const speech = !excluded && Number.isFinite(frame.p) && frame.p >= vadThreshold;
    points.push({
      t: frame.t,
      rms: frame.rms,
      speech,
      excluded,
      clipped: frame.clipped === true,
    });
    if (speech) {
      sum += frame.rms;
      speechFrames += 1;
      if (peak === null || frame.rms > peak) peak = frame.rms;
    }
  }

  return {
    points,
    speechMean: speechFrames > 0 ? sum / speechFrames : null,
    peak,
    nearSilenceRms,
    speechFrames,
    measuredFrames: points.length,
  };
}

// ── Turn time composition ───────────────────────────────────────────────────

/**
 * Decompose a turn's wall-clock duration into the structural parts the
 * aggregator reports, as a proportion bar. Turns four separate numbers
 * (initial silence / speech / pause total / trailing silence) into ONE
 * legible shape: a turn that is mostly leading silence and a turn that is
 * mostly mid-turn hesitation have very different meanings and identical
 * `speech_ratio`s.
 *
 * The residual is REPORTED, never hidden. The parts are measured on the
 * aggregator's frame-time accounting while `turn_duration_ms` is wall-clock,
 * so they need not sum to the whole (dropped frames, a turn stopped between
 * frames). A silently-normalised bar would claim exact accounting the data
 * does not support; instead the leftover appears as an explicit
 * `unaccounted` part, and a NEGATIVE leftover (parts exceeding the
 * wall clock, possible when frame time overruns) is clamped to 0 and
 * surfaced through `overrunMs`.
 *
 * @param {object} voice  a `voice-v1` metrics block
 * @returns {{parts: Array<{key: string, label: string, ms: number}>, totalMs: number,
 *   accountedMs: number, unaccountedMs: number, overrunMs: number} | null}
 *   `null` when the turn has no positive duration — nothing to compose.
 */
export function turnTimeComposition(voice) {
  if (!voice || !Number.isFinite(voice.turn_duration_ms) || voice.turn_duration_ms <= 0) return null;
  const totalMs = voice.turn_duration_ms;
  const ms = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

  // Speech time minus nothing: internal pauses are silence, already outside
  // speech_duration_ms. Playback and muted are separate exclusions the
  // aggregator tracks in their own fields.
  const parts = [
    { key: 'initial_silence', label: 'Initial silence', ms: ms(voice.initial_silence_ms) },
    { key: 'speech', label: 'Speech', ms: ms(voice.speech_duration_ms) },
    { key: 'pause', label: 'Internal pauses', ms: ms(voice.internal_pause_total_ms) },
    { key: 'trailing_silence', label: 'Trailing silence', ms: ms(voice.trailing_silence_ms) },
    { key: 'playback', label: 'AI playback', ms: ms(voice.excluded_playback_ms) },
    { key: 'muted', label: 'Muted', ms: ms(voice.muted_ms) },
  ].filter((part) => part.ms > 0);

  const accountedMs = parts.reduce((sum, part) => sum + part.ms, 0);
  return {
    parts,
    totalMs,
    accountedMs,
    unaccountedMs: Math.max(0, totalMs - accountedMs),
    overrunMs: Math.max(0, accountedMs - totalMs),
  };
}

// ── Across-turn trends ──────────────────────────────────────────────────────

/**
 * Pull one metric across every turn, in order, PRESERVING nulls as gaps.
 * The cross-turn view is the one thing per-turn charts cannot show: whether
 * a speaker got quieter, faster or more hesitant over a session.
 *
 * A turn whose metric was not measured (pitch below the voiced-frame floor,
 * a ratio with a zero denominator) yields `value: null` and is NOT dropped —
 * dropping it would silently close the gap and draw a continuous trend
 * through turns where nothing was measured. `measured` counts the ones that
 * carry a value, so a caller can state "3 of 9 turns" rather than implying
 * the series is complete.
 *
 * @param {Array<object>} turns  stored voice windows (each with a `voice` block)
 * @param {(voice: object, turn: object) => number|null} pick  metric accessor
 * @returns {{points: Array<{index: number, value: number|null, flagged: boolean}>,
 *   n: number, measured: number, min: number|null, max: number|null}}
 */
export function turnMetricSeries(turns, pick) {
  const usable = Array.isArray(turns) ? turns : [];
  const points = [];
  let min = null;
  let max = null;
  let measured = 0;

  usable.forEach((turn, index) => {
    const voice = turn?.voice ?? null;
    const raw = voice ? pick(voice, turn) : null;
    const value = Number.isFinite(raw) ? raw : null;
    if (value !== null) {
      measured += 1;
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
    points.push({ index, value, flagged: voice?.insufficient_data === true });
  });

  return { points, n: points.length, measured, min, max };
}

/**
 * Split a metric series into runs of CONSECUTIVE measured points, so a
 * polyline never bridges a turn where the metric was not measured — the
 * same no-interpolation rule `pitchSegments` enforces within a turn.
 *
 * @param {Array<{index: number, value: number|null}>} points  from `turnMetricSeries`
 * @returns {Array<Array<{index: number, value: number}>>}
 */
export function measuredRuns(points) {
  const usable = Array.isArray(points) ? points : [];
  const runs = [];
  let current = null;
  for (const point of usable) {
    if (point.value === null) {
      current = null;
      continue;
    }
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push({ index: point.index, value: point.value });
  }
  return runs;
}
