import assert from 'node:assert/strict';
import { EmotionRuntime } from '../src/core/EmotionRuntime.js';
import { MockFaceTracker } from '../src/mocks/MockFaceTracker.js';
import { MockEmotionClassifier } from '../src/mocks/MockEmotionClassifier.js';
import { validateEmotionBatch } from '../src/validation/validateEmotionPayload.js';

class CapturingTransport {
  constructor() { this.batches = []; }
  async send(events) { this.batches.push(events); }
}

function diagnosticCamera() {
  let currentTime = 0;
  return {
    calls: 0,
    video: {
      readyState: 2,
      get currentTime() { currentTime += 1; return currentTime; },
      videoWidth: 640,
      videoHeight: 480,
    },
    async start() {},
    stop() {},
    getDiagnostics({ resetWindow = false } = {}) {
      this.calls += 1;
      const summary = {
        frames_observed: resetWindow ? 60 : 0,
        estimated_dropped_frames: 2,
        drop_ratio: 2 / 62,
        observed_fps: 30,
        frame_interval_ms_mean: 33.3,
        frame_interval_ms_std: 1.2,
        max_frame_gap_ms: 41,
        span_ms: 2000,
      };
      return {
        available: true,
        settings: { width: 640, height: 480, frame_rate: 30 },
        constraints: null,
        capabilities: { frame_rate: { min: 5, max: 60 } },
        timing: {
          source: 'requestVideoFrameCallback',
          window: summary,
          lifetime: { ...summary, frames_observed: 120, span_ms: 4000 },
          callback_age_ms: 4,
          media_time_ms: 4000,
          presented_frames: 122,
          frame_width: 640,
          frame_height: 480,
        },
      };
    },
  };
}

const base = {
  sample_interval_ms: 1000,
  aggregate_window_ms: 2000,
  min_valid_frames: 1,
  illumination_enabled: false,
};

{
  const camera = diagnosticCamera();
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, capture_quality_enabled: true },
    camera,
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });
  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  const windows = transport.batches.flat();
  const captured = windows.find(window => window.capture_quality);
  assert.ok(captured, 'camera diagnostics must ride with an emotion window');
  assert.equal(captured.capture_quality.settings.frame_rate, 30);
  assert.equal(captured.capture_quality.timing.window.estimated_dropped_frames, 2);
  assert.ok(camera.calls > 0);
  const validation = validateEmotionBatch({ events: windows });
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
}

{
  const camera = diagnosticCamera();
  const transport = new CapturingTransport();
  const runtime = new EmotionRuntime({
    settings: { ...base, capture_quality_enabled: false },
    camera,
    faceTracker: new MockFaceTracker(),
    classifier: new MockEmotionClassifier(),
    transport,
  });
  for (let i = 0; i < 4; i += 1) await runtime.sampleOnce();
  await runtime.stop();
  assert.equal(camera.calls, 0);
  assert.ok(transport.batches.flat().every(window => window.capture_quality === undefined));
}

console.log('runtime-capture-quality.test.js — all cases passed');
