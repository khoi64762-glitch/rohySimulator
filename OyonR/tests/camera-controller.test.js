import assert from 'node:assert/strict';
import { CameraController } from '../src/capture/CameraController.js';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

let callback = null;
let callbackId = 0;
let cancelled = null;
let stopped = false;
let applied = null;

const track = {
  stop() { stopped = true; },
  getSettings() {
    return {
      width: 1280,
      height: 720,
      frameRate: 30,
      facingMode: 'user',
      deviceId: 'must-not-leak',
      groupId: 'must-not-leak-either',
    };
  },
  getCapabilities() {
    return {
      frameRate: { min: 5, max: 60 },
      focusMode: ['manual', 'continuous'],
    };
  },
  getConstraints() { return { frameRate: { ideal: 30 } }; },
  async applyConstraints(value) { applied = value; },
};
const stream = {
  getTracks: () => [track],
  getVideoTracks: () => [track],
};
const video = {
  playsInline: false,
  muted: false,
  autoplay: false,
  srcObject: null,
  async play() {},
  requestVideoFrameCallback(fn) { callback = fn; callbackId += 1; return callbackId; },
  cancelVideoFrameCallback(id) { cancelled = id; },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { mediaDevices: { async getUserMedia() { return stream; } } },
});
Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement(tag) { assert.equal(tag, 'video'); return video; } },
});

try {
  const camera = new CameraController();
  const startedVideo = await camera.start();
  assert.equal(startedVideo, video);
  assert.equal(camera.getVideoTrack(), track);
  assert.equal(camera.getSettings().frame_rate, 30);
  assert.equal(camera.getSettings().device_id, undefined, 'device id must not leave the controller');
  assert.equal(camera.getCapabilities().frame_rate.max, 60);

  callback(0, { presentedFrames: 1, mediaTime: 0, width: 1280, height: 720 });
  callback(33, { presentedFrames: 2, mediaTime: 0.033, width: 1280, height: 720 });
  callback(100, { presentedFrames: 4, mediaTime: 0.1, width: 1280, height: 720 });

  const first = camera.getDiagnostics({ resetWindow: true });
  assert.equal(first.available, true);
  assert.equal(first.timing.source, 'requestVideoFrameCallback');
  assert.equal(first.timing.window.frames_observed, 3);
  assert.equal(first.timing.window.estimated_dropped_frames, 1);
  assert.equal(first.timing.window.drop_estimate_source, 'selected_frame_rate');
  assert.ok(first.timing.window.observed_fps > 19 && first.timing.window.observed_fps < 21);
  assert.equal(first.timing.frame_width, 1280);
  assert.equal(first.timing.presented_frames, 4);

  const reset = camera.getDiagnostics();
  assert.equal(reset.timing.window.frames_observed, 0);
  assert.equal(reset.timing.lifetime.frames_observed, 3);

  // Some browser/camera combinations expose huge presentedFrames jumps that
  // cannot fit into the elapsed time. The selected-FPS estimate must bound
  // those discontinuities instead of reporting a fictitious ~100% loss.
  callback(133, { presentedFrames: 4000, mediaTime: 0.133, width: 1280, height: 720 });
  callback(166, { presentedFrames: 8000, mediaTime: 0.166, width: 1280, height: 720 });
  const discontinuous = camera.getDiagnostics({ resetWindow: true });
  assert.equal(discontinuous.timing.window.frames_observed, 2);
  assert.equal(discontinuous.timing.window.estimated_dropped_frames, 0);
  assert.equal(discontinuous.timing.window.drop_ratio, 0);

  const settings = await camera.applyVideoConstraints({ frameRate: { ideal: 24 } });
  assert.deepEqual(applied, { frameRate: { ideal: 24 } });
  assert.equal(settings.width, 1280);

  const pendingId = callbackId;
  camera.stop();
  assert.equal(cancelled, pendingId);
  assert.equal(stopped, true);
  assert.equal(video.srcObject, null);
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete globalThis.navigator;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
}

console.log('camera-controller.test.js — all cases passed');
