/**
 * voiceFeatures.js — per-frame voice DSP: energy, spectral shape, and F0.
 *
 * Pure, dependency-free, DOM-free frame analysis (testable in Node with
 * synthetic signals) for the voice pipeline (audio_text.md §5.6, `voice-v1`).
 * The capture layer feeds Float32Array frames from an AudioWorklet; the
 * VoiceTurnAggregator consumes the per-frame results. This module knows about
 * neither — same house style as HeartRateEstimator.js: pure exported
 * functions, plain arrays / Float64Array, documented units.
 *
 * Spectral scope is DELIBERATELY centroid + roll-off only. §5.6 trimmed the
 * profile to ~15 measurements so the §5.10 frozen-threshold validation gate is
 * affordable; flatness, slope, and band-energy ratios are §5.7 deferrals
 * because browser noise-suppression and AGC dominate them and they need
 * per-device calibration. Do not re-add them here.
 *
 * Bin→frequency mapping (load-bearing, see spectralFeatures): powerSpectrum
 * zero-pads the frame to n = nextPow2(frame.length), so bin i corresponds to
 *   binHz = i * sampleRate / n        (n = PADDED length, NOT frame length)
 * Using the frame length instead silently scales every spectral number for
 * non-power-of-two frames; tests pin this with a tone at a known frequency.
 */

import { powerSpectrum, nextPow2 } from './fft.js';
import { estimateF0 } from './pitch.js';

export { estimateF0, computeNsdf } from './pitch.js';

/** Samples at or beyond this magnitude count as clipped (see frameEnergy). */
export const CLIP_THRESHOLD = 0.999;

// Hann windows cached by length: at ~50 frames/s, recomputing n cosines per
// frame is pure waste. The cached array is shared — callers must treat it as
// read-only (applyWindow does).
const hannCache = new Map();

/**
 * Symmetric Hann window of length n (same shape HeartRateEstimator applies):
 *   w[i] = 0.5 * (1 - cos(2*pi*i / (n-1)))
 * Cached per length — repeat calls return the SAME Float64Array instance; do
 * not mutate it.
 *
 * @param {number} n  window length (>= 1)
 * @returns {Float64Array} length n; endpoints are 0 for n >= 2, [1] for n = 1
 */
export function hannWindow(n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('hannWindow: n must be a positive integer');
  const cached = hannCache.get(n);
  if (cached) return cached;
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
  } else {
    for (let i = 0; i < n; i += 1) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }
  }
  hannCache.set(n, w);
  return w;
}

/**
 * Element-wise product of a frame and a window of the same length.
 * Returns a NEW Float64Array; neither input is modified.
 *
 * @param {ArrayLike<number>} frame
 * @param {ArrayLike<number>} window  same length as frame
 * @returns {Float64Array}
 */
export function applyWindow(frame, window) {
  if (frame.length !== window.length) {
    throw new Error(`applyWindow: length mismatch (frame ${frame.length}, window ${window.length})`);
  }
  const out = new Float64Array(frame.length);
  for (let i = 0; i < frame.length; i += 1) out[i] = frame[i] * window[i];
  return out;
}

/**
 * Time-domain energy measurements of one frame. Units: samples are nominally
 * in [-1, 1] (Web Audio float PCM), so `rms` and `peak` are in that scale.
 *
 * `clippedSamples` counts samples with |x| >= CLIP_THRESHOLD (0.999): clipping
 * destroys both loudness and spectral measurements, so it must be countable
 * per frame and reportable as coverage (§5.6 quality block).
 *
 * `zeroCrossingRate` is strict sign changes (product < 0 between consecutive
 * samples) divided by (n - 1): the fraction of sample intervals that cross
 * zero, in [0, 1]. Exact zeros do not count as crossings.
 *
 * @param {ArrayLike<number>} frame
 * @returns {{rms:number, peak:number, clippedSamples:number, zeroCrossingRate:number}}
 *   all-zero result for an empty frame — never NaN.
 */
export function frameEnergy(frame) {
  const n = frame.length;
  if (n === 0) return { rms: 0, peak: 0, clippedSamples: 0, zeroCrossingRate: 0 };
  let sumSq = 0;
  let peak = 0;
  let clippedSamples = 0;
  let crossings = 0;
  for (let i = 0; i < n; i += 1) {
    const v = frame[i];
    sumSq += v * v;
    const mag = Math.abs(v);
    if (mag > peak) peak = mag;
    if (mag >= CLIP_THRESHOLD) clippedSamples += 1;
    if (i > 0 && frame[i - 1] * v < 0) crossings += 1;
  }
  return {
    rms: Math.sqrt(sumSq / n),
    peak,
    clippedSamples,
    zeroCrossingRate: n > 1 ? crossings / (n - 1) : 0,
  };
}

/**
 * Spectral centroid and roll-off of one frame.
 *
 * Pipeline: Hann window → powerSpectrum (fft.js zero-pads to the next power
 * of two) → moments over the one-sided magnitude² spectrum. Bin i maps to
 * `i * sampleRate / n` Hz where n = nextPow2(frame.length) — the PADDED FFT
 * length, not the frame length (see file header).
 *
 * - `centroidHz`: power-weighted mean frequency, sum(f_i * P_i) / sum(P_i).
 * - `rolloffHz`: lowest bin frequency at which cumulative power reaches
 *   `rolloffFraction` (default 0.85) of total power. Monotone non-decreasing
 *   in `rolloffFraction` by construction.
 *
 * Both are `null` (not NaN, not 0) for a silent or sub-2-sample frame — a
 * frame with no power has no spectral shape, and downstream statistics must
 * be able to exclude it.
 *
 * @param {ArrayLike<number>} frame
 * @param {number} sampleRate  Hz
 * @param {object} [options]
 * @param {number} [options.rolloffFraction=0.85]
 * @returns {{centroidHz:number|null, rolloffHz:number|null, spectrum:Float64Array}}
 *   `spectrum` is the one-sided power spectrum (length n/2 + 1) of the
 *   windowed frame, exposed per the record-everything data policy.
 */
export function spectralFeatures(frame, sampleRate, options = {}) {
  const { rolloffFraction = 0.85 } = options;
  const len = frame.length;
  if (len < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { centroidHz: null, rolloffHz: null, spectrum: new Float64Array(0) };
  }
  const windowed = applyWindow(frame, hannWindow(len));
  const spectrum = powerSpectrum(windowed);
  const n = nextPow2(len); // padded FFT length — the bin→Hz denominator
  const hzPerBin = sampleRate / n;

  let total = 0;
  let weighted = 0;
  for (let i = 0; i < spectrum.length; i += 1) {
    total += spectrum[i];
    weighted += i * hzPerBin * spectrum[i];
  }
  if (total <= 0 || !Number.isFinite(total)) {
    return { centroidHz: null, rolloffHz: null, spectrum };
  }

  const target = rolloffFraction * total;
  let cumulative = 0;
  let rolloffBin = spectrum.length - 1;
  for (let i = 0; i < spectrum.length; i += 1) {
    cumulative += spectrum[i];
    if (cumulative >= target) { rolloffBin = i; break; }
  }
  return {
    centroidHz: weighted / total,
    rolloffHz: rolloffBin * hzPerBin,
    spectrum,
  };
}

/**
 * Full per-frame analysis: energy + spectral shape + F0, one flat record per
 * frame for the VoiceTurnAggregator. Pure and synchronous.
 *
 * Null conventions: `centroidHz`/`rolloffHz` are null for a silent frame;
 * `f0Hz` is null for an unvoiced frame (see pitch.js — null, never 0). No
 * field is ever NaN.
 *
 * @param {ArrayLike<number>} frame  audio samples, nominally in [-1, 1]
 * @param {number} sampleRate  Hz
 * @param {object} [options]  forwarded: `rolloffFraction` to spectralFeatures;
 *   `minHz`, `maxHz`, `clarityThreshold`, `peakSelectionRatio` to estimateF0
 * @returns {{rms:number, peak:number, clippedSamples:number,
 *   zeroCrossingRate:number, centroidHz:number|null, rolloffHz:number|null,
 *   f0Hz:number|null, f0Confidence:number, voiced:boolean}}
 */
export function analyzeFrame(frame, sampleRate, options = {}) {
  const energy = frameEnergy(frame);
  const spectral = spectralFeatures(frame, sampleRate, options);
  const pitch = estimateF0(frame, sampleRate, options);
  return {
    rms: energy.rms,
    peak: energy.peak,
    clippedSamples: energy.clippedSamples,
    zeroCrossingRate: energy.zeroCrossingRate,
    centroidHz: spectral.centroidHz,
    rolloffHz: spectral.rolloffHz,
    f0Hz: pitch.f0Hz,
    f0Confidence: pitch.confidence,
    voiced: pitch.voiced,
  };
}
