/**
 * MockPoseTracker — drop-in for MediaPipePoseTracker in tests/demos. Returns a
 * synthetic 33-landmark upright pose (nose above a level shoulder line above a
 * level hip line, all fully visible), or a caller-supplied landmark array.
 */

const POSE_LANDMARK_COUNT = 33;

// Indices we place deliberately; the rest are filled at frame center.
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;

function lm(x, y, visibility = 0.95, z = 0) {
  return { x, y, z, visibility };
}

/**
 * Build an upright synthetic pose. Overrides is an index→landmark map so tests
 * can tilt/lean the body.
 */
export function buildPoseLandmarks(overrides = {}) {
  const out = new Array(POSE_LANDMARK_COUNT);
  for (let i = 0; i < POSE_LANDMARK_COUNT; i += 1) out[i] = lm(0.5, 0.5);
  out[NOSE] = lm(0.5, 0.2);
  out[LEFT_SHOULDER] = lm(0.4, 0.4);
  out[RIGHT_SHOULDER] = lm(0.6, 0.4);
  out[LEFT_HIP] = lm(0.45, 0.7);
  out[RIGHT_HIP] = lm(0.55, 0.7);
  for (const key of Object.keys(overrides)) out[Number(key)] = overrides[key];
  return out;
}

export class MockPoseTracker {
  constructor(options = {}) {
    this.mockLandmarks = options.mockLandmarks || null;
    this.posePresent = options.posePresent !== false;
  }

  setLandmarks(landmarks) {
    this.mockLandmarks = landmarks || null;
  }

  async init() {}

  async analyze() {
    if (!this.posePresent) return { posePresent: false, reason: 'no-pose' };
    const landmarks = this.mockLandmarks != null ? this.mockLandmarks : buildPoseLandmarks();
    let sum = 0;
    let count = 0;
    for (const p of landmarks) {
      if (p && Number.isFinite(p.visibility)) { sum += p.visibility; count += 1; }
    }
    return {
      posePresent: true,
      landmarks,
      worldLandmarks: null,
      quality: { landmarkCount: landmarks.length, meanVisibility: count > 0 ? sum / count : null, mock: true },
    };
  }
}
