/**
 * IlluminationEstimator — ambient lighting quality from the camera frame.
 *
 * Lighting is not a signal about the learner; it is the covariate that says
 * how much to trust every OTHER signal. rPPG, emotion confidence and gaze
 * quality all degrade in poor light, and without this you cannot tell a bad
 * reading from a badly-lit room. That distinction is the whole point.
 *
 * Sampling is deliberately tiny: the frame is drawn to a 32x18 canvas, so one
 * sample is 576 pixels regardless of camera resolution. The scoring maths is
 * pure and DOM-free (unit-tested with synthetic pixel buffers); only
 * `sampleFrameLuma` touches the DOM.
 */

const GRID_W = 32;
const GRID_H = 18;

// Rec. 709 luma weights — perceptual brightness, not a naive RGB mean.
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

// A pixel this dark carries no recoverable detail; this bright is saturated.
// Both destroy the subtle colour variation rPPG depends on.
const CLIP_LOW = 0.04;
const CLIP_HIGH = 0.96;

// Target working range. Below `dim` the sensor is noise-dominated; above
// `bright` it starts clipping. Centre of the range scores 1.
const GOOD_LOW = 0.25;
const GOOD_HIGH = 0.75;

/**
 * Luma statistics from a raw RGBA buffer.
 *
 * @param {Uint8ClampedArray|number[]} rgba  length 4*n
 * @returns {{mean_luma:number, luma_std:number, clipped_low:number, clipped_high:number}|null}
 */
export function lumaStats(rgba) {
  if (!rgba || rgba.length < 4) return null;
  const n = Math.floor(rgba.length / 4);
  let sum = 0;
  let sumSq = 0;
  let low = 0;
  let high = 0;
  for (let i = 0; i < n; i += 1) {
    const p = i * 4;
    const y = (LUMA_R * rgba[p] + LUMA_G * rgba[p + 1] + LUMA_B * rgba[p + 2]) / 255;
    sum += y;
    sumSq += y * y;
    if (y <= CLIP_LOW) low += 1;
    if (y >= CLIP_HIGH) high += 1;
  }
  const mean = sum / n;
  // Population variance; clamped at 0 because floating-point can go slightly
  // negative when every pixel is identical.
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    mean_luma: mean,
    luma_std: Math.sqrt(variance),
    clipped_low: low / n,
    clipped_high: high / n,
  };
}

/**
 * Map luma statistics to a 0..1 quality score.
 *
 * Exposure is scored on a plateau (anything in the good range is fine —
 * "brighter" is not "better"), then clipping is subtracted, because clipped
 * pixels are destroyed information that no amount of correct average
 * brightness compensates for.
 *
 * @param {{mean_luma:number, clipped_low:number, clipped_high:number}} stats
 * @returns {number} 0..1
 */
export function illuminationQuality(stats) {
  if (!stats || !Number.isFinite(stats.mean_luma)) return 0;
  const m = stats.mean_luma;
  let exposure;
  if (m >= GOOD_LOW && m <= GOOD_HIGH) exposure = 1;
  else if (m < GOOD_LOW) exposure = Math.max(0, m / GOOD_LOW);
  else exposure = Math.max(0, (1 - m) / (1 - GOOD_HIGH));
  const clipped = (stats.clipped_low ?? 0) + (stats.clipped_high ?? 0);
  return clamp01(exposure * (1 - Math.min(1, clipped * 1.5)));
}

/**
 * Human-readable verdict. Researchers need to know WHICH way the light is
 * wrong to fix it; a bare score does not tell them.
 *
 * @param {{mean_luma:number, clipped_low:number, clipped_high:number}} stats
 * @param {number} [stability] 0..1 temporal stability, when known
 * @returns {'good'|'dim'|'bright'|'backlit'|'unstable'}
 */
export function illuminationAssessment(stats, stability) {
  if (!stats) return 'dim';
  if (Number.isFinite(stability) && stability < 0.6) return 'unstable';
  // Simultaneously crushed shadows AND blown highlights is the signature of a
  // window or lamp behind the subject — the single most common bad setup, and
  // one that a mean-brightness check alone reads as perfectly exposed.
  if (stats.clipped_low > 0.15 && stats.clipped_high > 0.05) return 'backlit';
  if (stats.mean_luma < GOOD_LOW) return 'dim';
  if (stats.mean_luma > GOOD_HIGH) return 'bright';
  return 'good';
}

/**
 * Draw the current video frame to a small offscreen canvas and measure it.
 * Returns null when there is no DOM, no frame yet, or the video is tainted
 * by cross-origin content.
 *
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} [canvas] reusable scratch canvas
 * @returns {object|null}
 */
export function sampleFrameLuma(video, canvas) {
  if (typeof document === 'undefined') return null;
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const c = canvas || document.createElement('canvas');
  c.width = GRID_W;
  c.height = GRID_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, GRID_W, GRID_H);
    const { data } = ctx.getImageData(0, 0, GRID_W, GRID_H);
    return lumaStats(data);
  } catch {
    // Tainted canvas (cross-origin video) — no lighting signal available.
    return null;
  }
}

export class IlluminationEstimator {
  constructor(options = {}) {
    this.options = {
      /** Injectable so the runtime can be tested without a DOM. */
      sampler: null,
      ...options,
    };
    this._canvas = null;
    this._prevMean = null;
  }

  /**
   * @param {HTMLVideoElement} video
   * @returns {object|null} per-sample illumination reading
   */
  estimate(video) {
    if (typeof document !== 'undefined' && !this._canvas) {
      this._canvas = document.createElement('canvas');
    }
    const stats = this.options.sampler
      ? this.options.sampler(video)
      : sampleFrameLuma(video, this._canvas);
    if (!stats) return null;

    // Frame-to-frame brightness delta. Flicker (a screen changing behind the
    // subject, autoexposure hunting) corrupts rPPG far more than a steady dim
    // room does, so it is measured separately from the exposure level.
    const delta = this._prevMean == null ? 0 : Math.abs(stats.mean_luma - this._prevMean);
    this._prevMean = stats.mean_luma;

    const quality = illuminationQuality(stats);
    return {
      ...stats,
      luma_delta: delta,
      quality,
      assessment: illuminationAssessment(stats),
      valid: true,
      ts_ms: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
  }

  reset() {
    this._prevMean = null;
  }
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export { GRID_W, GRID_H, GOOD_LOW, GOOD_HIGH };
