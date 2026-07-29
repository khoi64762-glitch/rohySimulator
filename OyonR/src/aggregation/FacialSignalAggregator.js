/**
 * FacialSignalAggregator — windows the per-frame facial signals produced by
 * `extractFacialSignals()` (head pose + action units), mirroring the cadence
 * and ISO-string conventions of `EmotionAggregator` / `EngagementAggregator`.
 *
 * Emits, per window:
 *   - head_pose_mean / head_pose_std   {pitch_deg, yaw_deg, roll_deg}
 *   - head_movement_deg                mean |frame-to-frame| angular delta
 *                                      (a nod/fidget/restlessness proxy)
 *   - facing_screen_ratio              fraction of pose frames within the
 *                                      frontal cone (attention proxy)
 *   - action_units_mean                per named AU proxy
 *   - blendshapes_mean                 ALL blendshapes, averaged (expose
 *                                      everything — data policy)
 *
 * Retains only the small scalar record it needs per frame; drops the input
 * object (and any landmark/matrix payload) immediately.
 */

const MODEL_VERSION = 'mediapipe-facial-signals-v1';

export class FacialSignalAggregator {
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

    const hp = sample.head_pose || null;
    const record = {
      pitch: hp && Number.isFinite(hp.pitch_deg) ? hp.pitch_deg : null,
      yaw: hp && Number.isFinite(hp.yaw_deg) ? hp.yaw_deg : null,
      roll: hp && Number.isFinite(hp.roll_deg) ? hp.roll_deg : null,
      facing: typeof sample.facing_screen === 'boolean' ? sample.facing_screen : null,
      action_units: isPlainObject(sample.action_units) ? sample.action_units : null,
      blendshapes: isPlainObject(sample.blendshapes) ? sample.blendshapes : null,
      valid: sample.valid === true,
    };
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

    // Pose stats over frames that recovered a head pose.
    const poseFrames = frames.filter(f => f.valid && f.pitch !== null);
    const validFrames = poseFrames.length;

    const head_pose_mean = validFrames > 0
      ? {
          pitch_deg: mean(poseFrames.map(f => f.pitch)),
          yaw_deg: mean(poseFrames.map(f => f.yaw)),
          roll_deg: mean(poseFrames.map(f => f.roll)),
        }
      : null;
    const head_pose_std = validFrames > 0
      ? {
          pitch_deg: std(poseFrames.map(f => f.pitch)),
          yaw_deg: std(poseFrames.map(f => f.yaw)),
          roll_deg: std(poseFrames.map(f => f.roll)),
        }
      : null;

    // Frame-to-frame movement: mean Euclidean angular delta between
    // consecutive pose frames (in the order captured). A nod/shake/fidget
    // proxy — 0 when perfectly still.
    let head_movement_deg = null;
    if (validFrames >= 2) {
      let sum = 0;
      let n = 0;
      for (let i = 1; i < poseFrames.length; i += 1) {
        const a = poseFrames[i];
        const b = poseFrames[i - 1];
        const dp = a.pitch - b.pitch;
        const dy = a.yaw - b.yaw;
        const dr = a.roll - b.roll;
        sum += Math.sqrt(dp * dp + dy * dy + dr * dr);
        n += 1;
      }
      head_movement_deg = n > 0 ? sum / n : null;
    } else if (validFrames === 1) {
      head_movement_deg = 0;
    }

    // Facing-screen ratio over frames that reported a facing boolean.
    let facingTrue = 0;
    let facingTotal = 0;
    for (let i = 0; i < frames.length; i += 1) {
      if (typeof frames[i].facing === 'boolean') {
        facingTotal += 1;
        if (frames[i].facing) facingTrue += 1;
      }
    }
    const facing_screen_ratio = facingTotal > 0 ? facingTrue / facingTotal : null;

    const action_units_mean = averageMaps(frames.map(f => f.action_units));
    const blendshapes_mean = averageMaps(frames.map(f => f.blendshapes));

    return {
      window_start: new Date(windowStart ?? end).toISOString(),
      window_end: new Date(end).toISOString(),
      duration_ms: durationMs,
      expected_samples: expectedSamples,
      total_frames: totalFrames,
      valid_frames: validFrames,
      valid_frame_ratio: totalFrames > 0 ? validFrames / totalFrames : 0,
      head_pose_mean,
      head_pose_std,
      head_movement_deg,
      facing_screen_ratio,
      action_units_mean,
      blendshapes_mean,
      model_version: MODEL_VERSION,
    };
  }
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function mean(values) {
  const nums = values.filter(Number.isFinite);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function std(values) {
  const nums = values.filter(Number.isFinite);
  if (nums.length < 2) return nums.length === 1 ? 0 : null;
  const m = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + (v - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

/**
 * Average an array of {key: number} maps into one {key: meanNumber}. Keys are
 * the union across all maps; each key averages only the frames that reported
 * it. Returns null if no map had any numeric entry.
 */
function averageMaps(maps) {
  const sums = Object.create(null);
  const counts = Object.create(null);
  let any = false;
  for (let i = 0; i < maps.length; i += 1) {
    const m = maps[i];
    if (!isPlainObject(m)) continue;
    for (const key of Object.keys(m)) {
      const v = Number(m[key]);
      if (!Number.isFinite(v)) continue;
      sums[key] = (sums[key] || 0) + v;
      counts[key] = (counts[key] || 0) + 1;
      any = true;
    }
  }
  if (!any) return null;
  const out = Object.create(null);
  for (const key of Object.keys(sums)) {
    out[key] = sums[key] / counts[key];
  }
  return out;
}
