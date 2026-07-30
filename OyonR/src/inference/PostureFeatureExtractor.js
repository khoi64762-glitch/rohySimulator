/**
 * PostureFeatureExtractor — stateless per-frame posture math from a MediaPipe
 * PoseLandmarker result (33 BlazePose landmarks). Pure geometry, no I/O.
 *
 * Landmark coordinates are normalized image space: x,y ∈ [0,1] with +y DOWN
 * (canvas/MediaPipe convention), z a relative depth, `visibility` ∈ [0,1].
 * Only upper-body landmarks are needed for the derived scalars; the full 33
 * ride the local `sample` event for researchers who want them.
 *
 * Derived scalars (all null when the required landmarks aren't visible):
 *   - shoulder_tilt_deg   deviation of the shoulder line from horizontal;
 *                         0 = level, + = right shoulder lower.
 *   - torso_lean_deg      torso (hip→shoulder) deviation from vertical;
 *                         0 = upright, + = leaning right, − = left.
 *   - head_lateral_norm   nose horizontal offset from shoulder midpoint,
 *                         ÷ shoulder width; + = head shifted right.
 *   - head_above_norm     nose height above shoulders ÷ torso length; a
 *                         slouch/head-drop proxy (smaller = more slumped).
 *   - shoulder_width_norm shoulder span in image units — proximity proxy
 *                         (larger = closer to camera).
 *   - upper_visibility    mean visibility of nose + shoulders + hips.
 */

// BlazePose 33-landmark indices (upper body).
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_VISIBILITY_THRESHOLD = 0.5;

function visible(lm, threshold) {
  return (
    lm != null &&
    Number.isFinite(lm.x) &&
    Number.isFinite(lm.y) &&
    (!Number.isFinite(lm.visibility) || lm.visibility >= threshold)
  );
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function visibilityOf(lm) {
  return lm && Number.isFinite(lm.visibility) ? lm.visibility : null;
}

/**
 * @param {object} poseResult  result from MediaPipePoseTracker.analyze()
 * @param {object} [settings]  reads posture_visibility_threshold (optional)
 * @returns {object|null}
 */
export function extractPostureFeatures(poseResult, settings) {
  if (!poseResult || poseResult.posePresent !== true) return null;
  const landmarks = poseResult.landmarks;
  if (!Array.isArray(landmarks) || landmarks.length <= RIGHT_HIP) return null;

  const threshold = clampUnit(
    settings?.posture_visibility_threshold,
    DEFAULT_VISIBILITY_THRESHOLD,
  );

  const nose = landmarks[NOSE];
  const lShoulder = landmarks[LEFT_SHOULDER];
  const rShoulder = landmarks[RIGHT_SHOULDER];
  const lHip = landmarks[LEFT_HIP];
  const rHip = landmarks[RIGHT_HIP];

  const shouldersVisible = visible(lShoulder, threshold) && visible(rShoulder, threshold);
  const hipsVisible = visible(lHip, threshold) && visible(rHip, threshold);
  const noseVisible = visible(nose, threshold);

  let shoulder_tilt_deg = null;
  let shoulder_width_norm = null;
  let shoulderMid = null;
  if (shouldersVisible) {
    const dx = rShoulder.x - lShoulder.x;
    const dy = rShoulder.y - lShoulder.y;
    // Deviation from horizontal, folded to [-90, 90]: sign = which shoulder
    // is lower (larger y), magnitude = tilt.
    shoulder_tilt_deg = Math.atan2(dy, Math.abs(dx)) * RAD_TO_DEG;
    shoulder_width_norm = dist(lShoulder, rShoulder);
    shoulderMid = midpoint(lShoulder, rShoulder);
  }

  let torso_lean_deg = null;
  let head_above_norm = null;
  if (shouldersVisible && hipsVisible) {
    const hipMid = midpoint(lHip, rHip);
    // Torso vector hip→shoulder. Upright ⇒ shoulders above hips ⇒ vy < 0
    // (image +y down). Lean from vertical = atan2(vx, -vy).
    const vx = shoulderMid.x - hipMid.x;
    const vy = shoulderMid.y - hipMid.y;
    torso_lean_deg = Math.atan2(vx, -vy) * RAD_TO_DEG;
    const torsoLen = dist(shoulderMid, hipMid);
    if (noseVisible && torsoLen > 1e-6) {
      // Nose height above shoulders ÷ torso length. Positive when the head
      // sits above the shoulder line; shrinks as the head drops forward/down.
      head_above_norm = (shoulderMid.y - nose.y) / torsoLen;
    }
  }

  let head_lateral_norm = null;
  if (shouldersVisible && noseVisible && shoulder_width_norm > 1e-6) {
    head_lateral_norm = (nose.x - shoulderMid.x) / shoulder_width_norm;
  }

  const upperVis = [nose, lShoulder, rShoulder, lHip, rHip]
    .map(visibilityOf)
    .filter((v) => v != null);
  const upper_visibility = upperVis.length > 0
    ? upperVis.reduce((a, b) => a + b, 0) / upperVis.length
    : null;

  const valid = shouldersVisible; // shoulders are the minimum useful signal.

  return {
    shoulder_tilt_deg,
    torso_lean_deg,
    head_lateral_norm,
    head_above_norm,
    shoulder_width_norm,
    upper_visibility,
    valid,
    ts_ms: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  };
}

function clampUnit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export { NOSE, LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP };
