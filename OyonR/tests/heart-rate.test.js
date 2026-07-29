import assert from 'node:assert/strict';
import { HeartRateEstimator, resampleUniform } from '../src/analytics/HeartRateEstimator.js';
import { HeartRateAggregator } from '../src/aggregation/HeartRateAggregator.js';
import { powerSpectrum, nextPow2, fftRadix2 } from '../src/analytics/fft.js';

// ── FFT sanity ──────────────────────────────────────────────────────
{
  assert.equal(nextPow2(300), 512);
  assert.equal(nextPow2(16), 16);

  // Pure cosine at bin 8 of a 64-point FFT → power peak at bin 8.
  const N = 64;
  const bin = 8;
  const sig = new Float64Array(N);
  for (let i = 0; i < N; i += 1) sig[i] = Math.cos((2 * Math.PI * bin * i) / N);
  const ps = powerSpectrum(sig);
  let peak = 1;
  for (let i = 1; i < ps.length; i += 1) if (ps[i] > ps[peak]) peak = i;
  assert.equal(peak, bin, `cosine peak at bin ${bin}, got ${peak}`);

  // In-place FFT length guard.
  assert.throws(() => fftRadix2(new Float64Array(3), new Float64Array(3)),
    /power of two/, 'non-pow2 length throws');
}

// Synthetic rPPG: green channel pulsing at a known BPM, with optional heavy
// baseline drift (respiration + wander) layered on top.
function drive(estimator, bpm, { fs = 30, seconds = 10, pulseOnGreenOnly = true, drift = 0.2 } = {}) {
  const f = bpm / 60;
  const n = Math.round(fs * seconds);
  const dtMs = 1000 / fs;
  const base = 5_000_000;
  for (let i = 0; i < n; i += 1) {
    const t = i / fs;
    const pulse = 2 * Math.sin(2 * Math.PI * f * t);
    // Respiration ~0.25 Hz + slow linear wander, both scaled by `drift`.
    const wander = drift * (10 * Math.sin(2 * Math.PI * 0.25 * t) + 8 * (t / seconds));
    const g = 128 + pulse + wander;
    const r = pulseOnGreenOnly ? 100 : 100 + pulse * 0.5;
    const b = 120;
    estimator.addSample({ r, g, b }, base + i * dtMs);
  }
}

// ── green method recovers a known BPM (tight, thanks to interpolation) ─
{
  const est = new HeartRateEstimator({ method: 'green', bufferSeconds: 12 });
  drive(est, 72);
  const out = est.estimate();
  assert.ok(out, 'estimate produced');
  assert.ok(Math.abs(out.bpm - 72) < 3, `green BPM ~72 (got ${out.bpm.toFixed(1)})`);
  assert.ok(out.fs > 25 && out.fs < 35, `fs ~30 (got ${out.fs.toFixed(1)})`);
  assert.ok(out.snr > 1, `peak stands out (snr ${out.snr})`);
  assert.ok(out.confidence >= 0 && out.confidence <= 1, 'confidence in [0,1]');
  assert.equal(out.method, 'green');
}

// ── POS method recovers a known BPM ─────────────────────────────────
{
  const est = new HeartRateEstimator({ method: 'pos', bufferSeconds: 12 });
  drive(est, 90);
  const out = est.estimate();
  assert.ok(out, 'POS estimate produced');
  assert.ok(Math.abs(out.bpm - 90) < 3, `POS BPM ~90 (got ${out.bpm.toFixed(1)})`);
  assert.equal(out.method, 'pos');
}

// ── drift rejection: heavy baseline wander must NOT pin BPM at the band floor ─
{
  const est = new HeartRateEstimator({ method: 'green', bufferSeconds: 12 });
  drive(est, 66, { drift: 6 }); // respiration/wander >> pulse amplitude
  const out = est.estimate();
  assert.ok(out, 'estimate under heavy drift');
  assert.ok(Math.abs(out.bpm - 66) < 5,
    `BPM stays on the 66 pulse under heavy drift, not stuck low (got ${out.bpm.toFixed(1)})`);
}

// ── low sample rate still recovers (coarser, interpolated) ──────────
{
  const est = new HeartRateEstimator({ method: 'green', bufferSeconds: 12 });
  drive(est, 78, { fs: 10, seconds: 12 });
  const out = est.estimate();
  assert.ok(out, 'estimate at 10 fps');
  assert.ok(Math.abs(out.bpm - 78) < 6, `10fps BPM ~78 (got ${out.bpm.toFixed(1)})`);
}

// Phase-continuous feed so appended chunks stay coherent across calls.
function feed(est, bpm, { fs = 30, count, startMs, drift = 0.2 } = {}) {
  const f = bpm / 60;
  const dt = 1000 / fs;
  let lastTs = startMs;
  for (let i = 0; i < count; i += 1) {
    const ts = startMs + i * dt;
    const t = ts / 1000;
    const pulse = 2 * Math.sin(2 * Math.PI * f * t);
    const wander = drift * 10 * Math.sin(2 * Math.PI * 0.25 * t);
    est.addSample({ r: 100, g: 128 + pulse + wander, b: 120 }, ts);
    lastTs = ts;
  }
  return lastTs;
}

// ── minimum-window gate: no BPM before minWindowSeconds of signal ───
{
  const est = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8, minSamples: 10 });
  feed(est, 72, { fs: 30, count: 150, startMs: 1_000_000 }); // 5 s span < 8 s
  assert.equal(est.estimate(), null, 'no estimate before minWindowSeconds, even with samples');
  const st = est.status();
  assert.equal(st.ready, false, 'status not ready while acquiring');
  assert.ok(st.progress < 1 && st.progress > 0, `progress in (0,1): ${st.progress}`);
  assert.ok(st.span_seconds < 8, 'span below minimum');
}

// ── throttle: one estimate per updateIntervalMs; window_seconds reported ─
{
  const est = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8, updateIntervalMs: 1000 });
  const last1 = feed(est, 72, { fs: 30, count: 300, startMs: 2_000_000 }); // 10 s
  const a = est.estimate();
  assert.ok(a, 'estimate after enough window');
  assert.ok(a.window_seconds >= 8, `window_seconds reported (${a.window_seconds})`);
  const b = est.estimate();
  assert.strictEqual(b, a, 'throttled: same object returned within updateIntervalMs (no new samples)');

  // Advance ~1.5 s of fresh samples so the throttle window expires.
  feed(est, 72, { fs: 30, count: 45, startMs: last1 + 1000 / 30 });
  const c = est.estimate();
  assert.notStrictEqual(c, a, 'recomputed after updateIntervalMs elapsed');
  assert.ok(Math.abs(c.bpm - 72) < 3, `still ~72 after update (got ${c.bpm.toFixed(1)})`);
  assert.equal(est.status().ready, true, 'status ready once buffer is full');
}

// ── irregular (jittered) frame timing still recovers BPM ────────────
// The real webcam condition: frames arrive at uneven intervals. Sample VALUES
// follow the true pulse at each (irregular) instant; the estimator must resample
// onto a uniform grid before the FFT or the peak shifts.
{
  const est = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8 });
  const bpm = 88;
  const f = bpm / 60;
  const baseDt = 1000 / 15; // ~15 fps mean
  let ts = 3_500_000;
  const end = ts + 12_000;
  let i = 0;
  while (ts < end) {
    const t = ts / 1000;
    const pulse = 2 * Math.sin(2 * Math.PI * f * t);
    const wander = 2 * Math.sin(2 * Math.PI * 0.25 * t);
    est.addSample({ r: 100, g: 128 + pulse + wander, b: 120 }, ts);
    const jitter = 1 + 0.5 * Math.sin(i * 1.7); // deterministic ±50% dt swing
    ts += baseDt * Math.max(0.3, jitter);
    i += 1;
  }
  const out = est.estimate();
  assert.ok(out, 'estimate under jittered timing');
  assert.ok(Math.abs(out.bpm - bpm) < 4,
    `jittered-timing BPM ~88 after uniform resampling (got ${out.bpm.toFixed(1)})`);
}

// ── resampleUniform behaves ─────────────────────────────────────────
{
  // Uniform input → unchanged.
  const t = [0, 1, 2, 3];
  const v = [0, 10, 20, 30];
  const r = resampleUniform(t, v);
  for (let i = 0; i < v.length; i += 1) assert.ok(Math.abs(r[i] - v[i]) < 1e-9, 'uniform passthrough');
  // Irregular input → interpolated onto a uniform grid.
  const r2 = resampleUniform([0, 0.1, 2], [0, 5, 20]);
  assert.equal(r2.length, 3);
  assert.ok(Math.abs(r2[0] - 0) < 1e-9 && Math.abs(r2[2] - 20) < 1e-9, 'endpoints preserved');
  assert.ok(r2[1] > 0 && r2[1] < 20, 'midpoint interpolated onto uniform grid');
}

// ── octave-error correction: spurious sub-harmonic must NOT win ─────
// Real scenario from a live capture: HR ~90, but a spurious component at 45
// (half) is the tallest single bin, so the raw peak reads 45. The true
// fundamental at 90 carries real harmonics (180, 270); HPS must recover 90.
{
  const est = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8 });
  const fs = 20;
  const dt = 1000 / fs;
  const n = fs * 12;
  const startMs = 4_200_000;
  const A45 = 2.0;  // spurious sub-harmonic — largest single amplitude
  const A90 = 1.6;  // true fundamental
  const A180 = 1.2; // its 2nd harmonic
  const A270 = 0.9; // its 3rd harmonic
  for (let i = 0; i < n; i += 1) {
    const ts = startMs + i * dt;
    const t = ts / 1000;
    const g = 128
      + A45 * Math.sin(2 * Math.PI * (45 / 60) * t)
      + A90 * Math.sin(2 * Math.PI * (90 / 60) * t)
      + A180 * Math.sin(2 * Math.PI * (180 / 60) * t)
      + A270 * Math.sin(2 * Math.PI * (270 / 60) * t);
    est.addSample({ r: 100, g, b: 120 }, ts);
  }
  const out = est.estimate();
  assert.ok(out, 'octave-error estimate produced');
  assert.ok(Math.abs(out.bpm - 90) < 5,
    `HPS recovers true 90 despite tallest bin at 45 (got ${out.bpm.toFixed(1)})`);
}

// ── genuine low HR is NOT falsely doubled ───────────────────────────
// A real 48 BPM fundamental (with its own harmonics) must stay ~48, not jump to 96.
{
  const est = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8, minBpm: 40 });
  const fs = 20;
  const dt = 1000 / fs;
  const n = fs * 12;
  const startMs = 4_400_000;
  for (let i = 0; i < n; i += 1) {
    const ts = startMs + i * dt;
    const t = ts / 1000;
    const g = 128
      + 2.0 * Math.sin(2 * Math.PI * (48 / 60) * t)   // fundamental
      + 0.8 * Math.sin(2 * Math.PI * (96 / 60) * t)   // weak 2nd harmonic
      + 0.4 * Math.sin(2 * Math.PI * (144 / 60) * t); // weak 3rd harmonic
    est.addSample({ r: 100, g, b: 120 }, ts);
  }
  const out = est.estimate();
  assert.ok(Math.abs(out.bpm - 48) < 5,
    `genuine 48 BPM stays ~48, not doubled (got ${out.bpm.toFixed(1)})`);
}

// ── window median is robust to a bimodal 44/88 flip ─────────────────
{
  const agg = new HeartRateAggregator({ windowMs: 10000, sampleIntervalMs: 1000 });
  const base = 7_000_000;
  const seq = [88, 44, 88, 88, 44, 88, 88]; // mostly 88 with sub-harmonic outliers
  for (let i = 0; i < seq.length; i += 1) {
    agg.consumeFrame({ bpm: seq[i], snr: 4, confidence: 0.4, window_seconds: 10, method: 'green' }, base + i * 1000);
  }
  const w = agg.flush(base + seq.length * 1000);
  assert.equal(w.bpm_median, 88, `median rejects the 44 outliers (got ${w.bpm_median})`);
  assert.ok(w.bpm_mean < w.bpm_median, 'mean is dragged down by outliers, median is not');
}

// ── confidence threshold marks an unsure estimate without deleting it ─────
{
  // Deterministic broadband pseudo-noise → no dominant spectral peak → low SNR.
  const build = (start, fs, n) => {
    let seed = 12345;
    const out = [];
    const dt = 1000 / fs;
    for (let i = 0; i < n; i += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out.push({ r: 100, g: 128 + 4 * (seed / 0x7fffffff - 0.5), b: 120, ts: start + i * dt });
    }
    return out;
  };
  const samples = build(9_000_000, 20, 240);
  const lax = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8, minConfidence: 0 });
  for (const s of samples) lax.addSample({ r: s.r, g: s.g, b: s.b }, s.ts);
  const l = lax.estimate();
  assert.ok(l, 'permissive estimator returns even a low-confidence estimate');
  const strict = new HeartRateEstimator({ method: 'green', minWindowSeconds: 8, minConfidence: Math.min(1, l.confidence + 0.05) });
  for (const s of samples) strict.addSample({ r: s.r, g: s.g, b: s.b }, s.ts);
  const marked = strict.estimate();
  assert.ok(marked, 'a weak but computable heart-rate candidate must remain visible');
  assert.equal(marked.quality_accepted, false,
    `confidence threshold marks the unsure estimate (conf was ${l.confidence.toFixed(2)})`);
  assert.ok(Math.abs(marked.bpm - l.bpm) < 1e-9, 'quality metadata must not alter the candidate value');
}

// ── too few samples → null ──────────────────────────────────────────
{
  const est = new HeartRateEstimator({ minSamples: 32 });
  est.addSample({ r: 100, g: 128, b: 120 }, 1000);
  est.addSample({ r: 100, g: 128, b: 120 }, 1033);
  assert.equal(est.estimate(), null, 'insufficient buffer → null');
}

// ── buffer trims to bufferSeconds ───────────────────────────────────
{
  const est = new HeartRateEstimator({ bufferSeconds: 2 });
  for (let i = 0; i < 200; i += 1) est.addSample({ r: 100, g: 128, b: 120 }, 1000 + i * 33);
  // 2s at ~30fps ≈ 60 samples retained, not 200.
  assert.ok(est.samples.length < 80, `buffer trimmed (${est.samples.length} samples)`);
}

// ── HeartRateAggregator ─────────────────────────────────────────────
{
  const agg = new HeartRateAggregator({ windowMs: 10000, sampleIntervalMs: 1000 });
  const base = 6_000_000;
  agg.consumeFrame(null, base);                                   // buffer warming
  agg.consumeFrame({ bpm: 70, snr: 5, confidence: 0.5, method: 'pos' }, base + 1000);
  agg.consumeFrame({ bpm: 74, snr: 6, confidence: 0.6, method: 'pos' }, base + 2000);
  const w = agg.flush(base + 3000);
  assert.ok(w, 'flush → window');
  assert.equal(w.total_frames, 3);
  assert.equal(w.valid_frames, 2);
  assert.ok(Math.abs(w.bpm_mean - 72) < 1e-9, 'bpm mean = 72');
  assert.equal(w.bpm_last, 74, 'bpm last = 74');
  assert.ok(w.bpm_std > 0, 'bpm std > 0');
  assert.equal(w.method, 'pos');
  assert.equal(typeof w.model_version, 'string');
  assert.equal(new HeartRateAggregator().flush(), null, 'empty flush → null');
}

console.log('heart-rate.test.js — all cases passed');
