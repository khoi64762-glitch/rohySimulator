import assert from 'node:assert/strict';
import { HeartRateEstimator } from '../src/analytics/HeartRateEstimator.js';
import { HeartRateRoiSampler } from '../src/analytics/HeartRateRoiSampler.js';

function seededRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function feedPulse(estimator, bpm, { fps, seconds, jitter = false } = {}) {
  const random = seededRandom();
  const start = 8_000_000;
  const end = start + seconds * 1000;
  const pulseHz = bpm / 60;
  let timestamp = start;
  while (timestamp < end) {
    const t = (timestamp - start) / 1000;
    const pulse = Math.sin(2 * Math.PI * pulseHz * t)
      + 0.25 * Math.sin(4 * Math.PI * pulseHz * t);
    const drift = 2 * Math.sin(2 * Math.PI * 0.18 * t) + 0.15 * t;
    const noise = () => (random() - 0.5) * 0.18;
    estimator.addSample({
      r: 112 + drift + 0.35 * pulse + noise(),
      g: 138 + drift + 1.8 * pulse + noise(),
      b: 96 + drift - 0.2 * pulse + noise(),
    }, timestamp);
    const jitterScale = jitter ? 0.78 + 0.44 * random() : 1;
    timestamp += (1000 / fps) * jitterScale;
  }
}

// A realistic independent ~30 fps feed recovers a known pulse despite
// deterministic noise, drift, and irregular capture timing.
{
  const estimator = new HeartRateEstimator({
    method: 'pos',
    bufferSeconds: 14,
    minWindowSeconds: 8,
  });
  feedPulse(estimator, 88, { fps: 30, seconds: 12, jitter: true });
  const result = estimator.estimate();
  assert.ok(result, '30 fps jittered feed produces an estimate');
  assert.ok(Math.abs(result.bpm - 88) < 3,
    `30 fps feed recovers 88 BPM (got ${result.bpm.toFixed(1)})`);
  assert.ok(result.fs >= 20, `effective sample rate remains usable (${result.fs.toFixed(1)} Hz)`);
}

// The empirically observed 3.5 fps condition is rejected. It spans enough
// time and has enough points to pass the old gates, but cannot safely cover
// the estimator's pulse band without aliases.
{
  const estimator = new HeartRateEstimator({ method: 'pos', bufferSeconds: 14 });
  feedPulse(estimator, 88, { fps: 3.5, seconds: 12, jitter: true });
  const status = estimator.status();
  assert.ok(status.n_samples >= 32, 'low-rate fixture passes the sample-count gate');
  assert.ok(status.span_seconds >= 8, 'low-rate fixture passes the time-window gate');
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'low_sample_rate');
  assert.ok(status.sample_rate_hz < status.minimum_sample_rate_hz);
  assert.equal(estimator.estimate(), null, '3.5 fps feed returns no aliased BPM');
}

// The browser scheduler is inert in Node, then uses decoded-video callbacks
// at the target cadence when a DOM and a video callback source are available.
{
  let callback = null;
  let callbackId = 0;
  let cancelled = null;
  const video = {
    readyState: 2,
    requestVideoFrameCallback(fn) { callback = fn; callbackId += 1; return callbackId; },
    cancelVideoFrameCallback(id) { cancelled = id; },
  };
  const estimator = { samples: 0, addSample() { this.samples += 1; } };
  const sampler = new HeartRateRoiSampler({
    getVideo: () => video,
    sampleRoi: () => ({ r: 100, g: 128, b: 120 }),
    estimator,
    targetFps: 30,
  });
  sampler.updateFace({ facePresent: true, bbox: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 } });
  assert.equal(sampler.start(), false, 'scheduler is a no-op without a DOM');

  globalThis.document = {};
  try {
    assert.equal(sampler.start(), true, 'scheduler starts in a DOM environment');
    callback(0);
    assert.equal(estimator.samples, 1, 'first decoded frame is sampled');
    callback(10);
    assert.equal(estimator.samples, 1, 'callbacks faster than 30 fps are throttled');
    callback(34);
    assert.equal(estimator.samples, 2, 'next 30 fps frame is sampled independently');
    const pendingId = callbackId;
    sampler.stop();
    assert.equal(cancelled, pendingId, 'pending video callback is cancelled on stop');
  } finally {
    delete globalThis.document;
  }
}

console.log('heart-rate-sampling.test.js — all cases passed');
