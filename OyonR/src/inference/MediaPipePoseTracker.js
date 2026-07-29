import { MEDIAPIPE_TASKS_WASM_CDN, MEDIAPIPE_POSE_LANDMARKER_LITE_URL } from '../config/cdnDefaults.js';
import { normalizeWasmBaseUrl } from './MediaPipeFaceTracker.js';

/**
 * MediaPipePoseTracker — body posture via MediaPipe Tasks Vision
 * `PoseLandmarker` (BlazePose, 33 landmarks). Deliberately a near-clone of
 * `MediaPipeFaceTracker`: it loads from the SAME `@mediapipe/tasks-vision`
 * peer dep and the SAME WASM fileset (`FilesetResolver.forVisionTasks`) — the
 * only new bytes are the pose `.task` model. No new npm dependency.
 *
 * `analyze(video, ts)` returns:
 *   { posePresent: true, landmarks, worldLandmarks, quality } | { posePresent:false, reason }
 * where `landmarks` is the 33-point normalized array (x,y in [0,1], z relative
 * depth, visibility). Downstream `PostureFeatureExtractor` derives scalars;
 * the raw landmarks ride the local `sample` event only (never a JSON window
 * batch), matching how face landmarks are handled.
 */
export class MediaPipePoseTracker {
  constructor(options = {}) {
    this.options = {
      wasmBaseUrl: MEDIAPIPE_TASKS_WASM_CDN,
      modelAssetPath: MEDIAPIPE_POSE_LANDMARKER_LITE_URL,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      ...options,
    };
    this.options.wasmBaseUrl = normalizeWasmBaseUrl(this.options.wasmBaseUrl);
    this.poseLandmarker = null;
    this.lastVideoTime = -1;
  }

  async init() {
    const mod = await import('@mediapipe/tasks-vision');
    const vision = await mod.FilesetResolver.forVisionTasks(this.options.wasmBaseUrl);
    this.poseLandmarker = await mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: this.options.modelAssetPath,
      },
      runningMode: 'VIDEO',
      numPoses: this.options.numPoses,
      minPoseDetectionConfidence: this.options.minPoseDetectionConfidence,
      minPosePresenceConfidence: this.options.minPosePresenceConfidence,
      minTrackingConfidence: this.options.minTrackingConfidence,
      // No segmentation mask — we only need landmarks, and the mask is a large
      // per-frame allocation we would immediately discard.
      outputSegmentationMasks: false,
    });
  }

  async analyze(video, timestampMs) {
    if (!this.poseLandmarker) throw new Error('MediaPipePoseTracker.init() must run first.');
    if (video.currentTime === this.lastVideoTime) {
      return { posePresent: false, reason: 'duplicate-frame' };
    }
    this.lastVideoTime = video.currentTime;

    const result = this.poseLandmarker.detectForVideo(video, timestampMs);
    const landmarks = result.landmarks?.[0] || null;
    if (!landmarks || landmarks.length === 0) {
      return { posePresent: false, reason: 'no-pose' };
    }

    const worldLandmarks = result.worldLandmarks?.[0] || null;
    let visibilitySum = 0;
    let visibilityCount = 0;
    for (const lm of landmarks) {
      if (lm && Number.isFinite(lm.visibility)) {
        visibilitySum += lm.visibility;
        visibilityCount += 1;
      }
    }

    return {
      posePresent: true,
      landmarks,
      worldLandmarks,
      quality: {
        landmarkCount: landmarks.length,
        meanVisibility: visibilityCount > 0 ? visibilitySum / visibilityCount : null,
      },
    };
  }
}
