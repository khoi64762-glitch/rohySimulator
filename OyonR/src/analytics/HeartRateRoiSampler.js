/**
 * Acquires cheap face-ROI colour samples independently of the runtime's heavy
 * face/emotion cadence. Face detection only refreshes the cached bbox; video
 * frames between detections reuse that bbox and feed the rolling estimator.
 *
 * The scheduler prefers requestVideoFrameCallback so each sample corresponds
 * to a decoded camera frame. requestAnimationFrame is the browser fallback.
 * start() is deliberately a no-op outside a DOM environment.
 */
export class HeartRateRoiSampler {
  constructor(options = {}) {
    this.getVideo = options.getVideo || (() => null);
    this.sampleRoi = options.sampleRoi || (() => null);
    this.estimator = options.estimator || null;
    // Extra consumers of the SAME ROI colour stream (respiration reads the
    // low band of the identical signal). Sampling once and fanning out keeps
    // the per-frame canvas read to exactly one, which is the expensive part.
    this.extraEstimators = Array.isArray(options.estimators) ? options.estimators.filter(Boolean) : [];
    this.targetFps = positive(options.targetFps, 30);
    this.maxFaceAgeMs = positive(options.maxFaceAgeMs, 2500);
    this.onError = typeof options.onError === 'function' ? options.onError : null;

    this.latestFace = null;
    this.latestFaceAt = -Infinity;
    this.running = false;
    this.frameRequest = null;
    this.frameRequestKind = null;
    this.frameRequestVideo = null;
    this.lastSampleClock = -Infinity;
    this.errorReported = false;
  }

  updateFace(face, timestamp = Date.now()) {
    if (!face || face.facePresent === false || !face.bbox) {
      this.latestFace = null;
      this.latestFaceAt = -Infinity;
      return;
    }
    this.latestFace = { bbox: { ...face.bbox } };
    this.latestFaceAt = timestamp;
  }

  start() {
    if (this.running) return true;
    if (!hasDom()) return false;
    this.running = true;
    this.lastSampleClock = -Infinity;
    if (!this._scheduleNext()) {
      this.running = false;
      return false;
    }
    return true;
  }

  stop() {
    this.running = false;
    if (this.frameRequest != null) {
      if (this.frameRequestKind === 'video'
        && typeof this.frameRequestVideo?.cancelVideoFrameCallback === 'function') {
        this.frameRequestVideo.cancelVideoFrameCallback(this.frameRequest);
      } else if (this.frameRequestKind === 'animation'
        && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(this.frameRequest);
      }
    }
    this.frameRequest = null;
    this.frameRequestKind = null;
    this.frameRequestVideo = null;
  }

  /** Sample one frame. Public for deterministic tests; scheduling stays here. */
  sampleOnce(timestamp = Date.now()) {
    const video = this.getVideo();
    const consumers = this.estimator ? 1 : this.extraEstimators.length;
    if (!video || video.readyState < 2 || !this.latestFace || consumers === 0) return false;
    if (timestamp - this.latestFaceAt > this.maxFaceAgeMs) return false;
    try {
      const rgb = this.sampleRoi(video, this.latestFace);
      if (!rgb) return false;
      if (this.estimator) this.estimator.addSample(rgb, timestamp);
      for (const est of this.extraEstimators) est.addSample(rgb, timestamp);
      this.errorReported = false;
      return true;
    } catch (error) {
      if (!this.errorReported && this.onError) this.onError(error);
      this.errorReported = true;
      return false;
    }
  }

  _scheduleNext() {
    if (!this.running) return false;
    const video = this.getVideo();
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      this.frameRequestKind = 'video';
      this.frameRequestVideo = video;
      this.frameRequest = video.requestVideoFrameCallback((clock) => this._onFrame(clock));
      return true;
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      this.frameRequestKind = 'animation';
      this.frameRequestVideo = null;
      this.frameRequest = globalThis.requestAnimationFrame((clock) => this._onFrame(clock));
      return true;
    }
    return false;
  }

  _onFrame(clock) {
    this.frameRequest = null;
    this.frameRequestKind = null;
    this.frameRequestVideo = null;
    if (!this.running) return;
    const interval = 1000 / this.targetFps;
    // Small tolerance prevents a nominal 30 fps stream (33.33 ms callbacks)
    // from being accidentally reduced to 15 fps by timer rounding.
    if (clock - this.lastSampleClock + 0.5 >= interval) {
      this.lastSampleClock = clock;
      this.sampleOnce(Date.now());
    }
    this._scheduleNext();
  }
}

function hasDom() {
  return typeof document !== 'undefined' || typeof window !== 'undefined';
}

function positive(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
