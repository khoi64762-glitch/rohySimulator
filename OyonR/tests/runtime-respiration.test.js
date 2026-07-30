import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

/*
 * Runtime wiring for the respiration and illumination pipelines. The DSP is
 * covered in respiration.test.js; these cases check that the blocks reach the
 * window payload, that each pipeline can run WITHOUT the other, and — the one
 * that actually constrains the design — that respiration keeps the shared ROI
 * sampler alive when heart rate is switched off.
 */

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}
function makeStubCamera() {
  let t = 0;
  return {
    video: { get readyState() { return 2; }, get currentTime() { t += 1; return t; }, videoWidth: 640, videoHeight: 480 },
    async start() {}, stop() {},
  };
}
function stubRespiration() {
  return {
    added: 0,
    addSample() { this.added += 1; },
    estimate() { return { brpm: 14.2, snr: 3, confidence: 0.6, window_seconds: 45, n_samples: 700, fs: 5, method: 'green-lowband' }; },
    status() {
      return {
        buffered: true,
        ready: true,
        progress: 1,
        buffered_seconds: 45,
        min_window_seconds: 25,
        reason: 'measured',
        estimate_state: 'measured',
        confirmation_count: 4,
        confirmation_required: 4,
        sample_rate_hz: 16,
      };
    },
    reset() { this.added = 0; },
  };
}
function stubIllumination(quality = 0.9) {
  return {
    estimate() {
      return {
        mean_luma: 0.45, luma_std: 0.12, clipped_low: 0, clipped_high: 0,
        luma_delta: 0.002, quality, assessment: 'good', valid: true, ts_ms: 1,
      };
    },
    reset() {},
  };
}
const base = { sample_interval_ms: 1000, aggregate_window_ms: 2000, min_valid_frames: 1 };

// ---------- Both flags off: no blocks, no cost ----------
{
  const runtime = new EmotionRuntime({
    settings: { ...base, respiration_enabled: false, illumination_enabled: false },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport: new CapturingTransport(),
  });
  assert.equal(runtime.respirationEnabled, false);
  assert.equal(runtime.respirationEstimator, null);
  assert.equal(runtime.illuminationEnabled, false);
  assert.equal(runtime.illuminationEstimator, null);
}

// ---------- Respiration alone must keep the ROI sampler running ----------
// Heart rate off, respiration on: the sampler is the ONLY source of ROI colour,
// so if it were gated on heart_rate_enabled respiration would silently starve.
{
  const resp = stubRespiration();
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, heart_rate_enabled: false, respiration_enabled: true },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    respirationEstimator: resp,
    roiSampler: () => ({ r: 120, g: 130, b: 110 }),
  });
  assert.equal(runtime.heartRateEnabled, false);
  assert.equal(runtime.heartRateEstimator, null, 'no HR estimator when HR is off');
  assert.ok(runtime.heartRateSampler, 'the ROI sampler must still exist for respiration');
  assert.ok(
    runtime.heartRateSampler.extraEstimators.includes(resp),
    'respiration must be wired as an extra consumer of the ROI stream',
  );

  // start() must start the SHARED sampler even though heart rate is off —
  // keying it on heartRateEnabled left a respiration-only session with a
  // constructed-but-never-started sampler, i.e. no data at all.
  let started = false;
  runtime.heartRateSampler.start = () => { started = true; };
  await runtime.start();
  assert.equal(started, true, 'start() must start the shared ROI sampler for respiration');
  await runtime.stop();

  // Drive the sampler directly (its rAF loop needs a DOM).
  runtime.heartRateSampler.updateFace(
    { facePresent: true, bbox: { x: 0.3, y: 0.3, width: 0.3, height: 0.3 } },
    Date.now(),
  );
  runtime.heartRateSampler.sampleOnce(Date.now());
  assert.ok(resp.added > 0, 'ROI samples must reach the respiration estimator');

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  const windows = transport.batches.flat();
  const withResp = windows.find((w) => w.respiration);
  assert.ok(withResp, 'a respiration block must reach the window payload');
  assert.ok(Math.abs(withResp.respiration.brpm_mean - 14.2) < 1e-6);
  assert.equal(withResp.respiration.model_version, 'respiration-v2');
  assert.equal(withResp.respiration.analysis_window_seconds, 45);
  assert.equal(withResp.heart_rate, undefined, 'no heart-rate block when HR is off');
}

// ---------- Illumination runs without any rPPG pipeline at all ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, heart_rate_enabled: false, respiration_enabled: false, illumination_enabled: true },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    illuminationEstimator: stubIllumination(0.85),
  });
  assert.equal(runtime.illuminationEnabled, true);
  assert.equal(runtime.heartRateSampler, null, 'no ROI sampler needed for lighting');

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  const w = transport.batches.flat().find((x) => x.illumination);
  assert.ok(w, 'an illumination block must reach the window payload');
  assert.ok(Math.abs(w.illumination.quality_mean - 0.85) < 1e-6);
  assert.equal(w.illumination.assessment, 'good');
  assert.equal(w.illumination.model_version, 'illumination-v1');
  assert.ok(w.illumination.stability > 0.9, 'a steady stub must read as stable');
}

// ---------- window_share=false keeps the block off the payload ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, illumination_enabled: true, illumination_window_share: false },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    illuminationEstimator: stubIllumination(),
  });
  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  assert.ok(
    transport.batches.flat().every((w) => w.illumination === undefined),
    'window_share=false must suppress the window block',
  );
}

// ---------- Both blocks pass transport validation ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, heart_rate_enabled: false, respiration_enabled: true, illumination_enabled: true },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
    respirationEstimator: stubRespiration(),
    illuminationEstimator: stubIllumination(),
    roiSampler: () => ({ r: 120, g: 130, b: 110 }),
  });
  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  const batch = transport.batches.flat();
  assert.ok(batch.length > 0);
  const result = validateEmotionBatch({ events: batch });
  assert.equal(result.ok, true, `payload rejected: ${JSON.stringify(result.errors)}`);
}

// ---------- The sample event carries both per-sample streams ----------
{
  const runtime = new EmotionRuntime({
    settings: { ...base, heart_rate_enabled: false, respiration_enabled: true, illumination_enabled: true },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport: new CapturingTransport(),
    respirationEstimator: stubRespiration(),
    illuminationEstimator: stubIllumination(),
    roiSampler: () => ({ r: 120, g: 130, b: 110 }),
  });
  const seen = [];
  runtime.on('sample', (s) => seen.push(s));
  await runtime.sampleOnce();
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0].respiration.brpm - 14.2) < 1e-6);
  assert.equal(seen[0].respiration_status.buffered, true);
  assert.equal(seen[0].respiration_status.estimate_state, 'measured');
  assert.equal(seen[0].respiration_status.confirmation_required, 4);
  assert.equal(seen[0].illumination.assessment, 'good');
}

console.log('runtime-respiration.test.js — all cases passed');
