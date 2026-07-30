import assert from 'node:assert/strict';
import { estimateF0, computeNsdf } from '../src/analytics/pitch.js';

/*
 * F0 estimation (McLeod/NSDF) against synthetic signals with known answers.
 *
 * Every case is a signal whose true pitch (or true absence of pitch) is known
 * by construction: pure tones must land within 2% of truth, aperiodic signals
 * must return f0Hz null (NOT 0, NOT a plausible number), and a harmonically
 * rich signal must NOT be reported an octave low — the sub-harmonic NSDF peak
 * at twice the true lag is proven to qualify and proven not to be chosen.
 */

const FS = 16000;
const FRAME = 2048; // ~128 ms at 16 kHz; >= 2 periods of a 60 Hz floor pitch

function sine(freq, { n = FRAME, fs = FS, amplitude = 0.5, phase = 0 } = {}) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / fs + phase);
  }
  return out;
}

// Deterministic LCG — Math.random would make failures unreproducible.
function makeRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
}

// ── pure sines recover F0 within 2% ─────────────────────────────────
// 400 is included deliberately: a pitch exactly at the maxHz boundary peaks at
// lag == minLag, which an off-by-one in the peak search once mis-read as
// 200 Hz (octave-down).
{
  for (const freq of [100, 150, 220, 300, 400]) {
    const out = estimateF0(sine(freq), FS);
    assert.equal(out.voiced, true, `${freq} Hz sine must be voiced`);
    assert.ok(out.f0Hz !== null, `${freq} Hz sine must yield an F0`);
    const relErr = Math.abs(out.f0Hz - freq) / freq;
    assert.ok(relErr < 0.02,
      `${freq} Hz sine: got ${out.f0Hz.toFixed(2)} Hz (${(relErr * 100).toFixed(2)}% off, allowed 2%)`);
    assert.ok(out.confidence > 0.9, `${freq} Hz clean sine confidence ${out.confidence} should be near 1`);
  }
}

// ── white noise → unvoiced, f0Hz strictly null ──────────────────────
{
  const rand = makeRand(7);
  const noise = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) noise[i] = rand();
  const out = estimateF0(noise, FS);
  assert.equal(out.voiced, false, 'white noise must be unvoiced');
  assert.equal(out.f0Hz, null, 'white noise f0Hz must be null — explicitly null, not just falsy');
  assert.ok(Number.isFinite(out.confidence), 'noise confidence must be a finite number');
}

// ── silence → unvoiced, null, and no NaN anywhere ───────────────────
{
  const out = estimateF0(new Float64Array(FRAME), FS);
  assert.equal(out.voiced, false, 'silence must be unvoiced');
  assert.equal(out.f0Hz, null, 'silence f0Hz must be null');
  assert.equal(out.confidence, 0, 'silence confidence must be 0');
  for (const [key, value] of Object.entries(out)) {
    assert.ok(typeof value !== 'number' || !Number.isNaN(value), `silence produced NaN in ${key}`);
  }
  const nsdf = computeNsdf(new Float64Array(FRAME), 300);
  for (let i = 0; i < nsdf.length; i += 1) {
    assert.ok(!Number.isNaN(nsdf[i]), `silence NSDF has NaN at lag ${i}`);
  }
}

// ── octave-error guard: harmonic-rich 120 Hz reads 120, NOT 60 ──────
{
  // Sine + strong harmonics: the classic octave trap. The NSDF of any
  // 120 Hz-periodic signal ALSO peaks at lag 2*T (which reads as 60 Hz), and
  // that double-lag peak can be the global maximum.
  const n = FRAME;
  const rich = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / FS;
    rich[i] = 0.5 * Math.sin(2 * Math.PI * 120 * t)
      + 0.3 * Math.sin(2 * Math.PI * 240 * t + 0.5)
      + 0.15 * Math.sin(2 * Math.PI * 360 * t + 1.1);
  }

  // First prove the failure mode EXISTS: the NSDF value at the double lag
  // (~FS/60) is high enough that a naive global-maximum picker could choose
  // it. Then prove estimateF0 does not.
  const trueLag = Math.round(FS / 120);   // ~133
  const doubleLag = Math.round(FS / 60);  // ~267
  const nsdf = computeNsdf(rich, doubleLag + 2);
  let doublePeak = 0;
  for (let lag = doubleLag - 3; lag <= doubleLag + 3; lag += 1) {
    if (nsdf[lag] > doublePeak) doublePeak = nsdf[lag];
  }
  let truePeak = 0;
  for (let lag = trueLag - 3; lag <= trueLag + 3; lag += 1) {
    if (nsdf[lag] > truePeak) truePeak = nsdf[lag];
  }
  assert.ok(doublePeak > 0.9, `sub-harmonic peak must be a real trap (nsdf ${doublePeak.toFixed(3)} at ~2x lag)`);
  assert.ok(doublePeak >= 0.9 * truePeak,
    'sub-harmonic peak qualifies under the peak-selection ratio — the guard is actually being exercised');

  const out = estimateF0(rich, FS);
  assert.equal(out.voiced, true, 'harmonic-rich 120 Hz must be voiced');
  const relErr120 = Math.abs(out.f0Hz - 120) / 120;
  assert.ok(relErr120 < 0.02, `must detect 120 Hz, got ${out.f0Hz.toFixed(2)} Hz`);
  assert.ok(Math.abs(out.f0Hz - 60) / 60 > 0.5, `must NOT report the 60 Hz sub-harmonic (got ${out.f0Hz.toFixed(2)})`);
}

// ── confidence: clean tone > tone buried in heavy noise ─────────────
{
  const clean = estimateF0(sine(150), FS);
  const rand = makeRand(11);
  const noisy = sine(150);
  for (let i = 0; i < noisy.length; i += 1) noisy[i] += 0.8 * rand(); // SNR ~ 0 dB
  const buried = estimateF0(noisy, FS);
  assert.ok(clean.confidence > buried.confidence,
    `clean confidence ${clean.confidence.toFixed(3)} must exceed noisy ${buried.confidence.toFixed(3)}`);
}

// ── degenerate inputs never throw or NaN ────────────────────────────
{
  for (const frame of [new Float64Array(0), new Float64Array(1), new Float64Array(3), [0.5]]) {
    const out = estimateF0(frame, FS);
    assert.equal(out.voiced, false);
    assert.equal(out.f0Hz, null);
    assert.ok(!Number.isNaN(out.confidence));
  }
  // Bad sample rates degrade to unvoiced, never throw.
  assert.equal(estimateF0(sine(100), 0).voiced, false);
  assert.equal(estimateF0(sine(100), NaN).voiced, false);
}

// ── Float32Array input (the AudioWorklet reality) works identically ─
{
  const f32 = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i += 1) f32[i] = 0.5 * Math.sin((2 * Math.PI * 200 * i) / FS);
  const out = estimateF0(f32, FS);
  assert.equal(out.voiced, true);
  assert.ok(Math.abs(out.f0Hz - 200) / 200 < 0.02, `Float32Array 200 Hz: got ${out.f0Hz}`);
}

console.log('pitch.test.js passed');
