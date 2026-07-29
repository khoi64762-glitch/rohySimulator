/**
 * pitch.js — in-house F0 (fundamental frequency) estimation via the McLeod
 * Pitch Method / NSDF (normalized square difference function).
 *
 * WHY IN-HOUSE, NOT `pitchy`: the voice plan (audio_text.md §5.3) originally
 * named the npm package `pitchy` for McLeod/NSDF pitch. We implement it here
 * instead because (a) it is ~100 lines on top of machinery this repo already
 * owns, (b) every other Oyon pipeline is zero-dependency by design — the
 * vendored `src/analytics/fft.js` exists precisely to avoid an npm FFT — and
 * (c) the published package is ~442 kB and dependency-light on purpose.
 * Trade-off: we own correctness and maintenance ourselves, so the algorithm is
 * validated against synthetic tones with known answers in tests/pitch.test.js,
 * and octave-error rate on a labeled reference subset is a standing validation
 * target (§5.10 of the plan).
 *
 * ALGORITHM (McLeod & Wyvill 2005, "A smarter way to find pitch"):
 *   NSDF n'(τ) = 2·r(τ) / m(τ)  where, over j = 0 .. W−τ−1,
 *     r(τ) = Σ x[j]·x[j+τ]           (autocorrelation)
 *     m(τ) = Σ (x[j]² + x[j+τ]²)     (square-difference normalizer)
 *   n'(τ) ∈ [−1, 1]; a value near 1 at lag τ means the frame is nearly
 *   periodic with period τ samples. The frame mean is removed first so a DC
 *   offset (mic bias) cannot masquerade as periodicity.
 *
 * OCTAVE-ERROR GUARD: for any periodic signal the NSDF also peaks at every
 * integer multiple of the true period — a sub-harmonic peak at 2× the true lag
 * (half the true frequency) is the classic failure, and slight amplitude
 * modulation can make that double-lag peak the GLOBAL maximum. We therefore
 * never take the global maximum: we collect the key local maxima after the
 * first negative-going zero crossing of the NSDF, then choose the EARLIEST
 * peak whose value is within `peakSelectionRatio` (default 0.9) of the highest
 * peak. The earliest qualifying peak is the shortest credible period, i.e. the
 * true fundamental rather than its sub-harmonic. tests/pitch.test.js proves
 * the guard: it asserts the double-lag peak qualifies under a global-max
 * strategy and that estimateF0 still returns the true F0.
 *
 * The lag search range comes from `minHz`/`maxHz` (defaults 60/400 Hz): adult
 * speaking F0 spans roughly 60–180 Hz (typical male) to 160–300 Hz (typical
 * female), with children reaching toward 400 Hz. Bounding the search to that
 * human-speech range both saves work and rejects out-of-band periodicity
 * (mains hum below, harmonics above).
 *
 * The direct O(W·τmax) NSDF is used rather than an FFT-based autocorrelation:
 * at 16 kHz with 60 Hz minimum pitch, τmax ≈ 267, so a 2048-sample frame costs
 * ~0.5 M multiply-adds — negligible at ~50 frames/s, and simpler to verify.
 *
 * House style matches HeartRateEstimator.js: pure exported functions, plain
 * arrays / Float64Array in and out, documented units, no DOM, no dependencies.
 */

/**
 * Normalized square difference function of a frame, lags 0..maxLag.
 * The frame mean is removed before correlation. Exported for tests and for
 * researchers who want the raw curve (data policy: expose everything).
 *
 * @param {ArrayLike<number>} frame  audio samples (any numeric array type)
 * @param {number} maxLag  highest lag to compute; clamped to frame.length − 1
 * @returns {Float64Array} nsdf values, length min(maxLag, frame.length − 1) + 1;
 *   nsdf[0] is 1 for any non-silent frame. Returns an all-zero array for a
 *   silent (zero-energy) or too-short frame — never NaN.
 */
export function computeNsdf(frame, maxLag) {
  const n = frame.length;
  const top = Math.max(0, Math.min(maxLag, n - 1));
  const nsdf = new Float64Array(top + 1);
  if (n < 2) return nsdf;

  // Remove DC so mic bias cannot look like periodicity.
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += frame[i];
  mean /= n;
  const x = new Float64Array(n);
  let energy = 0;
  for (let i = 0; i < n; i += 1) {
    x[i] = frame[i] - mean;
    energy += x[i] * x[i];
  }
  if (energy <= Number.EPSILON * n) return nsdf; // silence → flat zero curve

  for (let tau = 0; tau <= top; tau += 1) {
    let acf = 0;
    let m = 0;
    for (let j = 0; j + tau < n; j += 1) {
      acf += x[j] * x[j + tau];
      m += x[j] * x[j] + x[j + tau] * x[j + tau];
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }
  return nsdf;
}

/**
 * Estimate the fundamental frequency of one audio frame (McLeod/NSDF).
 *
 * A frame with no detectable pitch returns `f0Hz: null` — null, NOT 0. An
 * unvoiced frame is not a frame at 0 Hz; downstream statistics (pitch median,
 * IQR, contour slope) must be able to exclude it, and a 0 would silently
 * poison every one of them.
 *
 * @param {ArrayLike<number>} frame  audio samples, nominally in [−1, 1]
 * @param {number} sampleRate  Hz
 * @param {object} [options]
 * @param {number} [options.minHz=60]   lowest F0 searched (human speech floor)
 * @param {number} [options.maxHz=400]  highest F0 searched (human speech ceiling)
 * @param {number} [options.clarityThreshold=0.5]  minimum NSDF peak value for
 *   the frame to count as voiced (0–1)
 * @param {number} [options.peakSelectionRatio=0.9]  a peak qualifies when its
 *   value ≥ this fraction of the highest peak; the EARLIEST qualifying peak is
 *   chosen (octave-error guard — see file header)
 * @returns {{f0Hz: number|null, confidence: number, voiced: boolean}}
 *   `confidence` is the (parabolically interpolated) NSDF value at the chosen
 *   lag, clamped to [0, 1]; 0 when no peak exists at all.
 */
export function estimateF0(frame, sampleRate, options = {}) {
  const {
    minHz = 60,
    maxHz = 400,
    clarityThreshold = 0.5,
    peakSelectionRatio = 0.9,
  } = options;
  const unvoiced = { f0Hz: null, confidence: 0, voiced: false };

  const n = frame ? frame.length : 0;
  if (n < 4 || !Number.isFinite(sampleRate) || sampleRate <= 0) return unvoiced;
  if (!(minHz > 0) || !(maxHz > minHz)) return unvoiced;

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  // +1 headroom so parabolic interpolation always has a right neighbour.
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / minHz) + 1);
  if (maxLag <= minLag) return unvoiced;

  const nsdf = computeNsdf(frame, maxLag + 1);

  // Skip the lag-0 lobe: peaks are only meaningful after the NSDF first goes
  // negative. Riding down the lobe, noise ripple can create tiny "local
  // maxima" with near-1 values that would read as absurdly high pitch.
  let firstNegative = -1;
  for (let tau = 1; tau <= maxLag; tau += 1) {
    if (nsdf[tau] < 0) { firstNegative = tau; break; }
  }
  if (firstNegative < 0) return unvoiced; // never left the zero-lag lobe → no period
  // Start at minLag itself (not minLag+1): a pitch exactly at maxHz peaks at
  // lag == minLag, and skipping that lag mis-reads the tone an octave low.
  const start = Math.max(firstNegative + 1, minLag);

  // Key local maxima in [start, maxLag]. nsdf has maxLag+1 valid neighbours.
  const peakLags = [];
  let highest = 0;
  for (let tau = start; tau <= maxLag; tau += 1) {
    if (nsdf[tau] > 0 && nsdf[tau] > nsdf[tau - 1] && nsdf[tau] >= nsdf[tau + 1]) {
      peakLags.push(tau);
      if (nsdf[tau] > highest) highest = nsdf[tau];
    }
  }
  if (peakLags.length === 0 || highest <= 0) return unvoiced;

  // Octave-error guard: earliest peak within peakSelectionRatio of the best,
  // never the global maximum (which may sit at 2× the true lag).
  const cutoff = highest * peakSelectionRatio;
  let chosen = peakLags[0];
  for (let i = 0; i < peakLags.length; i += 1) {
    if (nsdf[peakLags[i]] >= cutoff) { chosen = peakLags[i]; break; }
  }

  // Parabolic interpolation for sub-sample lag accuracy. At 16 kHz a 150 Hz
  // tone has a 106.67-sample period — integer lags alone quantize F0 by ~1.5 Hz.
  const y1 = nsdf[chosen - 1];
  const y2 = nsdf[chosen];
  const y3 = nsdf[chosen + 1];
  const denom = y1 - 2 * y2 + y3;
  let delta = denom !== 0 ? (0.5 * (y1 - y3)) / denom : 0;
  if (!Number.isFinite(delta) || Math.abs(delta) > 1) delta = 0;
  const interpLag = chosen + delta;
  const interpVal = y2 - 0.25 * (y1 - y3) * delta;

  const confidence = Math.min(1, Math.max(0, interpVal));
  if (confidence < clarityThreshold || interpLag <= 0) {
    return { f0Hz: null, confidence, voiced: false };
  }
  return { f0Hz: sampleRate / interpLag, confidence, voiced: true };
}
