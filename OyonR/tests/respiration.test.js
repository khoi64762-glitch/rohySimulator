import assert from 'node:assert/strict';
import { RespirationEstimator, meanDecimate, MIN_BRPM, MAX_BRPM } from '../src/analytics/RespirationEstimator.js';
import { IlluminationEstimator, lumaStats, illuminationQuality, illuminationAssessment } from '../src/analytics/IlluminationEstimator.js';
import { IlluminationAggregator } from '../src/aggregation/IlluminationAggregator.js';
import { RespirationAggregator } from '../src/aggregation/RespirationAggregator.js';
import { respirationPhase, respirationStatusText } from '../standalone/app/src/lib/respirationState.js';

/*
 * Respiration + illumination.
 *
 * The respiration cases assert BOTH directions, because only asserting one is
 * what let the original bug ship: every early test fed a signal that contained
 * a real breathing component, so "produces a number" was never distinguished
 * from "produces the right number". The estimator happily reported 26 br/min
 * from white noise and 14.5 from slow lighting drift, both above its gate.
 *
 * So: known rates must be recovered within tolerance, AND signals with no
 * breathing in them (noise, drift, cardiac-only, flat) must yield null across
 * several noise seeds.
 */

/** Feed `seconds` of synthetic ROI colour at `fps`, breathing at `brpm`. */
function feed(est, { brpm, seconds = 60, fps = 16, hrBpm = 72, noise = 0.02, seed = 7 }) {
  let s = seed;
  const rand = () => {
    // Deterministic LCG — Math.random would make failures unreproducible.
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  const t0 = 1_700_000_000_000;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i += 1) {
    const t = i / fps;
    const resp = Math.sin(2 * Math.PI * (brpm / 60) * t);
    const cardiac = 0.4 * Math.sin(2 * Math.PI * (hrBpm / 60) * t);
    const g = 128 + 3 * resp + 1.2 * cardiac + noise * 40 * rand();
    est.addSample({ r: 120, g, b: 110 }, t0 + Math.round(t * 1000));
  }
  return t0 + Math.round((n / fps) * 1000);
}

/** Poll the estimator as the runtime does: feed continuously, estimate often. */
function drive(gen, { seed = 7, seconds = 200, fps = 16, options } = {}) {
  const est = new RespirationEstimator(options);
  let s = seed;
  const rand = () => {
    // Deterministic LCG — Math.random would make failures unreproducible.
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648 - 0.5;
  };
  const t0 = 1_700_000_000_000;
  let out = null;
  let firstAt = null;
  for (let i = 0; i < seconds * fps; i += 1) {
    const t = i / fps;
    const ts = t0 + Math.round(t * 1000);
    est.addSample({ r: 120, g: gen(t, rand), b: 110 }, ts);
    if (i % fps === 0) {
      const o = est.estimate(ts);
      if (o) { out = o; if (firstAt === null) firstAt = t; }
    }
  }
  return { est, out, firstAt };
}

const breathing = (brpm, amp = 3, noise = 0.5) => (t, r) =>
  128 + amp * Math.sin(2 * Math.PI * (brpm / 60) * t) + noise * r();

// --- Recovers a known rate. Tolerance 2 br/min: honest for a 45 s window,
// whose raw bin spacing is ~1.3 br/min before interpolation.
for (const brpm of [10, 12, 14, 18, 20, 24]) {
  const { out } = drive(breathing(brpm));
  assert.ok(out, `no estimate at ${brpm} br/min`);
  assert.ok(
    Math.abs(out.brpm - brpm) <= 2,
    `expected ~${brpm} br/min, got ${out.brpm.toFixed(2)}`,
  );
  assert.ok(out.brpm >= MIN_BRPM && out.brpm <= MAX_BRPM);
  assert.ok(out.confidence > 0 && out.confidence <= 1);
  assert.equal(out.method, 'green-lowband');
  assert.equal(out.rgb_corroboration.enabled, true);
  assert.equal(out.rgb_corroboration.available, true);
  assert.equal(out.rgb_corroboration.agrees, true);
  assert.ok(out.sampling_quality.sample_rate_hz > 10);
}

/*
 * --- MUST NOT present a rate from junk as trusted.
 *
 * This is the case the original tests missed entirely: every one of them fed a
 * signal that DID contain a breathing component, so "it returns a number" was
 * never distinguished from "it returns the right number". Shipped behaviour was
 * that white noise reported 26 br/min at confidence 0.42 and slow lighting
 * drift reported a plausible-looking 14.5 at 0.64 — both above the gate.
 */
const JUNK = {
  'white noise': (t, r) => 128 + 8 * r(),
  'slow lighting drift': (t, r) => 128 + 6 * Math.sin(2 * Math.PI * 0.012 * t) + 0.4 * r(),
  'cardiac only (72 bpm)': (t, r) => 128 + 3 * Math.sin(2 * Math.PI * 1.2 * t) + 0.5 * r(),
  'flat signal': () => 128,
};
for (const [label, gen] of Object.entries(JUNK)) {
  for (const seed of [7, 23, 41, 99, 131]) {
    const { out } = drive(gen, { seed, seconds: 300 });
    assert.ok(
      out == null || out.quality_accepted === false,
      `"${label}" (seed ${seed}) must not yield a trusted rate, got ${out && out.brpm.toFixed(1)} br/min at confidence ${out && out.confidence.toFixed(2)}`,
    );
  }
}

// A true global illumination oscillation scales all channels together. Raw
// green alone cannot distinguish it from physiology, but green's share of RGB
// is constant, so optional strict corroboration rejects it.
{
  const run = (requireRgbCorroboration) => {
    const est = new RespirationEstimator({ requireRgbCorroboration });
    const t0 = 1_700_000_000_000;
    let out = null;
    for (let i = 0; i < 180 * 16; i += 1) {
      const t = i / 16;
      const scale = 1 + 0.06 * Math.sin(2 * Math.PI * (14 / 60) * t);
      const ts = t0 + Math.round(t * 1000);
      est.addSample({ r: 120 * scale, g: 140 * scale, b: 100 * scale }, ts);
      if (i % 16 === 0) out = est.estimate(ts) || out;
    }
    return { est, out };
  };
  const advisory = run(false);
  assert.ok(advisory.out, 'primary green documents the periodic-light ambiguity');
  assert.equal(advisory.out.rgb_corroboration.available, false);
  const strict = run(true);
  assert.ok(strict.out, 'strict RGB mode keeps the candidate visible for audit');
  assert.equal(strict.out.quality_accepted, false, 'strict RGB corroboration marks global illumination cycling untrusted');
}

// Resampling is not permission to manufacture data across an inadequate
// camera stream. Low cadence and a long callback gap are both explicit.
{
  const lowRate = drive(breathing(14), { fps: 1, seconds: 180 });
  assert.equal(lowRate.out, null);
  const status = lowRate.est.status();
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'low_sample_rate');
  assert.equal(status.sampling_adequate, false);
}

{
  const est = new RespirationEstimator();
  const t0 = 1_700_000_000_000;
  let afterGap = null;
  for (let i = 0; i < 60 * 16; i += 1) {
    const t = i / 16;
    const delayed = t >= 30 ? t + 3 : t;
    const ts = t0 + Math.round(delayed * 1000);
    const g = 128 + 3 * Math.sin(2 * Math.PI * (14 / 60) * delayed);
    est.addSample({ r: 120, g, b: 110 }, ts);
    if (i === 30 * 16) afterGap = est.status(ts);
  }
  assert.equal(afterGap.ready, false);
  assert.equal(afterGap.reason, 'sample_gap');
  assert.ok(afterGap.progress < 0.01, 'a gap must restart contiguous acquisition');
  const status = est.status();
  assert.equal(status.ready, true, 'clean video after a gap must recover without waiting for the old gap to age out');
  assert.equal(status.buffered, true);
  assert.ok(status.max_sample_gap_ms < 2000);
  const recovering = est.estimate(t0 + 63_000);
  assert.ok(recovering, 'the first usable breathing candidate must be visible');
  assert.equal(recovering.quality_accepted, false);
  const confirming = est.status(t0 + 63_000);
  assert.equal(confirming.estimate_state, 'confirming');
  assert.equal(confirming.confirmation_count, 1);
  assert.equal(confirming.confirmation_required, 4);
}

// A full buffer and a rejected estimate are never "acquiring". This exact
// state previously rendered as "acquiring — 100%" on Live and Diagnostics.
{
  const rejected = {
    brpm: null,
    buffered: true,
    ready: false,
    progress: 1,
    statusReason: 'low_sample_rate',
    sampleRateHz: 1.2,
  };
  assert.equal(respirationPhase(rejected), 'unconfirmed');
  assert.match(respirationStatusText(rejected), /camera cadence too low/);

  const confirming = {
    ...rejected,
    ready: true,
    statusReason: 'confirming',
    estimateState: 'confirming',
    confirmationCount: 2,
    confirmationRequired: 4,
  };
  assert.equal(respirationPhase(confirming), 'confirming');
  assert.equal(respirationStatusText(confirming), 'confirming rate — 2/4 checks');
}

/*
 * --- DOCUMENTED LIMIT, asserted rather than papered over.
 *
 * A strong, stable, periodic brightness oscillation (an air-conditioner cycle,
 * a flickering display) puts REAL harmonic energy inside 0.1-0.5 Hz. Its peak
 * is a genuine spectral peak that repeats, so neither the SNR test nor the
 * agreement test can reject it — no spectral method can, because by every
 * measure available to this pipeline it IS a periodic signal in the breathing
 * band. Separating it would need a second modality (e.g. chest motion from the
 * pose landmarks).
 *
 * What the plausibility prior does buy: such artifacts land outside the
 * physiological band far more often than real breathing, so they are DELAYED
 * behind extra corroboration. Measured: this artifact first appears at
 * 60-95 s, where real breathing appears at 40 s. That delay is the guarantee,
 * so it is what gets asserted.
 */
{
  const artifact = (t, r) => 128 + 12 * Math.sin(2 * Math.PI * 0.02 * t) + 0.4 * r();
  for (const seed of [7, 23, 41, 99, 131]) {
    const early = drive(artifact, { seed, seconds: 55 });
    assert.equal(
      early.out?.quality_accepted ?? false,
      false,
      `a periodic artifact must not be trusted within 55 s (seed ${seed})`,
    );
  }
  // Real breathing, by contrast, is reported well inside that window.
  const real = drive(breathing(14), { seconds: 55 });
  assert.ok(real.out, 'real breathing must be reported inside 55 s');
  assert.ok(real.firstAt <= 45, `real breathing latency ${real.firstAt}s should be <= 45s`);
}

// --- Real signals survive the same gauntlet of noise seeds.
const REAL = {
  'clean 14': breathing(14),
  'very noisy 14': breathing(14, 0.6, 6),
  'clean 20': breathing(20),
  '10 under heavy drift': (t, r) =>
    128 + 1.5 * Math.sin(2 * Math.PI * (10 / 60) * t) + 8 * Math.sin(2 * Math.PI * 0.012 * t) + 2 * r(),
};
for (const [label, gen] of Object.entries(REAL)) {
  for (const seed of [7, 23, 41, 99, 131]) {
    const { out } = drive(gen, { seed });
    assert.ok(out, `"${label}" (seed ${seed}) must still be detected`);
    assert.equal(out.quality_accepted, true, `"${label}" (seed ${seed}) must become trusted`);
  }
}

// --- The cardiac component must not be read as breathing: 72 bpm is 1.2 Hz,
// far outside the 0.1-0.5 Hz band.
{
  const { out } = drive((t, r) => 128 + 3 * Math.sin(2 * Math.PI * (12 / 60) * t) + 1.5 * Math.sin(2 * Math.PI * 1.2 * t) + 0.5 * r());
  assert.ok(out && out.brpm < 20, `cardiac leak: ${out && out.brpm}`);
}

// --- Nothing before the buffer spans minWindowSeconds: acquisition must read
// as "filling", never as a fabricated rate.
{
  const { est, out } = drive(breathing(15), { seconds: 10 });
  assert.equal(out, null);
  const st = est.status(1_700_000_010_000);
  assert.equal(st.ready, false);
  assert.ok(st.progress > 0 && st.progress < 1);
}

// --- Throttle applies even while estimates are being REJECTED. Guarding it on
// "is there a previous result" made the FFT re-run every sample, so the
// agreement check compared buffers 1 s apart — nearly the same data, trivially
// in agreement — which is how noise passed the gate.
{
  const est = new RespirationEstimator();
  let n = 0;
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < 30 * 16; i += 1) {
    est.addSample({ r: 120, g: 128 + Math.sin(i), b: 110 }, t0 + Math.round((i / 16) * 1000));
  }
  const before = est._lastComputeMs;
  est.estimate(t0 + 30_000);
  const firstCompute = est._lastComputeMs;
  assert.notEqual(firstCompute, before, 'first call must compute');
  est.estimate(t0 + 30_500);
  assert.equal(est._lastComputeMs, firstCompute, 'a call inside the interval must NOT recompute');
  est.estimate(t0 + 36_000);
  assert.notEqual(est._lastComputeMs, firstCompute, 'a call past the interval must recompute');
  void n;
}

// --- Throttle returns the same object between recomputes.
{
  const { est } = drive(breathing(15));
  const a = est.estimate(1_700_000_200_000);
  const b = est.estimate(1_700_000_200_100);
  assert.equal(a, b, 'throttled call must reuse the previous result');
}

// --- Plausibility prior: a genuinely slow breather is still adopted, just
// later. The band exists to make artifacts earn their place, not to censor
// real physiology.
{
  const { out } = drive(breathing(8), { seconds: 300 });
  assert.ok(out, 'a genuine slow rate must eventually be reported');
  assert.ok(Math.abs(out.brpm - 8) <= 2, `expected ~8 br/min, got ${out.brpm.toFixed(1)}`);
}

// --- Disabling the agreement check restores single-shot behaviour (documented
// escape hatch), which is exactly why it must not be the default.
{
  const { out } = drive(breathing(14), { options: { agreementCount: 1 } });
  assert.ok(out, 'agreementCount=1 must still work');
}

// --- The aggregator must CONFIDENCE-WEIGHT its mean, not average blindly.
// A window mixes readings taken under different conditions; an unweighted mean
// lets a barely-trusted estimate pull as hard as a clean one.
{
  const agg = new RespirationAggregator({ windowMs: 1000 });
  agg.consumeFrame({ brpm: 14, confidence: 0.95, snr: 20, window_seconds: 45, method: 'green-lowband' }, 0);
  agg.consumeFrame({ brpm: 25, confidence: 0.12, snr: 6, window_seconds: 45, method: 'green-lowband' }, 500);
  const w = agg.flush(1000);
  assert.ok(w.brpm_mean < 17, `weighted mean should stay near the trusted 14, got ${w.brpm_mean.toFixed(2)}`);
  assert.ok(Math.abs(w.brpm_mean_unweighted - 19.5) < 1e-6, 'the plain mean stays available for audit');
  assert.ok(w.brpm_mean < w.brpm_mean_unweighted, 'weighting must actually move the result');
  assert.ok(w.mean_weight > 0 && w.mean_weight < 1);
}

// Equal confidence must reduce to the plain mean — weighting should not
// distort when there is nothing to discriminate.
{
  const agg = new RespirationAggregator({ windowMs: 1000 });
  agg.consumeFrame({ brpm: 12, confidence: 0.8, snr: 9, window_seconds: 45, method: 'g' }, 0);
  agg.consumeFrame({ brpm: 16, confidence: 0.8, snr: 9, window_seconds: 45, method: 'g' }, 500);
  const w = agg.flush(1000);
  assert.ok(Math.abs(w.brpm_mean - 14) < 1e-9, `expected 14, got ${w.brpm_mean}`);
}

// A low-confidence reading is DOWN-weighted, never dropped: zeroing it would
// make the mean jump discontinuously as readings cross the threshold.
{
  const agg = new RespirationAggregator({ windowMs: 1000 });
  agg.consumeFrame({ brpm: 20, confidence: 0, snr: 1, window_seconds: 45, method: 'g' }, 0);
  const w = agg.flush(1000);
  assert.ok(Number.isFinite(w.brpm_mean), 'a sole low-confidence reading still yields a mean');
  assert.ok(Math.abs(w.brpm_mean - 20) < 1e-9);
}

// meanDecimate keeps the mean and shortens by the factor.
{
  const d = meanDecimate([1, 3, 5, 7, 9, 11], 2);
  assert.deepEqual(d, [2, 6, 10]);
  assert.deepEqual(meanDecimate([1, 2, 3], 1), [1, 2, 3]);
}

/* ── Illumination ─────────────────────────────────────────────────────────── */

/** Build an RGBA buffer of n pixels at a uniform 0..255 grey. */
const grey = (n, v) => {
  const a = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    a[i * 4] = v; a[i * 4 + 1] = v; a[i * 4 + 2] = v; a[i * 4 + 3] = 255;
  }
  return a;
};

{
  const mid = lumaStats(grey(100, 128));
  assert.ok(Math.abs(mid.mean_luma - 128 / 255) < 1e-6);
  assert.ok(mid.luma_std < 1e-6, 'a uniform frame has ~zero spatial spread');
  assert.equal(mid.clipped_low, 0);
  assert.equal(mid.clipped_high, 0);
  assert.equal(illuminationQuality(mid), 1, 'mid grey is a perfect exposure');
  assert.equal(illuminationAssessment(mid), 'good');
}

{
  const dark = lumaStats(grey(100, 10));
  assert.ok(illuminationQuality(dark) < 0.3);
  assert.equal(illuminationAssessment(dark), 'dim');
  const bright = lumaStats(grey(100, 250));
  assert.ok(illuminationQuality(bright) < 0.3);
  assert.equal(illuminationAssessment(bright), 'bright');
}

// Backlit: half the frame crushed, part blown. Mean luma alone reads this as
// acceptable, which is exactly why the clipping test exists.
{
  const a = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i += 1) {
    const v = i < 60 ? 2 : 254;
    a[i * 4] = v; a[i * 4 + 1] = v; a[i * 4 + 2] = v; a[i * 4 + 3] = 255;
  }
  const st = lumaStats(a);
  assert.equal(illuminationAssessment(st), 'backlit');
  assert.ok(illuminationQuality(st) < 0.2, 'clipping must dominate the score');
}

// Luma is perceptual (Rec.709), not a naive RGB mean: pure green is much
// brighter than pure blue at the same channel value.
{
  const chan = (r, g, b) => {
    const a = new Uint8ClampedArray(4);
    a[0] = r; a[1] = g; a[2] = b; a[3] = 255;
    return lumaStats(a).mean_luma;
  };
  assert.ok(chan(0, 255, 0) > chan(0, 0, 255) * 5);
}

// Estimator with an injected sampler — no DOM required.
{
  const est = new IlluminationEstimator({ sampler: () => lumaStats(grey(64, 120)) });
  const first = est.estimate({});
  assert.equal(first.luma_delta, 0, 'the first sample has no predecessor');
  const est2 = new IlluminationEstimator({
    sampler: (() => { let k = 0; return () => lumaStats(grey(64, k++ === 0 ? 60 : 200)); })(),
  });
  est2.estimate({});
  assert.ok(est2.estimate({}).luma_delta > 0.4, 'a brightness jump must surface as delta');
  assert.equal(est.estimate(null) != null, true);
}

// Aggregator: flicker must score as unstable even when the MEAN exposure is
// perfect — the failure mode that wrecks rPPG while looking fine on average.
{
  const agg = new IlluminationAggregator({ windowMs: 1000 });
  const t0 = 1000;
  const steady = new IlluminationAggregator({ windowMs: 1000 });
  for (let i = 0; i < 10; i += 1) {
    const flick = { ...lumaStats(grey(64, i % 2 ? 90 : 165)), luma_delta: 0.29, quality: 1, valid: true };
    agg.consumeFrame(flick, t0 + i * 100);
    steady.consumeFrame({ ...lumaStats(grey(64, 128)), luma_delta: 0.001, quality: 1, valid: true }, t0 + i * 100);
  }
  const flickW = agg.flush(t0 + 1000);
  const steadyW = steady.flush(t0 + 1000);
  assert.equal(flickW.assessment, 'unstable');
  assert.ok(flickW.stability < 0.6);
  assert.equal(steadyW.assessment, 'good');
  assert.ok(steadyW.stability > 0.95);
  // Same mean brightness, opposite verdicts — the point of the field.
  assert.ok(Math.abs(flickW.mean_luma - steadyW.mean_luma) < 0.02);
}

// Empty window is null, not a fabricated zero.
{
  const agg = new IlluminationAggregator({ windowMs: 1000 });
  assert.equal(agg.flush(1000), null);
  agg.consumeFrame(null, 0);
  const w = agg.flush(1000);
  assert.equal(w.valid_frames, 0);
  assert.equal(w.mean_luma, null);
  assert.equal(w.quality_mean, null);
}

console.log('respiration.test.js — all cases passed');
