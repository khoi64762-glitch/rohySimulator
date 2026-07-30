import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}

function makeStubCamera() {
  return { video: { readyState: 2 }, async start() {}, stop() {} };
}

// Blendshapes with real ARKit names so action units are non-zero.
function smileBlendshapes(intensity) {
  return [
    { categoryName: 'mouthSmileLeft', score: intensity },
    { categoryName: 'mouthSmileRight', score: intensity },
    { categoryName: 'jawOpen', score: 0.1 },
  ];
}

// ---------- Test 1: flag off — no facial field, no facialEnabled state ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      facial_signals_enabled: false,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });

  assert.equal(runtime.facialEnabled, false);
  assert.equal(runtime.facialAggregator, null);

  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  const allEvents = transport.batches.flat();
  assert.ok(allEvents.length > 0, 'expected at least one window batch');
  for (const event of allEvents) {
    assert.equal(Object.prototype.hasOwnProperty.call(event, 'facial'), false,
      `flag-off event must not include facial field: ${JSON.stringify(Object.keys(event))}`);
  }
}

// ---------- Test 2: flag on, shared — facial block + sample event + validator ----------
{
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: {
      facial_signals_enabled: true,
      facial_signals_window_share: true,
      sample_interval_ms: 1000,
      aggregate_window_ms: 2000,
      min_valid_frames: 1,
    },
    camera: makeStubCamera(),
    faceTracker: new MockFaceTracker({ mockBlendshapes: smileBlendshapes(0.8) }),
    classifier: new MockEmotionClassifier(),
    transport,
  });

  assert.equal(runtime.facialEnabled, true);
  assert.ok(runtime.facialAggregator);

  const samples = [];
  runtime.on('sample', (event) => samples.push(event));

  for (let i = 0; i < 5; i += 1) await runtime.sampleOnce();
  await runtime.stop();

  // Sample events carry the full per-frame facial signal (all blendshapes).
  const facialSamples = samples.map((e) => e.facial).filter(Boolean);
  assert.ok(facialSamples.length > 0, 'expected facial samples on sample events');
  assert.ok(facialSamples[0].head_pose, 'sample carries head pose');
  assert.ok(Math.abs(facialSamples[0].action_units.smile - 0.8) < 1e-9, 'smile AU surfaced per-frame');
  assert.ok(facialSamples[0].blendshapes.mouthSmileLeft === 0.8, 'raw blendshape exposed per-frame');

  const allEvents = transport.batches.flat();
  const facialEvents = allEvents.filter((e) => e.facial);
  assert.ok(facialEvents.length > 0,
    `expected at least one window with a facial block; keys=${JSON.stringify(allEvents.map((e) => Object.keys(e)))}`);

  const f = facialEvents[0].facial;
  assert.ok(f.head_pose_mean, 'window has head_pose_mean');
  assert.ok(Number.isFinite(f.facing_screen_ratio), 'facing_screen_ratio numeric');
  assert.ok(f.action_units_mean.smile > 0, 'window mean smile > 0');
  assert.ok(f.blendshapes_mean.mouthSmileLeft > 0, 'window exposes averaged blendshapes');

  // Validator accepts the facial-bearing batch (facial block is not censored).
  const validation = validateEmotionBatch({ events: facialEvents });
  assert.equal(validation.ok, true,
    `validator rejected facial batch: ${JSON.stringify(validation.errors)}`);
}

console.log('runtime-facial.test.js — all cases passed');
