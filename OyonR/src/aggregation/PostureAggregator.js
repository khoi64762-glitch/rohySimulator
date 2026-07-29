/**
 * PostureAggregator — windows the per-frame posture scalars from
 * `extractPostureFeatures()`, mirroring the cadence/ISO conventions of the
 * emotion / engagement / facial aggregators.
 *
 * Emits per window: mean & std of each posture scalar over valid frames, a
 * `postural_sway_deg` movement proxy (mean |Δtorso lean| between consecutive
 * valid frames — a restlessness/fidget signal), and frame counts. Raw
 * landmarks are never retained here; they ride the local `sample` event.
 */

const MODEL_VERSION = 'mediapipe-pose-landmarker-v1';

// Scalars we track mean/std for.
const METRICS = [
  'shoulder_tilt_deg',
  'torso_lean_deg',
  'head_lateral_norm',
  'head_above_norm',
  'shoulder_width_norm',
  'upper_visibility',
];

export class PostureAggregator {
  constructor(options = {}) {
    this.options = {
      windowMs: 10000,
      sampleIntervalMs: 1000,
      ...options,
    };
    this.windowStart = null;
    this.frames = [];
  }

  consumeFrame(sample, timestamp = sample?.ts_ms ?? Date.now()) {
    if (sample == null) return null;
    if (this.windowStart === null) this.windowStart = timestamp;

    const record = { valid: sample.valid === true };
    for (const key of METRICS) {
      record[key] = Number.isFinite(sample[key]) ? sample[key] : null;
    }
    this.frames.push(record);

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
    const validCount = validFrames.length;

    const out = {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      total_frames: totalFrames,
      valid_frames: validCount,
      valid_frame_ratio: totalFrames > 0 ? validCount / totalFrames : 0,
      model_version: MODEL_VERSION,
    };

    for (const key of METRICS) {
      const values = validFrames.map((f) => f[key]).filter(Number.isFinite);
      out[`${key}_mean`] = mean(values);
      out[`${key}_std`] = std(values);
    }

    // Postural sway: mean absolute change in torso lean between consecutive
    // valid frames (in capture order). Restlessness/fidget proxy.
    let sway = null;
    const leans = validFrames.map((f) => f.torso_lean_deg).filter(Number.isFinite);
    if (leans.length >= 2) {
      let sum = 0;
      for (let i = 1; i < leans.length; i += 1) sum += Math.abs(leans[i] - leans[i - 1]);
      sway = sum / (leans.length - 1);
    } else if (leans.length === 1) {
      sway = 0;
    }
    out.postural_sway_deg = sway;

    return out;
  }
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function std(values) {
  if (values.length < 2) return values.length === 1 ? 0 : null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
