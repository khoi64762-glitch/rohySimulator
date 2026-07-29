export class CameraController {
  constructor(options = {}) {
    this.options = {
      constraints: { video: { facingMode: 'user' }, audio: false },
      attachToDom: false,
      diagnosticsEnabled: true,
      ...options,
    };
    this.stream = null;
    this.video = null;
    this._frameCallbackId = null;
    this._lastPresentedFrames = null;
    this._lastFrameMetadata = null;
    this._timingLifetime = createTimingState();
    this._timingWindow = createTimingState();
  }

  async start() {
    if (!navigator?.mediaDevices?.getUserMedia) {
      throw new Error('Camera capture is not available in this browser.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia(this.options.constraints);
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.srcObject = this.stream;

    if (this.options.attachToDom) {
      this.video.style.position = 'fixed';
      this.video.style.width = '1px';
      this.video.style.height = '1px';
      this.video.style.opacity = '0';
      this.video.style.pointerEvents = 'none';
      document.body.appendChild(this.video);
    }

    await this.video.play();
    this._startFrameDiagnostics();
    return this.video;
  }

  stop() {
    this._stopFrameDiagnostics();
    for (const track of this.stream?.getTracks?.() || []) {
      track.stop();
    }
    if (this.video?.parentNode) this.video.parentNode.removeChild(this.video);
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
  }

  getStream() {
    return this.stream;
  }

  /** The active camera track, or null before start()/after stop(). */
  getVideoTrack() {
    return this.stream?.getVideoTracks?.()[0] || null;
  }

  /** Actual settings selected by the browser. Device identifiers are omitted. */
  getSettings() {
    return sanitizeCameraObject(this.getVideoTrack()?.getSettings?.());
  }

  /** Browser-supported ranges/modes. Safe to call when unsupported. */
  getCapabilities() {
    return sanitizeCameraObject(this.getVideoTrack()?.getCapabilities?.());
  }

  /** Constraints currently held by the active track. */
  getConstraints() {
    return sanitizeCameraObject(this.getVideoTrack()?.getConstraints?.());
  }

  /**
   * Explicit host-controlled constraint update. Oyon never changes exposure,
   * focus, white balance, frame rate, or resolution automatically: doing so
   * would be surprising and is not supported consistently across browsers.
   */
  async applyVideoConstraints(constraints = {}) {
    const track = this.getVideoTrack();
    if (!track || typeof track.applyConstraints !== 'function') {
      throw new Error('Camera video-track constraints are not available.');
    }
    await track.applyConstraints(constraints);
    return this.getSettings();
  }

  /**
   * Privacy-safe capture diagnostics. With `resetWindow:true`, the returned
   * `timing.window` covers frames since the previous reset; lifetime counters
   * remain intact. No deviceId, groupId, label, image, or frame data is kept.
   */
  getDiagnostics({ resetWindow = false } = {}) {
    const source = this.video && typeof this.video.requestVideoFrameCallback === 'function'
      ? 'requestVideoFrameCallback'
      : 'unavailable';
    const settings = this.getSettings();
    const selectedFrameRate = Number.isFinite(settings?.frame_rate)
      ? settings.frame_rate
      : null;
    const out = {
      available: Boolean(this.getVideoTrack()),
      settings,
      constraints: this.getConstraints(),
      capabilities: this.getCapabilities(),
      timing: {
        source,
        window: summarizeTiming(this._timingWindow, selectedFrameRate),
        lifetime: summarizeTiming(this._timingLifetime, selectedFrameRate),
        callback_age_ms: this._timingLifetime.lastClock == null
          ? null
          : Math.max(0, performanceNow() - this._timingLifetime.lastClock),
        media_time_ms: Number.isFinite(this._lastFrameMetadata?.mediaTime)
          ? this._lastFrameMetadata.mediaTime * 1000
          : null,
        presented_frames: Number.isFinite(this._lastFrameMetadata?.presentedFrames)
          ? this._lastFrameMetadata.presentedFrames
          : null,
        frame_width: finiteOrNull(this._lastFrameMetadata?.width),
        frame_height: finiteOrNull(this._lastFrameMetadata?.height),
      },
    };
    if (resetWindow) this._timingWindow = createTimingState();
    return out;
  }

  _startFrameDiagnostics() {
    this._stopFrameDiagnostics();
    this._lastPresentedFrames = null;
    this._lastFrameMetadata = null;
    this._timingLifetime = createTimingState();
    this._timingWindow = createTimingState();
    if (!this.options.diagnosticsEnabled) return;
    if (!this.video || typeof this.video.requestVideoFrameCallback !== 'function') return;

    const onFrame = (clock, metadata = {}) => {
      this._frameCallbackId = null;
      if (!this.video) return;
      let dropped = 0;
      if (Number.isFinite(metadata.presentedFrames) && Number.isFinite(this._lastPresentedFrames)) {
        dropped = Math.max(0, metadata.presentedFrames - this._lastPresentedFrames - 1);
      }
      if (Number.isFinite(metadata.presentedFrames)) this._lastPresentedFrames = metadata.presentedFrames;
      // Read explicitly: browser metadata fields may live on the prototype and
      // therefore disappear under object spread.
      this._lastFrameMetadata = {
        presentedFrames: metadata.presentedFrames,
        mediaTime: metadata.mediaTime,
        width: metadata.width,
        height: metadata.height,
      };
      recordTiming(this._timingLifetime, clock, dropped);
      recordTiming(this._timingWindow, clock, dropped);
      this._frameCallbackId = this.video.requestVideoFrameCallback(onFrame);
    };
    this._frameCallbackId = this.video.requestVideoFrameCallback(onFrame);
  }

  _stopFrameDiagnostics() {
    if (
      this._frameCallbackId != null
      && this.video
      && typeof this.video.cancelVideoFrameCallback === 'function'
    ) {
      this.video.cancelVideoFrameCallback(this._frameCallbackId);
    }
    this._frameCallbackId = null;
  }
}

function createTimingState() {
  return {
    frames: 0,
    dropped: 0,
    firstClock: null,
    lastClock: null,
    intervalCount: 0,
    intervalMean: 0,
    intervalM2: 0,
    intervalMax: null,
  };
}

function recordTiming(state, clock, dropped) {
  if (!Number.isFinite(clock)) return;
  if (state.firstClock == null) state.firstClock = clock;
  if (state.lastClock != null && clock > state.lastClock) {
    const interval = clock - state.lastClock;
    state.intervalCount += 1;
    const delta = interval - state.intervalMean;
    state.intervalMean += delta / state.intervalCount;
    state.intervalM2 += delta * (interval - state.intervalMean);
    state.intervalMax = state.intervalMax == null ? interval : Math.max(state.intervalMax, interval);
  }
  state.lastClock = clock;
  state.frames += 1;
  state.dropped += Number.isFinite(dropped) ? dropped : 0;
}

function summarizeTiming(state, selectedFrameRate = null) {
  const mean = state.intervalCount > 0 ? state.intervalMean : null;
  const variance = state.intervalCount > 1 ? state.intervalM2 / state.intervalCount : 0;
  const spanMs = state.firstClock != null && state.lastClock != null
    ? Math.max(0, state.lastClock - state.firstClock)
    : 0;

  // `presentedFrames` is specified as a compositor-frame counter, but some
  // camera/browser combinations report discontinuities far larger than the
  // elapsed time can physically contain. When the active track tells us the
  // browser-selected FPS, estimate delivery shortfall from elapsed time and
  // observed callbacks instead. This is bounded by the selected cadence and
  // cannot turn a healthy 30 FPS stream into a fictitious 99% loss. Keep the
  // metadata path only for browsers that omit the selected frame rate.
  const hasCadence = Number.isFinite(selectedFrameRate)
    && selectedFrameRate > 0
    && state.frames > 0;
  const expectedFrames = hasCadence
    ? Math.max(state.frames, Math.round((spanMs / 1000) * selectedFrameRate) + 1)
    : state.frames + state.dropped;
  const estimatedDropped = hasCadence
    ? Math.max(0, expectedFrames - state.frames)
    : state.dropped;
  return {
    frames_observed: state.frames,
    estimated_dropped_frames: estimatedDropped,
    drop_ratio: expectedFrames > 0 ? estimatedDropped / expectedFrames : 0,
    drop_estimate_source: hasCadence ? 'selected_frame_rate' : 'presented_frames',
    observed_fps: mean && mean > 0 ? 1000 / mean : null,
    frame_interval_ms_mean: mean,
    frame_interval_ms_std: mean == null ? null : Math.sqrt(Math.max(0, variance)),
    max_frame_gap_ms: state.intervalMax,
    span_ms: spanMs,
  };
}

const PRIVATE_CAMERA_KEYS = new Set(['deviceId', 'groupId', 'label']);

function sanitizeCameraObject(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_CAMERA_KEYS.has(key)) continue;
    const safe = sanitizeCameraValue(item);
    if (safe !== undefined) out[toSnakeCase(key)] = safe;
  }
  return out;
}

function sanitizeCameraValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value
      .map(sanitizeCameraValue)
      .filter(item => item !== undefined)
      .slice(0, 50);
  }
  if (typeof value === 'object') return sanitizeCameraObject(value);
  return undefined;
}

function toSnakeCase(value) {
  return value.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}
