/**
 * Minimal, zero-dependency radix-2 Cooley–Tukey FFT. Vendored (rather than
 * pulling an npm FFT) to keep Oyon dependency-light — the only consumer is the
 * rPPG heart-rate estimator, which needs a single real-signal power spectrum.
 *
 * `fftRadix2(re, im)` transforms in place; length MUST be a power of two.
 * `powerSpectrum(signal)` is the convenience path: zero-pads a real signal to
 * the next power of two, runs the FFT, and returns the one-sided magnitude²
 * per bin (length N/2+1). Callers map bin index → frequency via `fs`.
 */

/** Next power of two ≥ n (n ≥ 1). */
export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * In-place radix-2 FFT. `re`/`im` are equal-length Float64Array-like arrays;
 * length must be a power of two. Modifies both in place.
 */
export function fftRadix2(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('fftRadix2: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }

  // Danielson–Lanczos butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k];
        const aIm = im[i + k];
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = aRe + bRe;
        im[i + k] = aIm + bIm;
        re[i + k + len / 2] = aRe - bRe;
        im[i + k + len / 2] = aIm - bIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * One-sided power spectrum of a real signal. Zero-pads to the next power of
 * two. Returns Float64Array of length N/2+1 with magnitude² per bin.
 */
export function powerSpectrum(signal) {
  const n = nextPow2(signal.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < signal.length; i += 1) re[i] = signal[i];
  fftRadix2(re, im);
  const half = n / 2;
  const out = new Float64Array(half + 1);
  for (let i = 0; i <= half; i += 1) {
    out[i] = re[i] * re[i] + im[i] * im[i];
  }
  return out;
}
