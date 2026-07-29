/**
 * IlluminationAggregator — windows the per-sample lighting readings.
 *
 * Emits exposure level, clipping, a quality score, and — the field that
 * matters most for rPPG — temporal STABILITY. A steadily dim room is
 * workable; a room whose brightness swings (autoexposure hunting, a screen
 * flickering behind the subject) injects energy straight into the heart-rate
 * band and is far more damaging than the mean level suggests.
 */

const MODEL_VERSION = 'illumination-v1';

export class IlluminationAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 1000,
      // Frame-to-frame luma delta (0..1) at which stability scores 0. 0.08 is
      // ~8% brightness swing between samples, which is already severe.
      deltaFloor: 0.08,
      ...options,
    };
    this.windowStart = null;
    this.frames = [];
  }

  consumeFrame(sample, timestamp = Date.now()) {
    if (this.windowStart === null) this.windowStart = timestamp;
    this.frames.push(sample && sample.valid ? sample : null);
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
    const durationMs = Math.max(0, end - (windowStart ?? end));

    const lumas = valid.map((f) => f.mean_luma).filter(Number.isFinite);
    const deltas = valid.map((f) => f.luma_delta).filter(Number.isFinite);
    const qualities = valid.map((f) => f.quality).filter(Number.isFinite);

    // Stability: 1 when brightness never moves, 0 once the mean frame-to-frame
    // swing reaches deltaFloor.
    const meanDelta = mean(deltas);
    const stability = meanDelta == null
      ? null
      : clamp01(1 - meanDelta / this.options.deltaFloor);

    const stats = valid.length > 0
      ? {
        mean_luma: mean(lumas),
        clipped_low: mean(valid.map((f) => f.clipped_low)),
        clipped_high: mean(valid.map((f) => f.clipped_high)),
      }
      : null;

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      total_frames: frames.length,
      valid_frames: valid.length,
      valid_frame_ratio: frames.length > 0 ? valid.length / frames.length : 0,
      mean_luma: mean(lumas),
      luma_std: mean(valid.map((f) => f.luma_std)),
      // Spread of the WINDOW's brightness, distinct from luma_std (which is
      // spread across the pixels of one frame).
      luma_temporal_std: std(lumas),
      clipped_low: stats ? stats.clipped_low : null,
      clipped_high: stats ? stats.clipped_high : null,
      stability,
      quality_mean: mean(qualities),
      quality_min: qualities.length > 0 ? Math.min(...qualities) : null,
      assessment: stats ? assess(stats, stability) : null,
      model_version: MODEL_VERSION,
    };
  }
}

// Local copy of the verdict logic so the aggregator does not depend on the
// estimator module (it may run in a worker/test without the DOM half).
function assess(stats, stability) {
  if (Number.isFinite(stability) && stability < 0.6) return 'unstable';
  if (stats.clipped_low > 0.15 && stats.clipped_high > 0.05) return 'backlit';
  if (stats.mean_luma < 0.25) return 'dim';
  if (stats.mean_luma > 0.75) return 'bright';
  return 'good';
}

function mean(a) {
  const v = a.filter(Number.isFinite);
  if (v.length === 0) return null;
  return v.reduce((x, y) => x + y, 0) / v.length;
}
function std(a) {
  const v = a.filter(Number.isFinite);
  if (v.length < 2) return v.length === 1 ? 0 : null;
  const m = v.reduce((x, y) => x + y, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
}
function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
