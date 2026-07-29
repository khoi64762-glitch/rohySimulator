import assert from 'node:assert/strict';
import {
  hannWindow,
  applyWindow,
  frameEnergy,
  spectralFeatures,
  analyzeFrame,
  CLIP_THRESHOLD,
} from '../src/analytics/voiceFeatures.js';
import { nextPow2 } from '../src/analytics/fft.js';

/*
 * Per-frame voice features against signals with hand-computable answers:
 * exact RMS/peak for DC and sines, exact clip and zero-crossing counts, and
 * spectral centroid/roll-off pinned by tones at known frequencies — including
 * a non-power-of-two frame, where the bin→Hz mapping MUST use the padded FFT
 * length (nextPow2), not the frame length.
 */

const FS = 16000;

function sine(freq, { n = 1024, fs = FS, amplitude = 0.5 } = {}) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / fs);
  return out;
}

// ── hannWindow: endpoints, sum, midpoint symmetry, cache identity ──
{
  const w = hannWindow(64);
  assert.equal(w.length, 64);
  assert.equal(w[0], 0, 'symmetric Hann starts at 0');
  assert.ok(Math.abs(w[63]) < 1e-12, 'symmetric Hann ends at 0');
  // Sum of the symmetric Hann of length n is (n-1)/2: 0.5*n minus the cosine
  // sum, which telescopes to 1 over one full period plus the repeated endpoint.
  let sum = 0;
  for (let i = 0; i < w.length; i += 1) sum += w[i];
  assert.ok(Math.abs(sum - 31.5) < 1e-9, `hann(64) sum ${sum} != 31.5`);
  // Symmetry: w[i] === w[n-1-i].
  for (let i = 0; i < 32; i += 1) {
    assert.ok(Math.abs(w[i] - w[63 - i]) < 1e-12, `hann not symmetric at ${i}`);
  }
  // Cache proof: same array identity on a second call.
  assert.equal(hannWindow(64), w, 'hannWindow(64) must return the cached instance');
  assert.notEqual(hannWindow(128), w, 'different length is a different window');
  // n=1 degenerate window.
  assert.deepEqual(Array.from(hannWindow(1)), [1]);
  assert.throws(() => hannWindow(0));
}

// ── applyWindow: element-wise product, inputs untouched ────────────
{
  const frame = Float64Array.from([1, 2, 3, 4]);
  const win = Float64Array.from([0, 0.5, 0.5, 1]);
  const out = applyWindow(frame, win);
  assert.ok(out instanceof Float64Array);
  assert.deepEqual(Array.from(out), [0, 1, 1.5, 4]);
  assert.deepEqual(Array.from(frame), [1, 2, 3, 4], 'frame must not be mutated');
  assert.throws(() => applyWindow(frame, new Float64Array(3)), /length mismatch/);
}

// ── frameEnergy: exact hand-computed RMS and peak ──────────────────
{
  // DC at 0.5: rms = 0.5, peak = 0.5, zero crossings = 0.
  const dc = new Float64Array(100).fill(0.5);
  const e = frameEnergy(dc);
  assert.equal(e.rms, 0.5);
  assert.equal(e.peak, 0.5);
  assert.equal(e.clippedSamples, 0);
  assert.equal(e.zeroCrossingRate, 0);

  // Full-cycle sine of amplitude 0.8: rms = 0.8/sqrt(2), peak <= 0.8.
  const n = 1600; // exactly 10 cycles of 100 Hz at 16 kHz → rms is exact
  const s = sine(100, { n, amplitude: 0.8 });
  const es = frameEnergy(s);
  assert.ok(Math.abs(es.rms - 0.8 / Math.SQRT2) < 1e-9,
    `sine rms ${es.rms} != ${0.8 / Math.SQRT2}`);
  assert.ok(Math.abs(es.peak - 0.8) < 1e-3, `sine peak ${es.peak} != ~0.8`);
  assert.equal(es.clippedSamples, 0);

  // Empty frame: all zeros, no NaN.
  const empty = frameEnergy(new Float64Array(0));
  assert.deepEqual(empty, { rms: 0, peak: 0, clippedSamples: 0, zeroCrossingRate: 0 });
}

// ── clippedSamples counts deliberate clipping exactly ──────────────
{
  const frame = Float64Array.from([0.1, 1.0, -1.0, CLIP_THRESHOLD, 0.9989, -0.5, 1.2]);
  // At/beyond ±0.999: 1.0, -1.0, 0.999, 1.2 → 4. (0.9989 is just below.)
  assert.equal(frameEnergy(frame).clippedSamples, 4);
}

// ── zeroCrossingRate on a known square wave ────────────────────────
{
  // 64 samples in blocks of 4: +1 x4, -1 x4, ... → 16 blocks, a sign change at
  // each of the 15 block boundaries, over 63 intervals.
  const sq = new Float64Array(64);
  for (let i = 0; i < 64; i += 1) sq[i] = Math.floor(i / 4) % 2 === 0 ? 1 : -1;
  const e = frameEnergy(sq);
  assert.equal(e.zeroCrossingRate, 15 / 63, `square ZCR ${e.zeroCrossingRate} != ${15 / 63}`);
  assert.equal(e.rms, 1);
  assert.equal(e.peak, 1);
}

// ── spectralFeatures: 1 kHz tone lands on bin 64 of a 1024 FFT ─────
{
  // 1000 Hz at 16 kHz with n = 1024: bin = 1000/16000*1024 = 64 exactly, so
  // leakage is limited to the Hann main lobe (symmetric around the bin) and
  // the centroid must sit within 1% of 1000 Hz.
  const { centroidHz, rolloffHz, spectrum } = spectralFeatures(sine(1000), FS);
  assert.ok(Math.abs(centroidHz - 1000) < 10,
    `1 kHz tone centroid ${centroidHz} outside 1000±10 Hz`);
  assert.ok(rolloffHz >= 984.375 - 2 * (FS / 1024) && rolloffHz <= 1000 + 2 * (FS / 1024),
    `1 kHz tone roll-off ${rolloffHz} not within 2 bins of the tone`);
  assert.equal(spectrum.length, 1024 / 2 + 1, 'one-sided spectrum length');
  // Spectral peak bin must be exactly 64 — this pins binHz = i*fs/n with n the
  // padded FFT length.
  let peakBin = 0;
  for (let i = 1; i < spectrum.length; i += 1) if (spectrum[i] > spectrum[peakBin]) peakBin = i;
  assert.equal(peakBin, 64, `1 kHz peak bin ${peakBin} != 64 — bin→Hz mapping is wrong`);
}

// ── centroid ordering: 4 kHz tone > 500 Hz tone ────────────────────
{
  const low = spectralFeatures(sine(500), FS).centroidHz;
  const high = spectralFeatures(sine(4000), FS).centroidHz;
  assert.ok(high > low, `centroid(4 kHz)=${high} must exceed centroid(500 Hz)=${low}`);
  assert.ok(Math.abs(low - 500) < 30, `500 Hz centroid ${low} off`);
  assert.ok(Math.abs(high - 4000) < 60, `4 kHz centroid ${high} off`);
}

// ── roll-off is monotone in rolloffFraction ────────────────────────
{
  // Broadband-ish signal: two tones + deterministic noise.
  let s = 1234;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  const frame = new Float64Array(1024);
  for (let i = 0; i < 1024; i += 1) {
    frame[i] = 0.4 * Math.sin((2 * Math.PI * 500 * i) / FS)
      + 0.3 * Math.sin((2 * Math.PI * 3000 * i) / FS)
      + 0.1 * rand();
  }
  let prev = -Infinity;
  for (const fraction of [0.25, 0.5, 0.75, 0.85, 0.95, 0.99]) {
    const { rolloffHz } = spectralFeatures(frame, FS, { rolloffFraction: fraction });
    assert.ok(rolloffHz >= prev,
      `roll-off must be monotone in fraction: f=${fraction} gave ${rolloffHz} < ${prev}`);
    prev = rolloffHz;
  }
}

// ── non-power-of-two frame works (powerSpectrum zero-pads) ─────────
{
  // 1000-sample frame pads to 1024; the bin→Hz denominator must be 1024. A
  // 2000 Hz tone then peaks at bin round(2000/16000*1024) = 128.
  const frame = sine(2000, { n: 1000 });
  assert.equal(nextPow2(1000), 1024);
  const { centroidHz, spectrum } = spectralFeatures(frame, FS);
  assert.equal(spectrum.length, 513, 'padded to 1024 → 513 one-sided bins');
  let peakBin = 0;
  for (let i = 1; i < spectrum.length; i += 1) if (spectrum[i] > spectrum[peakBin]) peakBin = i;
  assert.equal(peakBin, 128, `2 kHz in a 1000-sample frame must peak at bin 128 of the PADDED FFT, got ${peakBin}`);
  // Truncation + zero-padding leak more than an exact-bin tone: 5% tolerance.
  assert.ok(Math.abs(centroidHz - 2000) / 2000 < 0.05,
    `non-pow2 centroid ${centroidHz} more than 5% from 2000`);
}

// ── silence: spectral shape is null, never NaN or 0 ────────────────
{
  const { centroidHz, rolloffHz } = spectralFeatures(new Float64Array(512), FS);
  assert.equal(centroidHz, null, 'silent frame centroid must be null');
  assert.equal(rolloffHz, null, 'silent frame roll-off must be null');
}

// ── analyzeFrame: no NaN for silence, empty, or single sample ──────
{
  const cases = [
    ['silence', new Float64Array(512)],
    ['empty', new Float64Array(0)],
    ['single sample', Float64Array.from([0.3])],
  ];
  for (const [label, frame] of cases) {
    const out = analyzeFrame(frame, FS);
    for (const [key, value] of Object.entries(out)) {
      assert.ok(typeof value !== 'number' || !Number.isNaN(value),
        `analyzeFrame(${label}) produced NaN in ${key}`);
    }
    assert.equal(out.voiced, false, `${label} must be unvoiced`);
    assert.equal(out.f0Hz, null, `${label} f0Hz must be null`);
  }
}

// ── analyzeFrame on a real tone: whole record coherent ─────────────
{
  const out = analyzeFrame(sine(220, { n: 2048, amplitude: 0.6 }), FS);
  assert.ok(Math.abs(out.rms - 0.6 / Math.SQRT2) < 1e-3);
  assert.ok(Math.abs(out.peak - 0.6) < 1e-3);
  assert.equal(out.clippedSamples, 0);
  assert.ok(out.zeroCrossingRate > 0);
  assert.ok(Math.abs(out.centroidHz - 220) < 30, `220 Hz centroid ${out.centroidHz}`);
  assert.equal(out.voiced, true);
  assert.ok(Math.abs(out.f0Hz - 220) / 220 < 0.02, `220 Hz f0 ${out.f0Hz}`);
  assert.ok(out.f0Confidence > 0.9);
  // Options forward: a tighter pitch range that excludes 220 Hz → unvoiced.
  const excluded = analyzeFrame(sine(220, { n: 2048 }), FS, { minHz: 300, maxHz: 400 });
  assert.equal(excluded.f0Hz, null, 'pitch options must reach estimateF0');
}

console.log('voice-features.test.js passed');
