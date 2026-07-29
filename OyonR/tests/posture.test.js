import assert from 'node:assert/strict';
import { extractPostureFeatures } from '../src/inference/PostureFeatureExtractor.js';
import { PostureAggregator } from '../src/aggregation/PostureAggregator.js';
import { buildPoseLandmarks } from '../src/mocks/MockPoseTracker.js';

function poseResult(overrides) {
  return { posePresent: true, landmarks: buildPoseLandmarks(overrides) };
}
const lm = (x, y, visibility = 0.95) => ({ x, y, z: 0, visibility });

// ── upright pose ────────────────────────────────────────────────────
{
  const f = extractPostureFeatures(poseResult());
  assert.ok(f, 'upright pose → features');
  assert.equal(f.valid, true, 'shoulders visible → valid');
  assert.ok(Math.abs(f.shoulder_tilt_deg) < 1e-6, 'level shoulders → tilt ~0');
  assert.ok(Math.abs(f.torso_lean_deg) < 1e-6, 'upright torso → lean ~0');
  assert.ok(Math.abs(f.head_lateral_norm) < 1e-6, 'centered head → lateral ~0');
  assert.ok(f.head_above_norm > 0.5, `head above shoulders (got ${f.head_above_norm})`);
  assert.ok(Math.abs(f.shoulder_width_norm - 0.2) < 1e-9, 'shoulder width 0.2');
  assert.ok(f.upper_visibility > 0.9, 'high visibility');
}

// ── tilted shoulders (right shoulder lower) ─────────────────────────
{
  const f = extractPostureFeatures(poseResult({ 12: lm(0.6, 0.5) })); // right shoulder y down
  assert.ok(f.shoulder_tilt_deg > 20 && f.shoulder_tilt_deg < 30,
    `right-lower shoulder → +tilt ~26.6° (got ${f.shoulder_tilt_deg})`);
}

// ── leaning right (shoulders shifted right of hips) ─────────────────
{
  const f = extractPostureFeatures(poseResult({ 11: lm(0.5, 0.4), 12: lm(0.7, 0.4) }));
  assert.ok(f.torso_lean_deg > 10, `shoulders right of hips → +lean (got ${f.torso_lean_deg})`);
}

// ── shoulders not visible → invalid, nulls ──────────────────────────
{
  const f = extractPostureFeatures(poseResult({ 11: lm(0.4, 0.4, 0.1), 12: lm(0.6, 0.4, 0.1) }));
  assert.equal(f.valid, false, 'low-visibility shoulders → invalid');
  assert.equal(f.shoulder_tilt_deg, null, 'no tilt without shoulders');
}

// ── no pose → null ──────────────────────────────────────────────────
{
  assert.equal(extractPostureFeatures({ posePresent: false }), null);
  assert.equal(extractPostureFeatures(null), null);
}

// ── PostureAggregator ───────────────────────────────────────────────
{
  const agg = new PostureAggregator({ windowMs: 10000, sampleIntervalMs: 1000 });
  const base = 2_000_000;
  // Three frames with growing lean → sway > 0.
  const leans = [
    poseResult({ 11: lm(0.4, 0.4), 12: lm(0.6, 0.4) }),           // lean 0
    poseResult({ 11: lm(0.45, 0.4), 12: lm(0.65, 0.4) }),         // shifted right
    poseResult({ 11: lm(0.5, 0.4), 12: lm(0.7, 0.4) }),           // more right
  ];
  for (let i = 0; i < leans.length; i += 1) {
    const s = extractPostureFeatures(leans[i]);
    assert.equal(agg.consumeFrame(s, base + i * 1000), null, 'no auto-flush before windowMs');
  }
  const w = agg.flush(base + 3000);
  assert.ok(w, 'flush → window');
  assert.equal(w.total_frames, 3);
  assert.equal(w.valid_frames, 3);
  assert.ok(Number.isFinite(w.torso_lean_deg_mean), 'lean mean present');
  assert.ok(Number.isFinite(w.torso_lean_deg_std), 'lean std present');
  assert.ok(w.postural_sway_deg > 0, `sway > 0 across changing lean (got ${w.postural_sway_deg})`);
  assert.ok(Number.isFinite(w.shoulder_width_norm_mean), 'shoulder width mean present');
  assert.equal(typeof w.model_version, 'string');

  assert.equal(new PostureAggregator().flush(), null, 'empty flush → null');
}

console.log('posture.test.js — all cases passed');
