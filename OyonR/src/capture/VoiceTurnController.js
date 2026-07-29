/**
 * VoiceTurnController — turn lifecycle + activation gate for the voice
 * capture pipeline (audio_text.md §5.1, §5.2, §5.9).
 *
 * ── Thread split (why this file never touches ORT/FFT/pitch) ─────────────
 * ONNX Runtime cannot run inside an AudioWorklet (`AudioWorkletGlobalScope`
 * has no fetch/XHR/Worker/module-loading, so ORT cannot fetch its WASM),
 * and a 32 ms-cadence neural VAD on the audio render thread would turn a
 * missed deadline into an audio glitch. The split is:
 *
 *   AudioWorklet (voiceFrameWorklet.js) — ring buffer, fixed-size framing,
 *     cheap time-domain scalars (RMS, peak, clipped count, ZCR). Posts
 *     Float32Array frames over its MessagePort. Nothing else.
 *
 *   Worker (voiceAnalysisWorker.js, DEFAULT) — everything expensive: VAD
 *     (ORT), FFT, spectral shape, NSDF pitch. CONTENTION NOTE: MediaPipe
 *     face, MediaPipe pose, and ONNX emotion already run on the MAIN
 *     thread at 16 fps, and the realistic ChatOyon scenario runs voice
 *     WHILE those camera pipelines run — so this controller ships the
 *     Worker deployment as the default: unless `voice_worker_enabled` is
 *     false (default true) it routes every frame through a
 *     `WorkerVoiceAnalyzer` (src/inference/WorkerVoiceAnalyzer.js), which
 *     hosts the VAD + per-frame DSP in a dedicated module Worker and falls
 *     back VISIBLY to same-thread analysis (`mode: 'main-thread'`,
 *     `fallbackReason`) when Workers are unavailable or init fails. A
 *     caller-injected `vad` adapter INSTANCE forces the same-thread mode
 *     (an object cannot cross a thread boundary) — pass
 *     `analyzerOptions: { vadEnabled: true }` instead to let the worker
 *     construct its own Silero adapter. The analyzer applies bounded
 *     backpressure (drop-oldest beyond `maxInFlight`); dropped frames are
 *     counted into the stopTurn() report (`dropped_frames`,
 *     `dropped_frame_ratio`) and the per-frame record (`analysis_dropped`)
 *     so degraded turns are never silent. With the worker path disabled
 *     the controller runs the ORIGINAL in-thread path: frames go straight
 *     to the injected `vad` adapter and the per-frame record's `features`
 *     carries a MINIMAL time-domain record built from the worklet's cheap
 *     scalars (rms, peak, clippedSamples, zeroCrossingRate; spectral and
 *     pitch fields are null — unmeasured, never fabricated). This keeps
 *     the aggregate window consistent with the event stream: the
 *     aggregator ignores feature-less frames entirely, and a null here
 *     previously made a turn whose events said 'speech' report
 *     `speech_duration_ms: 0`. The raw frame is still exposed for the
 *     host to run the full DSP itself.
 *
 * ── Activation gate (§5.1) ───────────────────────────────────────────────
 * `getUserMedia` is NOT called — no microphone hardware is touched — until
 * ALL three independent conditions hold:
 *
 *   1. `settings.voice_enabled` is true (default false, matching
 *      `heart_rate_enabled` / `posture_tracking_enabled` /
 *      `gaze_tracking_enabled`).
 *   2. The host has explicitly enabled voice for this activity
 *      (`hostEnabled` option: boolean or () => boolean).
 *   3. The learner performed a deliberate per-turn action
 *      (`startTurn({ userAction: true })` — the host passes this only from
 *      a genuine user gesture; there is no ambient listening, no hot-word,
 *      no automatic re-arm).
 *
 * This is an ACTIVATION gate on microphone hardware access, NOT a data
 * gate: per this repo's research-grade data policy (CLAUDE.md), once a
 * turn is active every derived signal — per-frame samples, RMS, VAD
 * probability, all of it — is exposed at full rate through
 * `onFrameFeatures` and `onEvent`. Consent is handled outside the app.
 *
 * ── Refusal contract ─────────────────────────────────────────────────────
 * `startTurn()` NEVER throws for a gate refusal. It resolves
 * `{ ok: false, reason }` (reasons: 'voice_disabled_in_settings',
 * 'host_not_enabled', 'no_user_action', 'turn_already_active',
 * 'start_in_progress', 'stopped_during_start', 'disposed'), and
 * `{ ok: true }` on success. Hardware/context failures after the gate
 * (e.g. permission denied) reject with the underlying error, because
 * those are exceptional, not policy.
 *
 * Startup is itself a guarded critical section:
 *   - A second `startTurn()` while another start is still between its gate
 *     and activation is refused with 'start_in_progress' — running both
 *     would acquire TWO microphone streams and leak the loser's track.
 *   - `dispose()` or `stopTurn()` landing while a start is pending (e.g.
 *     while `getUserMedia` is still resolving) cancels the start: any
 *     already-acquired owned track is stopped the moment teardown is
 *     requested, the arriving stream is stopped at the next cancellation
 *     checkpoint, and `startTurn()` resolves `{ ok: false, reason:
 *     'disposed' | 'stopped_during_start' }` instead of activating. Every
 *     `await` between the gate and `active = true` is followed by such a
 *     checkpoint — a microphone that outlives teardown is the single worst
 *     failure this module can have.
 *
 * ── Sample rate ──────────────────────────────────────────────────────────
 * The controller requests the AudioContext at 16 kHz
 * (`audioContextFactory({ sampleRate: 16000 })`) and lets the browser
 * resample — supported in Chrome, Firefox, and Safari, and it hands Silero
 * exactly the rate it needs. Documented fallback: if the constructor
 * refuses the constraint, the context is created at native rate, the
 * worklet frames are scaled (`voice_frame_ms` at native rate) and
 * LINEARLY INTERPOLATED down to 16 kHz here. This is deliberately not a
 * general resampler (no polyphase/sinc); see audio_text.md §5.3.
 *
 * ── AGC policy (§5.6) ────────────────────────────────────────────────────
 * When Oyon owns the stream (no `stream` passed to startTurn), it requests
 * `autoGainControl: false` (when `settings.voice_request_agc_off`, default
 * true) because AGC normalizes loudness and turns every absolute loudness
 * measurement into an artifact of the gain controller. When the HOST owns
 * the stream (shared with STT), the controller reads
 * `track.getSettings()` and surfaces `auto_gain_control` +
 * `loudness_contaminated` so the aggregator can mark loudness measurements
 * contaminated rather than reporting them as comparable.
 *
 * ── Teardown ─────────────────────────────────────────────────────────────
 * `stopTurn()` stops every MediaStreamTrack of an Oyon-owned stream
 * IMMEDIATELY and synchronously — a microphone that keeps running after a
 * turn is the single worst failure this module can have — then disconnects
 * the audio graph and closes the context. Host-owned streams (passed via
 * `startTurn({ stream })`) are NOT stopped by default: the host is
 * typically sharing that stream with its own STT path, and killing it
 * would be hostile; the controller only disconnects its own graph. Pass
 * `stopHostStreamTracks: true` to opt into stopping host tracks too.
 * `dispose()` is idempotent and safe after `stopTurn()`; no events are
 * emitted afterwards.
 *
 * ── AI playback exclusion (§5.9) ─────────────────────────────────────────
 * `aiPlaybackStart()` / `aiPlaybackEnd()` record host-authoritative
 * playback intervals. Frames inside an interval are excluded from the
 * learner speech/silence machine; if the VAD reports speech during
 * playback the controller emits `contaminated` (once per contiguous run)
 * instead of counting it as learner speech.
 *
 * Events (`onEvent`) use ONLY states from `OYON_VOICE_STATES`
 * (voice-states-v1): start, speech, silence, pause, clipped, muted,
 * playback, contaminated, end. Shape:
 *   { state, timestamp_ms, states_version, detail }
 */

import { OYON_VOICE_STATES, OYON_VOICE_STATES_VERSION } from '../version.js';
import { VOICE_FRAME_PROCESSOR_NAME } from './voiceFrameWorklet.js';
import { createWorkerVoiceAnalyzer } from '../inference/WorkerVoiceAnalyzer.js';

const TARGET_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 32; // 512 samples at 16 kHz — Silero v5's exact chunk.

const VALID_STATES = new Set(OYON_VOICE_STATES);

export function createVoiceTurnController(options = {}) {
  const {
    settings = {},
    vad = null,
    onFrameFeatures = null,
    onEvent = null,
    onError = null,
    hostEnabled = false,
    getUserMedia = defaultGetUserMedia,
    audioContextFactory = defaultAudioContextFactory,
    createWorkletNode = defaultCreateWorkletNode,
    workletUrl = defaultWorkletUrl(),
    now = defaultNow,
    sampleRate = TARGET_SAMPLE_RATE,
    stopHostStreamTracks = false,
    clipThreshold = 0.999,
    // ── worker analysis path (audio_text.md §5.2, default ON) ──
    // `analyzer`: a pre-built WorkerVoiceAnalyzer-shaped object (the
    // controller will init/reset it but NOT dispose it — the caller owns
    // it). `analyzerFactory`: injectable constructor for tests.
    // `analyzerOptions`: forwarded into the factory (e.g. `vadEnabled`,
    // `modelUrl`, `wasmPaths`, `maxInFlight`, `workerFactory`).
    analyzer = null,
    analyzerFactory = null,
    analyzerOptions = {},
  } = options;

  const frameMs = Number.isFinite(settings.voice_frame_ms) && settings.voice_frame_ms > 0
    ? settings.voice_frame_ms
    : DEFAULT_FRAME_MS;
  const vadThreshold = Number.isFinite(settings.voice_vad_threshold)
    ? settings.voice_vad_threshold
    : 0.5;
  const minSpeechMs = Number.isFinite(settings.voice_min_speech_ms) ? settings.voice_min_speech_ms : 100;
  const minSilenceMs = Number.isFinite(settings.voice_min_silence_ms) ? settings.voice_min_silence_ms : 300;
  const pauseThresholdMs = Number.isFinite(settings.voice_pause_threshold_ms)
    ? settings.voice_pause_threshold_ms
    : 500;
  const requestAgcOff = settings.voice_request_agc_off !== false;
  const workerEnabled = settings.voice_worker_enabled !== false; // default true

  // ── analysis path (worker by default; §5.2) ────────────────────────────
  // When enabled, ALL expensive per-frame work (VAD + FFT + pitch) goes
  // through the analyzer, which hosts it in a dedicated Worker when it can
  // and falls back visibly to same-thread analysis when it cannot. An
  // injected `vad` instance is honoured by the analyzer's same-thread
  // fallback core, so existing adapter injection (mocks, custom VADs)
  // keeps working deterministically.
  let analysisPath = analyzer;
  let ownsAnalyzer = false;
  if (!analysisPath && workerEnabled) {
    const factory = typeof analyzerFactory === 'function' ? analyzerFactory : createWorkerVoiceAnalyzer;
    analysisPath = factory({
      settings,
      sampleRate,
      vad,
      onError: reportError,
      ...analyzerOptions,
    });
    ownsAnalyzer = true;
  }

  // ── lifecycle state ────────────────────────────────────────────────────
  let disposed = false;
  let active = false;
  // True while a startTurn() is between its gate and `active = true` — the
  // window in which teardown requests must cancel the pending start.
  let starting = false;
  // Set by stopTurn() landing during that window; checked at every
  // post-await cancellation checkpoint inside startTurn().
  let startCancelReason = null;
  let lastEmittedState = null;

  // Per-turn resources.
  let ownsStream = false;
  let stream = null;
  let audioContext = null;
  let sourceNode = null;
  let workletNode = null;
  let contextRate = sampleRate;
  let resampleMode = 'native-16k';
  let trackListeners = []; // [track, type, listener]
  let vadInitialized = false;
  let vadChain = Promise.resolve();

  // Per-turn measurement state.
  let turnStartMs = null;
  let framesProcessed = 0;
  let elapsedTurnMs = 0; // frame-duration accumulation — deterministic in tests
  let speechRunMs = 0;
  let silenceRunMs = 0;
  let vadState = 'start'; // 'start' | 'speech' | 'silence'
  let hadSpeech = false;
  let pauseEmitted = false;
  let contaminatedRun = false;
  let contaminatedCount = 0;
  let mutedLast = false;
  let playbackIntervals = [];
  let openPlaybackInterval = null;
  let trackSettingsReport = null;

  function isHostEnabled() {
    return typeof hostEnabled === 'function' ? Boolean(hostEnabled()) : Boolean(hostEnabled);
  }

  function emitEvent(state, detail = {}) {
    if (disposed) return;
    if (!VALID_STATES.has(state)) {
      // Closed, versioned vocabulary — an unknown state is a programming
      // error here, never something to ship quietly.
      reportError(new Error(`VoiceTurnController: '${state}' is not in ${OYON_VOICE_STATES_VERSION}`));
      return;
    }
    lastEmittedState = state;
    if (typeof onEvent !== 'function') return;
    try {
      onEvent({
        state,
        timestamp_ms: now(),
        states_version: OYON_VOICE_STATES_VERSION,
        detail,
      });
    } catch (err) {
      reportError(err);
    }
  }

  function reportError(err) {
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* never let an error handler throw back */ }
    }
  }

  function addTrackListener(track, type, listener) {
    if (typeof track.addEventListener !== 'function') return;
    track.addEventListener(type, listener);
    trackListeners.push([track, type, listener]);
  }

  function removeTrackListeners() {
    for (const [track, type, listener] of trackListeners) {
      if (typeof track.removeEventListener === 'function') {
        track.removeEventListener(type, listener);
      }
    }
    trackListeners = [];
  }

  function audioTracks() {
    if (!stream) return [];
    if (typeof stream.getAudioTracks === 'function') return stream.getAudioTracks();
    if (typeof stream.getTracks === 'function') return stream.getTracks();
    return [];
  }

  function isTrackMuted() {
    return audioTracks().some(track => track.muted === true);
  }

  /**
   * Read `track.getSettings()` and surface the capture conditions the
   * aggregator's quality block needs (§5.6): echo cancellation, noise
   * suppression, AGC, sample rate, channel count — plus the derived
   * `loudness_contaminated` flag (AGC active ⇒ absolute loudness is an
   * artifact of the gain controller) and who owns the stream.
   */
  function readTrackSettings() {
    const track = audioTracks()[0] || null;
    const s = (track && typeof track.getSettings === 'function' ? track.getSettings() : null) || {};
    const agc = typeof s.autoGainControl === 'boolean' ? s.autoGainControl : null;
    return {
      echo_cancellation: typeof s.echoCancellation === 'boolean' ? s.echoCancellation : null,
      noise_suppression: typeof s.noiseSuppression === 'boolean' ? s.noiseSuppression : null,
      auto_gain_control: agc,
      sample_rate: Number.isFinite(s.sampleRate) ? s.sampleRate : null,
      channel_count: Number.isFinite(s.channelCount) ? s.channelCount : null,
      stream_owner: ownsStream ? 'oyon' : 'host',
      // AGC on (or unknown on a host stream) ⇒ absolute loudness is not
      // comparable across turns/users; the aggregator should prefer
      // within-turn relative measurements (§5.6).
      loudness_contaminated: agc === true || (!ownsStream && agc == null),
    };
  }

  /** True when teardown was requested while a start is pending. */
  function startCancelled() {
    return disposed || startCancelReason != null;
  }

  /**
   * Cancellation checkpoint outcome: a teardown request (dispose/stopTurn)
   * landed during startup. Release whatever was built so far — including
   * stopping any owned tracks the pending getUserMedia handed over — and
   * resolve the start as a REFUSAL, never an activation.
   */
  function refuseCancelledStart() {
    releaseTurnResources();
    return { ok: false, reason: disposed ? 'disposed' : startCancelReason };
  }

  async function startTurn({ userAction = false, stream: hostStream = null } = {}) {
    // ── The three-condition activation gate. getUserMedia is unreachable
    // until every one of these holds (§5.1, acceptance criterion 10.3).
    if (disposed) return { ok: false, reason: 'disposed' };
    if (active) return { ok: false, reason: 'turn_already_active' };
    // A second start while another is between its gate and activation would
    // acquire a SECOND stream and leak whichever track loses the race —
    // refuse it outright (see the refusal-contract header section).
    if (starting) return { ok: false, reason: 'start_in_progress' };
    if (settings.voice_enabled !== true) return { ok: false, reason: 'voice_disabled_in_settings' };
    if (!isHostEnabled()) return { ok: false, reason: 'host_not_enabled' };
    if (userAction !== true) return { ok: false, reason: 'no_user_action' };

    starting = true;
    startCancelReason = null;
    try {
      // Gate satisfied — acquire hardware (or adopt the host's stream).
      // EVERY await between here and `active = true` is a window where
      // dispose()/stopTurn() can land; each is followed by a cancellation
      // checkpoint, and the stream is adopted into `stream` the moment it
      // arrives so teardown can always stop the hardware.
      ownsStream = !hostStream;
      if (hostStream) {
        stream = hostStream;
      } else {
        stream = await getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate,
            echoCancellation: true,
            // §5.6: when Oyon owns the stream, request AGC off so absolute
            // loudness is a measurement, not a gain-controller artifact.
            autoGainControl: !requestAgcOff,
            noiseSuppression: true,
          },
        });
      }
      if (startCancelled()) return refuseCancelledStart();

      try {
        // 16 kHz context; documented linear-interpolation fallback when the
        // platform refuses the constructor (see header).
        try {
          audioContext = await audioContextFactory({ sampleRate });
          resampleMode = 'native-16k';
        } catch {
          audioContext = await audioContextFactory();
          resampleMode = 'linear-interpolation';
        }
        if (startCancelled()) return refuseCancelledStart();
        contextRate = Number.isFinite(audioContext?.sampleRate) ? audioContext.sampleRate : sampleRate;
        if (contextRate === sampleRate) resampleMode = 'native-16k';

        // Frame size at the CONTEXT rate; resampled frames land on exactly
        // round(frameMs · 16 kHz) samples (512 for 32 ms).
        const contextFrameSize = Math.max(1, Math.round((frameMs / 1000) * contextRate));

        if (audioContext?.audioWorklet?.addModule) {
          await audioContext.audioWorklet.addModule(workletUrl);
          if (startCancelled()) return refuseCancelledStart();
        }
        sourceNode = audioContext.createMediaStreamSource(stream);
        workletNode = createWorkletNode(audioContext, VOICE_FRAME_PROCESSOR_NAME, {
          processorOptions: { frameSize: contextFrameSize, clipThreshold },
        });
        sourceNode.connect(workletNode);
        // Keep the graph pulled; the processor emits silence downstream.
        if (audioContext.destination && typeof workletNode.connect === 'function') {
          try { workletNode.connect(audioContext.destination); } catch { /* optional */ }
        }
        workletNode.port.onmessage = (event) => handleWorkletMessage(event?.data);

        for (const track of audioTracks()) {
          addTrackListener(track, 'mute', () => {
            if (!active) return;
            mutedLast = true;
            emitEvent('muted', { muted: true });
          });
          addTrackListener(track, 'unmute', () => {
            if (!active) return;
            mutedLast = false;
          });
          // Track death (device unplugged, OS revoked) is a host-visible end.
          addTrackListener(track, 'ended', () => {
            if (active) stopTurn('track_ended');
          });
        }

        if (analysisPath) {
          // The analyzer memoizes its own init (worker construction + adapter
          // init happen once); reset() is the per-turn boundary: it zeroes
          // the VAD state and the dropped-frame counter.
          await analysisPath.init();
          if (startCancelled()) return refuseCancelledStart();
          if (typeof analysisPath.reset === 'function') await analysisPath.reset();
        } else if (vad) {
          if (!vadInitialized && typeof vad.init === 'function') {
            await vad.init();
            vadInitialized = true;
          }
          if (typeof vad.reset === 'function') vad.reset();
        }
        if (startCancelled()) return refuseCancelledStart();
      } catch (err) {
        // Failed mid-setup: never leave the microphone running.
        releaseTurnResources();
        // A failure PROVOKED by teardown (e.g. dispose() killed the analyzer
        // mid-init) still reads as the refusal it is, not a hardware error.
        if (startCancelled()) return { ok: false, reason: disposed ? 'disposed' : startCancelReason };
        throw err;
      }

      // Reset per-turn measurement state.
      turnStartMs = now();
      framesProcessed = 0;
      elapsedTurnMs = 0;
      speechRunMs = 0;
      silenceRunMs = 0;
      vadState = 'start';
      hadSpeech = false;
      pauseEmitted = false;
      contaminatedRun = false;
      contaminatedCount = 0;
      mutedLast = isTrackMuted();
      playbackIntervals = [];
      openPlaybackInterval = null;
      vadChain = Promise.resolve();
      trackSettingsReport = readTrackSettings();
      active = true;

      emitEvent('start', {
        track_settings: trackSettingsReport,
        resample_mode: resampleMode,
        context_sample_rate: contextRate,
        target_sample_rate: sampleRate,
        frame_ms: frameMs,
      });
      return { ok: true };
    } finally {
      starting = false;
      startCancelReason = null;
    }
  }

  function handleWorkletMessage(data) {
    if (!active || !data || data.type !== 'voice-frame') return;
    // Worker path: dispatch the frame to the analyzer IMMEDIATELY (so
    // several frames can be in flight and the worker pipeline stays full;
    // the analyzer bounds the backlog and drops oldest-first), but apply
    // the RESULTS strictly in arrival order through the chain below — the
    // speech state machine, like the VAD state itself, is order-sensitive.
    let analysisPromise = null;
    if (analysisPath) {
      const frame16k = resampleMode === 'linear-interpolation'
        ? linearResample(data.frame, contextRate, sampleRate)
        : data.frame;
      analysisPromise = analysisPath.analyze(frame16k, sampleRate)
        .catch((err) => { reportError(err); return null; });
    }
    const job = () => processFrame(data, analysisPromise);
    vadChain = vadChain.then(job, job).catch(reportError);
  }

  async function processFrame(data, analysisPromise = null) {
    if (!active) return; // stopped while queued
    const timestampMs = now();

    const clipped = (data.clipped_count || 0) > 0;
    if (clipped) {
      emitEvent('clipped', {
        frame_index: data.frame_index,
        clipped_count: data.clipped_count,
        peak: data.peak,
      });
    }

    const trackMuted = isTrackMuted();
    if (trackMuted && !mutedLast) emitEvent('muted', { muted: true, frame_index: data.frame_index });
    mutedLast = trackMuted;

    const inPlayback = openPlaybackInterval != null;

    let speechProbability = null;
    let frameFeatures = null; // analyzeFrame record from the analysis path
    let analysisDropped = false;
    let frame = null; // the 16 kHz sample frame exposed on the record
    if (analysisPromise) {
      // Worker (or same-thread fallback) analysis: VAD + full per-frame DSP
      // in one round trip. The frame buffer was TRANSFERRED to the analysis
      // context and comes back on the result — a dropped frame's buffer is
      // gone (see WorkerVoiceAnalyzer backpressure), so its record carries
      // an empty frame plus `analysis_dropped: true`.
      const result = await analysisPromise; // null when analyze() rejected
      if (!active) return; // stopTurn() raced the await
      if (result) {
        speechProbability = Number.isFinite(result.speechProbability) ? result.speechProbability : null;
        frameFeatures = result.features || null;
        analysisDropped = result.dropped === true;
        frame = result.frame instanceof Float32Array ? result.frame : null;
      }
      if (frame == null) frame = new Float32Array(0);
    } else {
      // Original in-thread path (`voice_worker_enabled: false`, no analyzer).
      frame = resampleMode === 'linear-interpolation'
        ? linearResample(data.frame, contextRate, sampleRate)
        : data.frame;
      if (vad && typeof vad.process === 'function') {
        try {
          const result = await vad.process(frame);
          speechProbability = Number.isFinite(result?.speechProbability) ? result.speechProbability : null;
        } catch (err) {
          reportError(err);
        }
      }
      if (!active) return; // stopTurn() raced the await
      // The worklet's cheap time-domain scalars ARE per-frame measurements —
      // ship them as a minimal `analyzeFrame`-shaped record so the
      // aggregator's speech/loudness accounting works on this path too. (It
      // ignores feature-less frames entirely, which previously made the
      // aggregate window contradict the event stream: events said 'speech'
      // while the window reported speech_duration_ms: 0 and a null
      // vad_coverage.) Fields this path cannot measure — spectrum, pitch,
      // voicing — stay null: unmeasured, never fabricated.
      frameFeatures = {
        rms: Number.isFinite(data.rms) ? data.rms : null,
        peak: Number.isFinite(data.peak) ? data.peak : null,
        clippedSamples: Number.isFinite(data.clipped_count) ? data.clipped_count : 0,
        zeroCrossingRate: Number.isFinite(data.zcr) ? data.zcr : null,
        centroidHz: null,
        rolloffHz: null,
        f0Hz: null,
        f0Confidence: null,
        voiced: null,
      };
    }

    const speechLike = speechProbability != null && speechProbability >= vadThreshold;

    if (inPlayback) {
      // §5.9: host playback intervals are excluded from learner-speech
      // measurement. Speech detected here is playback leakage, not the
      // learner — mark contaminated (once per contiguous run), never count.
      if (speechLike && !trackMuted) {
        if (!contaminatedRun) {
          contaminatedRun = true;
          contaminatedCount += 1;
          emitEvent('contaminated', {
            frame_index: data.frame_index,
            speech_probability: speechProbability,
          });
        }
      } else {
        contaminatedRun = false;
      }
    } else if (!trackMuted) {
      contaminatedRun = false;
      advanceSpeechMachine(speechLike, data.frame_index);
    }

    framesProcessed += 1;
    elapsedTurnMs += frameMs;

    if (typeof onFrameFeatures === 'function') {
      try {
        // Research-grade: the full per-frame record, including the raw
        // 16 kHz sample frame for downstream pitch/spectral DSP. Nothing
        // is withheld or downsampled. With the worker path active the
        // record additionally carries `features` (the analyzeFrame DSP
        // record computed off-thread) so hosts no longer need to run the
        // DSP on the main thread themselves.
        onFrameFeatures({
          frame_index: data.frame_index,
          timestamp_ms: timestampMs,
          frame,
          sample_rate: sampleRate,
          rms: data.rms,
          peak: data.peak,
          clipped_count: data.clipped_count,
          zcr: data.zcr,
          speech_probability: speechProbability,
          vad_state: vadState,
          in_playback: inPlayback,
          muted: trackMuted,
          resampled: resampleMode === 'linear-interpolation',
          // ── analysis-path fields (null / false on the legacy path) ──
          features: frameFeatures,
          analysis_dropped: analysisDropped,
          processing_mode: analysisPath ? analysisPath.mode ?? 'main-thread' : 'main-thread',
        });
      } catch (err) {
        reportError(err);
      }
    }
  }

  /**
   * Hysteresis over per-frame VAD decisions: `voice_min_speech_ms` of
   * consecutive speech-like frames before 'speech', `voice_min_silence_ms`
   * before 'silence', and an internal 'pause' once a post-speech silence
   * run reaches `voice_pause_threshold_ms` (emitted once per run).
   * Durations accumulate in frame units (frameMs per frame) so behaviour
   * is deterministic and clock-independent.
   */
  function advanceSpeechMachine(speechLike, frameIndex) {
    if (speechLike) {
      silenceRunMs = 0;
      speechRunMs += frameMs;
      if (vadState !== 'speech' && speechRunMs >= minSpeechMs) {
        vadState = 'speech';
        hadSpeech = true;
        pauseEmitted = false;
        emitEvent('speech', { frame_index: frameIndex });
      }
      return;
    }
    speechRunMs = 0;
    silenceRunMs += frameMs;
    if (vadState !== 'silence' && silenceRunMs >= minSilenceMs) {
      vadState = 'silence';
      pauseEmitted = false;
      emitEvent('silence', { frame_index: frameIndex });
    }
    if (vadState === 'silence' && hadSpeech && !pauseEmitted && silenceRunMs >= pauseThresholdMs) {
      pauseEmitted = true;
      emitEvent('pause', { frame_index: frameIndex, silence_run_ms: silenceRunMs });
    }
  }

  function aiPlaybackStart() {
    if (disposed || !active) return;
    if (openPlaybackInterval) return; // already inside an interval
    openPlaybackInterval = { start_ms: now(), end_ms: null };
    contaminatedRun = false;
    emitEvent('playback', { phase: 'start' });
  }

  function aiPlaybackEnd() {
    if (disposed || !active) return;
    if (!openPlaybackInterval) return;
    openPlaybackInterval.end_ms = now();
    playbackIntervals.push(openPlaybackInterval);
    openPlaybackInterval = null;
    contaminatedRun = false;
    emitEvent('playback', { phase: 'end' });
  }

  /**
   * Stop every owned MediaStreamTrack NOW, without touching the rest of the
   * graph. Called from releaseTurnResources() and directly by teardown
   * requests that land while a start is pending (the graph may not exist
   * yet, but the microphone might). Safe to call repeatedly —
   * MediaStreamTrack.stop() is idempotent.
   */
  function stopOwnedTracks() {
    if (!stream || !(ownsStream || stopHostStreamTracks)) return;
    const tracks = typeof stream.getTracks === 'function' ? stream.getTracks() : audioTracks();
    for (const track of tracks) {
      try { track.stop(); } catch { /* a dead track must not block the rest */ }
    }
  }

  /** Synchronous hardware release — see the class-comment teardown section. */
  function releaseTurnResources() {
    removeTrackListeners();
    stopOwnedTracks();
    if (workletNode) {
      if (workletNode.port) {
        workletNode.port.onmessage = null;
        if (typeof workletNode.port.close === 'function') {
          try { workletNode.port.close(); } catch { /* ignore */ }
        }
      }
      if (typeof workletNode.disconnect === 'function') {
        try { workletNode.disconnect(); } catch { /* ignore */ }
      }
    }
    if (sourceNode && typeof sourceNode.disconnect === 'function') {
      try { sourceNode.disconnect(); } catch { /* ignore */ }
    }
    if (audioContext && typeof audioContext.close === 'function') {
      // Fire-and-forget: the tracks are ALREADY stopped synchronously
      // above; context close is cleanup, not the privacy-critical step.
      try { Promise.resolve(audioContext.close()).catch(() => {}); } catch { /* ignore */ }
    }
    stream = null;
    audioContext = null;
    sourceNode = null;
    workletNode = null;
  }

  function stopTurn(reason = 'host_stop') {
    if (starting && !active) {
      // A stop landing during startup: stop any already-acquired owned
      // track IMMEDIATELY and mark the pending start cancelled — its next
      // checkpoint releases the rest and resolves the start as refused.
      // No turn ever became active, so there is no report and no 'end'.
      if (startCancelReason == null) startCancelReason = 'stopped_during_start';
      stopOwnedTracks();
      return null;
    }
    if (!active) return null;
    active = false; // queued VAD work becomes a no-op before anything async
    if (openPlaybackInterval) {
      openPlaybackInterval.end_ms = now();
      playbackIntervals.push(openPlaybackInterval);
      openPlaybackInterval = null;
    }
    releaseTurnResources();
    // Analysis-path health for the aggregator's quality block: which thread
    // measured this turn, and how many frames the backpressure bound
    // dropped. A third of the frames dropped must never read as a clean
    // measurement — the aggregator turns the ratio into insufficient_data.
    const droppedFrames = analysisPath && Number.isFinite(analysisPath.droppedFrames)
      ? analysisPath.droppedFrames
      : 0;
    const report = {
      reason,
      turn_duration_ms: turnStartMs != null ? Math.max(0, now() - turnStartMs) : null,
      frames_processed: framesProcessed,
      frame_coverage_ms: elapsedTurnMs,
      contaminated_runs: contaminatedCount,
      playback_intervals: playbackIntervals.map(interval => ({ ...interval })),
      track_settings: trackSettingsReport,
      resample_mode: resampleMode,
      processing_mode: analysisPath ? analysisPath.mode ?? 'main-thread' : 'main-thread',
      dropped_frames: droppedFrames,
      dropped_frame_ratio: framesProcessed > 0 ? droppedFrames / framesProcessed : null,
    };
    emitEvent('end', report);
    return report;
  }

  function dispose() {
    if (disposed) return;
    if (active) stopTurn('disposed');
    disposed = true; // after stopTurn so the final 'end' event still emits
    // dispose() during a pending startTurn(): the microphone may already be
    // live (getUserMedia resolved mid-start) — kill it NOW. The pending
    // start sees `disposed` at its next checkpoint, releases the rest of
    // the partial graph, and resolves { ok: false, reason: 'disposed' }.
    if (starting) stopOwnedTracks();
    if (ownsAnalyzer && analysisPath && typeof analysisPath.dispose === 'function') {
      // Only an analyzer the controller built itself is torn down here; a
      // caller-injected `analyzer` belongs to the caller.
      try { analysisPath.dispose(); } catch (err) { reportError(err); }
    }
  }

  return {
    startTurn,
    stopTurn,
    aiPlaybackStart,
    aiPlaybackEnd,
    dispose,
    getTrackSettings: () => (trackSettingsReport ? { ...trackSettingsReport } : null),
    get active() { return active; },
    /** The most recent emitted OYON_VOICE_STATES label (null before first turn). */
    get state() { return lastEmittedState; },
  };
}

/**
 * Linear-interpolation resampler — the documented FALLBACK for platforms
 * that refuse `new AudioContext({ sampleRate: 16000 })`. Not a general
 * resampler by design (audio_text.md §5.3): no anti-alias filtering, so
 * content above 8 kHz aliases. Acceptable for VAD/prosody features at
 * fallback quality; the primary path is browser-native resampling.
 */
export function linearResample(frame, fromRate, toRate) {
  if (!frame || frame.length === 0 || fromRate === toRate) return frame;
  const outLength = Math.max(1, Math.round(frame.length * (toRate / fromRate)));
  const out = new Float32Array(outLength);
  const step = (frame.length - 1) / Math.max(1, outLength - 1);
  for (let i = 0; i < outLength; i += 1) {
    const position = i * step;
    const lower = Math.floor(position);
    const upper = Math.min(frame.length - 1, lower + 1);
    const t = position - lower;
    out[i] = frame[lower] * (1 - t) + frame[upper] * t;
  }
  return out;
}

function defaultGetUserMedia(constraints) {
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }
  return globalThis.navigator.mediaDevices.getUserMedia(constraints);
}

function defaultAudioContextFactory(contextOptions) {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) throw new Error('AudioContext is not available in this browser.');
  return contextOptions ? new Ctor(contextOptions) : new Ctor();
}

function defaultCreateWorkletNode(audioContext, name, nodeOptions) {
  const Ctor = globalThis.AudioWorkletNode;
  if (!Ctor) throw new Error('AudioWorkletNode is not available in this browser.');
  return new Ctor(audioContext, name, nodeOptions);
}

function defaultWorkletUrl() {
  return new URL('./voiceFrameWorklet.js', import.meta.url).href;
}

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
