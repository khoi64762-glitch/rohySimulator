import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { MockPoseTracker } from '../src/mocks/MockPoseTracker.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}
function makeStubCamera() {
  let t = 0;
  return { video: { get readyState() { return 2; }, get currentTime() { t += 1; return t; } }, async start() {}, stop() {} };
}

// ---------- Test 1: flag off — no posture, no poseTracker ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { posture_tracking_enabled: false, sample_interval_ms: 1000, aggregate_window_ms: 2000, min_valid_frames: 1 },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });
  assert.equal(runtime.postureEnabled, false);
  assert.equal(runtime.poseTracker, null);

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  for (const event of transport.batches.flat()) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'posture'), false,
      `flag-off event must not include posture: ${JSON.stringify(Object.keys(event))}`);
  }
}

// ---------- Test 2: flag on, shared — posture block + sample + validator ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      posture_tracking_enabled: true,
      posture_window_share: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    poseTracker: new MockPoseTracker(),
    transport,
  });
  assert.equal(runtime.postureEnabled, true);
  assert.ok(runtime.poseTracker);
  assert.ok(runtime.postureAggregator);

  const samples = [];
  runtime.on('sample', (e) => samples.push(e));

  for (let i = 0; i < 5; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  const postureSamples = samples.map((e) => e.posture).filter(Boolean);
  assert.ok(postureSamples.length > 0, 'posture samples on sample events');
  assert.equal(postureSamples[0].valid, true, 'upright mock pose is valid');
  assert.ok(Number.isFinite(postureSamples[0].shoulder_width_norm), 'per-frame scalar present');

  const postureEvents = transport.batches.flat().filter((e) => e.posture);
  assert.ok(postureEvents.length > 0,
    `expected a window with a posture block; keys=${JSON.stringify(transport.batches.flat().map((e) => Object.keys(e)))}`);
  const p = postureEvents[0].posture;
  assert.ok(Number.isFinite(p.torso_lean_deg_mean) || p.torso_lean_deg_mean === null, 'lean mean shape');
  assert.ok(Number.isFinite(p.valid_frame_ratio), 'valid_frame_ratio numeric');
  assert.equal(typeof p.model_version, 'string');
  // Posture block must not smuggle raw landmark arrays into the window.
  assert.equal(Object.prototype.hasOwnProperty.call(p, 'landmarks'), false, 'no raw landmarks in window');

  const validation = validateEmotionBatch({ events: postureEvents });
  assert.equal(validation.ok, true, `validator rejected posture batch: ${JSON.stringify(validation.errors)}`);
}

console.log('runtime-posture.test.js — all cases passed');
