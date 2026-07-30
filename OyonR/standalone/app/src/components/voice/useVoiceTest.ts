import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as oyonRuntime from 'oyon';
import { IndexedDbOyonStore, SignalEventLog, createOyonSettings } from 'oyon';
import type {
  VoiceAggregatorEvent,
  VoiceControllerEvent,
  VoiceControllerFrame,
  VoiceFrameFeatures,
  VoiceMetrics,
  VoiceProcessingMode,
  VoiceQuality,
  VoiceStateLabel,
  VoiceTarget,
  VoiceTurnController,
  VoiceTurnRefusalReason,
  VoiceTurnReport,
  VoiceVadAdapter,
  VoiceWindow,
  WorkerVoiceAnalyzer,
} from '../../../../../types/voice';
import type { VoiceFrameSample } from '@/lib/voiceChartMath';
import type { IdbStoreRuntime } from '@/lib/idbTransport';
import { STORED_EVENTS_QUERY_KEY } from '@/lib/storedEvents';
import { useSettings } from '@/lib/settingsStore';
import { createSignalEventBatcher, type SignalEventBatcher } from '../typing/signalEventPersistence';

/*
 * useVoiceTest — wires the REAL voice pipeline into the Live page's
 * diagnostic modal:
 *
 *   createVoiceTurnController (mic + AudioWorklet framing + VAD gate)
 *     → analyzeFrame (per-frame DSP: RMS / spectrum / F0)
 *     → VoiceTurnAggregator (voice-v1 episode window)
 *     → SignalEventLog → createSignalEventBatcher → IndexedDB
 *       `oyon-app`/`signal_events`, window → `signal_windows`
 *
 * Follows useTypingTest's structure (refs for pipeline objects, teardown as
 * the unmount contract, batched IDB persistence, query invalidation) with
 * the voice-specific differences:
 *
 *  - ACTIVATION GATE (honoured, never bypassed): the controller's own
 *    three-condition gate stays authoritative. `voice_enabled` is read from
 *    the app settings store and passed through `createOyonSettings` into
 *    the controller — if it is off, `startTurn()` resolves a refusal and no
 *    microphone hardware is touched. `hostEnabled: true` because this app
 *    IS the host and the modal is its explicit voice surface; the
 *    `userAction: true` flag is only ever passed from the Start button's
 *    click handler.
 *
 *  - WORKER ANALYSIS by default (`voice_worker_enabled`, default on): the
 *    hook builds a WorkerVoiceAnalyzer itself — with `vadEnabled: true`
 *    and NO injected adapter instance, so Silero is constructed INSIDE the
 *    dedicated Worker (an injected instance cannot cross a thread boundary
 *    and would force main-thread mode). That matters here specifically:
 *    this app already runs MediaPipe face, MediaPipe pose, and ONNX
 *    emotion on the main thread at 16 fps, and voice is expected to run
 *    concurrently with them. The analyzer is built by the hook (not by the
 *    controller) so its `mode` / `fallbackReason` / `droppedFrames` stay
 *    readable for the modal's badges; the controller receives it via its
 *    `analyzer` option and the hook owns its disposal.
 *
 *  - VAD fallback, visibly (never silently): if the worker cannot start or
 *    Silero fails to init, the analyzer falls back to main-thread analysis
 *    with a `fallbackReason` — surfaced as `processingMode` +
 *    `workerFallbackReason` and badged in the modal. If Silero is
 *    unreachable EVERYWHERE (no network, private release), the hook keeps
 *    its app-local energy-threshold VAD as the last resort (injected as an
 *    instance, which by construction runs main-thread); which engine
 *    produced the numbers is surfaced (`vadEngine` + `vadReason`), badged
 *    in the modal, and persisted on the stored row (`vad_engine`) so no
 *    chart ever presents fallback numbers as neural-VAD measurements.
 *    With `voice_worker_enabled` off, the ORIGINAL in-thread adapter path
 *    runs (chooseVadAdapter + injected instance), reported as
 *    `main-thread` with the setting named as the reason.
 *
 *  - TEARDOWN is the critical property: `teardown()` stops the turn (the
 *    controller stops every MediaStreamTrack synchronously), finalizes and
 *    persists the partial window (record everything — an interrupted turn
 *    is data, not garbage), disposes the VAD adapter and flushes the event
 *    batcher. The modal calls it on close/unmount; a generation counter
 *    makes a teardown that races a pending getUserMedia stop the stream
 *    the moment the controller finishes acquiring it.
 *
 * Library/typing gaps found while wiring (reported, worked around here):
 *  - types/index.d.ts (the app's mapped types for the bare `oyon` entry)
 *    does not re-export the voice surface even though src/index.js does;
 *    the runtime namespace is cast against `typeof import('types/voice')`.
 *  - types/signal-events.d.ts's SignalEventModality union predates the
 *    voice pipeline ('voice' IS registered in the runtime vocabulary,
 *    src/version.js); `log.record` is cast for voice events.
 */

// ── Untyped-runtime bridge (see header: types/index.d.ts gap) ───────────────

type VoiceModule = typeof import('../../../../../types/voice');

const {
  createVoiceTurnController,
  VoiceTurnAggregator,
  analyzeFrame,
  SileroVadAdapter,
  createWorkerVoiceAnalyzer,
} = oyonRuntime as unknown as {
  createVoiceTurnController: VoiceModule['createVoiceTurnController'];
  VoiceTurnAggregator: VoiceModule['VoiceTurnAggregator'];
  analyzeFrame: VoiceModule['analyzeFrame'];
  /** Not declared in types/voice.d.ts; the adapter contract is. */
  SileroVadAdapter: new (options?: Record<string, unknown>) => VoiceVadAdapter;
  createWorkerVoiceAnalyzer: VoiceModule['createWorkerVoiceAnalyzer'];
};

type VoiceAggregator = InstanceType<VoiceModule['VoiceTurnAggregator']>;

// ── voice_enabled gate plumbing (app settings store) ────────────────────────
// The Voice section of /settings owns the writes; this hook only reads.

/** Reactive read of the persisted `voice_enabled` app setting. */
export function useVoiceEnabled(): boolean {
  return useSettings((s) => s.voice_enabled === true);
}

/** The persisted voice_* settings, as `createOyonSettings` input. */
function voiceSettingsInput() {
  const s = useSettings.getState();
  return {
    voice_enabled: s.voice_enabled,
    voice_worker_enabled: s.voice_worker_enabled,
    voice_frame_ms: s.voice_frame_ms,
    voice_vad_threshold: s.voice_vad_threshold,
    voice_min_speech_ms: s.voice_min_speech_ms,
    voice_min_silence_ms: s.voice_min_silence_ms,
    voice_pause_threshold_ms: s.voice_pause_threshold_ms,
    voice_request_agc_off: s.voice_request_agc_off,
    voice_engine: s.voice_engine,
  };
}

// ── Stored row shape (writer-defined; /analyze/voice reads it back) ─────────

/**
 * One stored voice turn row in `signal_windows`. The library `VoiceWindow`
 * fields plus the transport-stamped ids, PLUS the app-level additive
 * research-record fields: the full per-frame series and the controller's
 * stop report (playback intervals, track settings) — the voice-v1 window
 * deliberately carries only summaries, and the charts need the observations.
 */
export interface StoredVoiceWindow {
  modality: 'voice';
  window_kind: 'episode';
  /** 'voice-v1' today; widened so future profiles keep reading. */
  feature_profile: string;
  window_start: string;
  window_end: string;
  voice: VoiceMetrics;
  quality?: VoiceQuality;
  target?: VoiceTarget;
  window_id?: string;
  capture_id?: string | null;
  session_id?: string | null;
  /** Which VAD produced the speech decisions — never present fallback numbers as neural. */
  vad_engine?: VadEngine | null;
  /** Full per-frame record (app-additive; see lib/voiceChartMath.d.ts). */
  frame_series?: VoiceFrameSample[];
  /** The controller's stopTurn() report (playback intervals, track settings). */
  turn_report?: VoiceTurnReport | null;
}

export const STORED_VOICE_WINDOWS_QUERY_KEY = ['stored-voice-windows'] as const;

// ── Energy-threshold fallback VAD ───────────────────────────────────────────

/** RMS at which the fallback maps to probability 0.5 (≈ quiet close-mic speech). */
const ENERGY_SPEECH_RMS = 0.02;

/**
 * App-local energy-threshold VAD: speechProbability = clamp(rms / (2 ×
 * ENERGY_SPEECH_RMS)). Monotone in loudness, crosses the default 0.5
 * threshold at rms 0.02. Crude by design — it exists so the pipeline stays
 * exercisable without the Silero model, and it is ALWAYS badged as the
 * fallback so its numbers are never mistaken for neural VAD output.
 */
class EnergyVadAdapter implements VoiceVadAdapter {
  init(): void {}
  process(frame: Float32Array): { speechProbability: number } {
    let sumSq = 0;
    for (let i = 0; i < frame.length; i += 1) sumSq += frame[i] * frame[i];
    const rms = frame.length > 0 ? Math.sqrt(sumSq / frame.length) : 0;
    return { speechProbability: Math.max(0, Math.min(1, rms / (2 * ENERGY_SPEECH_RMS))) };
  }
  reset(): void {}
  dispose(): void {}
}

export type VadEngine = 'silero' | 'energy';

const SILERO_INIT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Try the real Silero adapter (ORT + ONNX model download); fall back to the
 * energy-threshold VAD with the failure reason preserved for the badge.
 */
async function chooseVadAdapter(): Promise<{ vad: VoiceVadAdapter; engine: VadEngine; reason: string | null }> {
  const silero = new SileroVadAdapter();
  try {
    await withTimeout(
      Promise.resolve(silero.init?.()),
      SILERO_INIT_TIMEOUT_MS,
      `Silero VAD init timed out after ${SILERO_INIT_TIMEOUT_MS / 1000}s`,
    );
    return { vad: silero, engine: 'silero', reason: null };
  } catch (error) {
    try { silero.dispose?.(); } catch { /* a failed adapter must not block the fallback */ }
    const reason = error instanceof Error ? error.message : String(error);
    return { vad: new EnergyVadAdapter(), engine: 'energy', reason };
  }
}

// ── Error copy ──────────────────────────────────────────────────────────────

/** Readable copy for getUserMedia failures — denied and dismissed included. */
function describeMicError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Microphone permission was denied (or the prompt was dismissed). Nothing was recorded and no microphone is running. Allow microphone access for this site from the browser address bar, then start again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No microphone was found on this device.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'A microphone exists but could not be opened — another application may be holding it.';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Microphone setup failed: ${message}`;
}

const REFUSAL_COPY: Record<VoiceTurnRefusalReason, string> = {
  voice_disabled_in_settings:
    'The controller refused: voice_enabled is off in settings. No microphone hardware was touched.',
  host_not_enabled: 'The controller refused: the host has not enabled voice for this activity.',
  no_user_action: 'The controller refused: a turn must start from a deliberate user action.',
  turn_already_active: 'A turn is already active.',
  start_in_progress: 'Another turn is still starting up — wait for it to finish.',
  stopped_during_start: 'The turn was stopped while it was still starting up.',
  disposed: 'This controller was already disposed — close and reopen the test.',
};

// ── Hook ────────────────────────────────────────────────────────────────────

export type VoiceTestStatus = 'idle' | 'starting' | 'recording' | 'finalized';
export type VoiceTestPhase = 'vad-init' | 'mic-permission' | null;

export interface VoiceTestCounts {
  /** Frames the controller delivered (each ran the full DSP + aggregator path). */
  frames: number;
  /** State events the SignalEventLog accepted. */
  loggedStates: number;
  persisted: number;
  pendingWrites: number;
  failedWrites: number;
}

export interface VoiceLiveReadout {
  /** Most recent controller state (voice-states-v1 label). */
  state: VoiceStateLabel | null;
  /** Frame-time elapsed (frames × frame_ms) — the aggregator's own clock. */
  elapsedMs: number;
  rms: number;
  peak: number;
  /** Live F0 when the last frame was voiced; null otherwise (never 0). */
  f0Hz: number | null;
  f0Confidence: number | null;
  speechProbability: number | null;
  /** Frame-time so far judged speech-like (p >= threshold, non-playback, unmuted). */
  speechMs: number;
  clippedFrames: number;
  /**
   * Frames whose analysis (VAD + DSP) was dropped by the analyzer's bounded
   * backpressure so far this turn. Backpressure drops are exactly the thing
   * a user would otherwise never notice — surfaced live, not just in the
   * final report.
   */
  droppedFrames: number;
}

const ZERO_COUNTS: VoiceTestCounts = {
  frames: 0,
  loggedStates: 0,
  persisted: 0,
  pendingWrites: 0,
  failedWrites: 0,
};

const LIVE_UPDATE_MS = 150;

function makeCaptureId(): string {
  return `voice-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function useVoiceTest({ sessionId }: { sessionId?: string | null } = {}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<VoiceTestStatus>('idle');
  const [phase, setPhase] = useState<VoiceTestPhase>(null);
  const [vadEngine, setVadEngine] = useState<VadEngine | null>(null);
  const [vadReason, setVadReason] = useState<string | null>(null);
  /** Which thread analyzed this turn ('worker' is the point of the feature). */
  const [processingMode, setProcessingMode] = useState<VoiceProcessingMode | null>(null);
  /** Why the analyzer is NOT in worker mode — a silent fallback would make
   *  the feature look fine while doing exactly what the worker exists to avoid. */
  const [workerFallbackReason, setWorkerFallbackReason] = useState<string | null>(null);
  /** Whether `voice_worker_enabled` was on when this turn started (so the
   *  modal can tell "fell back" apart from "off by choice"). */
  const [workerRequested, setWorkerRequested] = useState<boolean>(true);
  const [gateError, setGateError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [live, setLive] = useState<VoiceLiveReadout | null>(null);
  const [finalWindow, setFinalWindow] = useState<VoiceWindow | null>(null);
  const [counts, setCounts] = useState<VoiceTestCounts>(ZERO_COUNTS);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  const controllerRef = useRef<VoiceTurnController | null>(null);
  const aggregatorRef = useRef<VoiceAggregator | null>(null);
  const vadRef = useRef<VoiceVadAdapter | null>(null);
  /** The hook-owned WorkerVoiceAnalyzer (worker path); disposed in teardown. */
  const analyzerRef = useRef<WorkerVoiceAnalyzer | null>(null);
  const logRef = useRef<SignalEventLog | null>(null);
  const persistRef = useRef<SignalEventBatcher | null>(null);
  const storeRef = useRef<IdbStoreRuntime | null>(null);
  const framesRef = useRef<VoiceFrameSample[]>([]);
  const frameMsRef = useRef(32);
  const vadThresholdRef = useRef(0.5);
  const vadEngineRef = useRef<VadEngine | null>(null);
  const lastStateRef = useRef<VoiceStateLabel | null>(null);
  const liveCountersRef = useRef({ speechMs: 0, clippedFrames: 0, droppedFrames: 0 });
  const lastLiveUpdateRef = useRef(0);
  const captureIdRef = useRef<string | null>(null);
  const episodeSessionIdRef = useRef<string | null>(null);
  const stopInitiatedRef = useRef(false);
  const tearingDownRef = useRef(false);
  // Bumped by teardown; a startTurn that awaited across a teardown detects
  // the mismatch and releases whatever it just acquired (the mic race guard).
  const generationRef = useRef(0);
  const sessionIdRef = useRef<string | null | undefined>(sessionId);
  sessionIdRef.current = sessionId;

  const refreshCounts = useCallback(() => {
    const persist = persistRef.current;
    setCounts({
      frames: framesRef.current.length,
      loggedStates: logRef.current?.size ?? 0,
      persisted: persist?.writtenCount ?? 0,
      pendingWrites: persist?.pendingCount ?? 0,
      failedWrites: persist?.failedCount ?? 0,
    });
  }, []);

  const flushAndNotify = useCallback(() => {
    const persist = persistRef.current;
    if (!persist) return;
    void persist.flush().then(() => {
      refreshCounts();
      void queryClient.invalidateQueries({ queryKey: STORED_EVENTS_QUERY_KEY });
    });
  }, [queryClient, refreshCounts]);

  /**
   * Persist the finalized turn WINDOW (plus the per-frame series and the
   * controller report) to `signal_windows` so it shows on /analyze/voice.
   * Fire-and-forget; a failure is surfaced but never blocks teardown.
   */
  const persistWindow = useCallback(
    (window: VoiceWindow, report: VoiceTurnReport | null) => {
      const store = storeRef.current;
      if (!store) return;
      const row: StoredVoiceWindow = {
        ...window,
        window_id: `win_${captureIdRef.current ?? makeCaptureId()}`,
        capture_id: captureIdRef.current,
        session_id: episodeSessionIdRef.current,
        vad_engine: vadEngineRef.current,
        frame_series: framesRef.current.slice(),
        turn_report: report ?? null,
      };
      void store
        .bulkAdd('signal_windows', [row])
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: STORED_VOICE_WINDOWS_QUERY_KEY });
        })
        .catch((error: unknown) => {
          console.error('[voice-test] turn window persistence failed', error);
          if (!tearingDownRef.current) {
            setPersistError(error instanceof Error ? error.message : String(error));
          }
        });
    },
    [queryClient],
  );

  /** Finalize the aggregator's turn (idempotent — no-op when none is active). */
  const finalizeTurn = useCallback(
    (report: VoiceTurnReport | null) => {
      const aggregator = aggregatorRef.current;
      if (!aggregator || !aggregator.active) return;
      const window = aggregator.finalize({ timestamp: nowMs(), report });
      if (window) {
        persistWindow(window, report);
        if (!tearingDownRef.current) {
          setFinalWindow(window);
          setStatus('finalized');
          setPhase(null);
        }
      }
      flushAndNotify();
    },
    [flushAndNotify, persistWindow],
  );

  /**
   * Full release of the current episode's resources. The controller stops
   * every MediaStreamTrack synchronously inside stopTurn(); an in-flight
   * turn is finalized AND persisted first (an interrupted turn is data).
   */
  const teardown = useCallback(() => {
    generationRef.current += 1;
    tearingDownRef.current = true;
    try {
      const controller = controllerRef.current;
      controllerRef.current = null;
      if (controller) {
        if (controller.active) {
          stopInitiatedRef.current = true;
          let report: VoiceTurnReport | null = null;
          try {
            report = controller.stopTurn('teardown'); // stops all tracks NOW
          } finally {
            stopInitiatedRef.current = false;
          }
          finalizeTurn(report);
        }
        controller.dispose();
      }
      // The analyzer is hook-owned (passed to the controller via `analyzer`,
      // which deliberately does NOT dispose caller-supplied analyzers) —
      // dispose it here, after stopTurn() has read its droppedFrames.
      const analyzer = analyzerRef.current;
      analyzerRef.current = null;
      if (analyzer) {
        try { analyzer.dispose(); } catch { /* never block teardown */ }
      }
      try { vadRef.current?.dispose?.(); } catch { /* never block teardown */ }
      vadRef.current = null;
      aggregatorRef.current = null;
      logRef.current = null;
      const persist = persistRef.current;
      persistRef.current = null;
      if (persist) {
        void persist.dispose().then(() => {
          void queryClient.invalidateQueries({ queryKey: STORED_EVENTS_QUERY_KEY });
        });
      }
    } finally {
      tearingDownRef.current = false;
    }
  }, [finalizeTurn, queryClient]);

  /** Start one voice turn. Only ever called from a user click (the gate's userAction). */
  const startTurn = useCallback(async () => {
    if (status === 'starting' || controllerRef.current?.active) return;
    // Release any previous episode's pipeline before building a fresh one.
    teardown();
    const generation = generationRef.current;

    setGateError(null);
    setMicError(null);
    setPersistError(null);
    setFinalWindow(null);
    setLive(null);
    setCounts(ZERO_COUNTS);
    framesRef.current = [];
    liveCountersRef.current = { speechMs: 0, clippedFrames: 0, droppedFrames: 0 };
    lastStateRef.current = null;
    setProcessingMode(null);
    setWorkerFallbackReason(null);

    const id = makeCaptureId();
    captureIdRef.current = id;
    episodeSessionIdRef.current = sessionIdRef.current ?? id;
    setCaptureId(id);

    // Same database the rest of the app reads ('oyon-app').
    storeRef.current ??= new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
    const persist = createSignalEventBatcher({
      store: storeRef.current,
      batchSize: 20,
      onError: (error) => {
        console.error('[voice-test] signal event persistence failed', error);
        setPersistError(error instanceof Error ? error.message : String(error));
        refreshCounts();
      },
    });
    persistRef.current = persist;
    const log = new SignalEventLog({ onEvent: persist.write });
    log.start({ capture_id: id, session_id: episodeSessionIdRef.current });
    logRef.current = log;

    // The controller-facing settings: the persisted voice_* values (Settings →
    // Voice) pass through createOyonSettings UNTOUCHED — if voice_enabled is
    // off, the controller refuses below.
    const voiceSettings = createOyonSettings(voiceSettingsInput());
    const frameMs = Number(voiceSettings.voice_frame_ms) || 32;
    const vadThreshold = Number(voiceSettings.voice_vad_threshold) || 0.5;
    const pauseThresholdMs = Number(voiceSettings.voice_pause_threshold_ms) || 500;
    frameMsRef.current = frameMs;
    vadThresholdRef.current = vadThreshold;

    const aggregator = new VoiceTurnAggregator({
      frameMs,
      vadThreshold,
      pauseThresholdMs,
      onEvent: (event: VoiceAggregatorEvent) => {
        // signal-events.d.ts's modality union predates 'voice' (runtime
        // vocabulary has it — src/version.js). Cast until the .d.ts catches up.
        log.record(event as unknown as Parameters<SignalEventLog['record']>[0]);
        if (!tearingDownRef.current) refreshCounts();
      },
    });
    aggregatorRef.current = aggregator;

    setStatus('starting');
    setPhase('vad-init');

    // ── analysis path (worker by default; audio_text.md §5.2) ──
    const workerEnabled = voiceSettings.voice_worker_enabled !== false;
    setWorkerRequested(workerEnabled);
    let analyzer: WorkerVoiceAnalyzer | null = null;
    let vad: VoiceVadAdapter | null = null;
    if (workerEnabled) {
      // Build the analyzer HERE, not through the controller: no VAD instance
      // is injected, so Silero is constructed INSIDE the worker (an instance
      // cannot cross the thread boundary and would force main-thread mode),
      // and the analyzer object stays in the hook's hands so `mode`,
      // `fallbackReason` and `droppedFrames` are readable for the badges.
      let candidate: WorkerVoiceAnalyzer | null = createWorkerVoiceAnalyzer({
        settings: voiceSettings,
        sampleRate: 16000,
        vadEnabled: true,
        initTimeoutMs: SILERO_INIT_TIMEOUT_MS,
        onError: (error: unknown) => console.warn('[voice-test] voice analyzer', error),
      });
      let initFailure: string | null = null;
      try {
        // init() itself never rejects (the analyzer always lands on SOME
        // backend) — this outer timeout bounds a stalled in-process Silero
        // model fetch, which unlike the worker attempt has no deadline.
        await withTimeout(
          candidate.init(),
          2 * SILERO_INIT_TIMEOUT_MS,
          `Voice analyzer init timed out after ${(2 * SILERO_INIT_TIMEOUT_MS) / 1000}s`,
        );
      } catch (error) {
        initFailure = error instanceof Error ? error.message : String(error);
        try { candidate.dispose(); } catch { /* a failed analyzer must not block the fallback */ }
        candidate = null;
      }
      if (generation !== generationRef.current) {
        // Torn down while the worker/model loaded — release and walk away.
        try { candidate?.dispose(); } catch { /* ignore */ }
        return;
      }
      if (candidate != null && candidate.engine === 'silero') {
        // Silero is live — in the worker, or in the analyzer's VISIBLE
        // main-thread fallback (`fallbackReason` says why).
        analyzer = candidate;
        vadEngineRef.current = 'silero';
        setVadEngine('silero');
        setVadReason(null);
        setWorkerFallbackReason(analyzer.mode === 'worker' ? null : analyzer.fallbackReason);
      } else {
        // Silero failed in the worker AND in the in-process retry: keep the
        // app's energy-threshold last resort so the pipeline stays
        // exercisable offline. Injecting the instance forces main-thread
        // mode by construction; the ORIGINAL failure is what gets surfaced.
        const reason = initFailure ?? candidate?.fallbackReason ?? 'Silero VAD init failed';
        try { candidate?.dispose(); } catch { /* ignore */ }
        analyzer = createWorkerVoiceAnalyzer({
          settings: voiceSettings,
          sampleRate: 16000,
          vad: new EnergyVadAdapter(),
          onError: (error: unknown) => console.warn('[voice-test] voice analyzer', error),
        });
        await analyzer.init(); // in-process, no network — cannot hang
        if (generation !== generationRef.current) {
          try { analyzer.dispose(); } catch { /* ignore */ }
          return;
        }
        vadEngineRef.current = 'energy';
        setVadEngine('energy');
        setVadReason(reason);
        setWorkerFallbackReason(reason);
      }
      analyzerRef.current = analyzer;
      setProcessingMode(analyzer.mode);
    } else {
      // Legacy in-thread path (voice_worker_enabled off in Settings): the
      // original adapter-instance injection, chosen before touching the mic.
      const chosen = await chooseVadAdapter();
      if (generation !== generationRef.current) {
        // Torn down while the model loaded — release and walk away.
        try { chosen.vad.dispose?.(); } catch { /* ignore */ }
        return;
      }
      vadRef.current = chosen.vad;
      vadEngineRef.current = chosen.engine;
      setVadEngine(chosen.engine);
      setVadReason(chosen.reason);
      setProcessingMode('main-thread');
      // Wrap so the controller's own init() call cannot re-initialize Silero
      // (we already init'ed above to decide the engine before touching the mic).
      vad = {
        init: () => undefined,
        process: (frame) => chosen.vad.process(frame),
        reset: () => chosen.vad.reset?.(),
        dispose: () => chosen.vad.dispose?.(),
      };
    }

    const publishLive = (frame: VoiceControllerFrame, features: VoiceFrameFeatures | null) => {
      const now = Date.now();
      if (now - lastLiveUpdateRef.current < LIVE_UPDATE_MS || tearingDownRef.current) return;
      lastLiveUpdateRef.current = now;
      setLive({
        state: lastStateRef.current,
        elapsedMs: framesRef.current.length * frameMsRef.current,
        // Dropped frames have no DSP record; the worklet's cheap scalars
        // were still measured and keep the meter moving.
        rms: features ? features.rms : frame.rms,
        peak: features ? features.peak : frame.peak,
        f0Hz: features?.voiced ? features.f0Hz : null,
        f0Confidence: features?.voiced ? features.f0Confidence : null,
        speechProbability: frame.speech_probability,
        speechMs: liveCountersRef.current.speechMs,
        clippedFrames: liveCountersRef.current.clippedFrames,
        droppedFrames: liveCountersRef.current.droppedFrames,
      });
      refreshCounts();
    };

    const handleFrame = (frame: VoiceControllerFrame) => {
      const agg = aggregatorRef.current;
      if (!agg || !agg.active) return;
      if (frame.analysis_dropped) {
        // Backpressure drop: this frame's VAD + DSP never ran (and its
        // sample buffer is gone). The worklet scalars WERE measured, so the
        // per-frame record keeps a row — but there is no DSP record for the
        // aggregator; the drop is counted here and in the stop report.
        liveCountersRef.current.droppedFrames += 1;
        framesRef.current.push({
          t: frame.timestamp_ms,
          rms: frame.rms,
          p: null,
          f0: null,
          conf: 0,
          voiced: false,
          clipped: frame.clipped_count > 0,
          playback: frame.in_playback,
          muted: frame.muted,
        });
        publishLive(frame, null);
        return;
      }
      // Worker path: the DSP record was computed off-thread and arrives on
      // the frame. Only the legacy in-thread path (voice_worker_enabled off,
      // `features` null) computes it here on the main thread.
      let features = frame.features;
      if (!features) {
        try {
          features = analyzeFrame(frame.frame, frame.sample_rate);
        } catch (error) {
          console.warn('[voice-test] per-frame DSP failed', error);
          return;
        }
      }
      agg.recordFrame(features, {
        timestamp: frame.timestamp_ms,
        speechProbability: frame.speech_probability,
        inPlayback: frame.in_playback,
        muted: frame.muted,
      });
      framesRef.current.push({
        t: frame.timestamp_ms,
        rms: features.rms,
        p: frame.speech_probability,
        f0: features.f0Hz,
        // Legacy in-thread capture reports pitch confidence / voicing as
        // null (unmeasured); the chart row coerces to its no-pitch shape.
        conf: features.f0Confidence ?? 0,
        voiced: features.voiced === true,
        clipped: features.clippedSamples > 0,
        playback: frame.in_playback,
        muted: frame.muted,
      });
      const speechLike = frame.speech_probability != null
        && frame.speech_probability >= vadThresholdRef.current
        && !frame.in_playback
        && !frame.muted;
      if (speechLike) liveCountersRef.current.speechMs += frameMsRef.current;
      if (features.clippedSamples > 0) liveCountersRef.current.clippedFrames += 1;

      publishLive(frame, features);
    };

    const handleEvent = (event: VoiceControllerEvent) => {
      lastStateRef.current = event.state;
      const agg = aggregatorRef.current;
      if (agg?.active) agg.recordEvent(event);
      if (event.state === 'end' && !stopInitiatedRef.current) {
        // The controller ended the turn on its own (track died, device
        // unplugged, OS revoked). Its 'end' detail IS the stop report.
        finalizeTurn(event.detail as unknown as VoiceTurnReport);
      }
    };

    const controller = createVoiceTurnController({
      settings: voiceSettings,
      // Worker path: hand the hook-owned analyzer to the controller (it
      // inits/resets it per turn but never disposes it — teardown does).
      // Legacy path: the wrapped adapter instance, exactly as before.
      ...(analyzer ? { analyzer } : { vad }),
      hostEnabled: true, // this app is the host; the modal is its voice surface
      onFrameFeatures: handleFrame,
      onEvent: handleEvent,
      onError: (error) => console.warn('[voice-test] controller error', error),
    });
    controllerRef.current = controller;

    aggregator.start({ timestamp: nowMs(), targetKind: 'voice_test', targetId: 'live-voice-test' });

    setPhase('mic-permission');
    try {
      const result = await controller.startTurn({ userAction: true });
      if (generation !== generationRef.current) {
        // Torn down while the permission prompt was up: if the stream came
        // through anyway, stop it immediately — never leave a mic running.
        try { controller.stopTurn('teardown'); } catch { /* ignore */ }
        controller.dispose();
        return;
      }
      if (!result.ok) {
        setGateError(REFUSAL_COPY[result.reason] ?? `Refused: ${result.reason}`);
        setStatus('idle');
        setPhase(null);
        return;
      }
      setStatus('recording');
      setPhase(null);
    } catch (error) {
      if (generation !== generationRef.current) {
        controller.dispose();
        return;
      }
      // Hardware/permission failure — the controller already released
      // everything it acquired mid-setup. Never leave the UI spinning.
      setMicError(describeMicError(error));
      setStatus('idle');
      setPhase(null);
    }
  }, [finalizeTurn, refreshCounts, status, teardown]);

  /** Stop the turn, finalize the voice-v1 window, persist it. */
  const stop = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller || !controller.active) return;
    stopInitiatedRef.current = true;
    let report: VoiceTurnReport | null = null;
    try {
      report = controller.stopTurn('user_stop'); // tracks stop synchronously here
    } finally {
      stopInitiatedRef.current = false;
    }
    finalizeTurn(report);
  }, [finalizeTurn]);

  return {
    status,
    phase,
    vadEngine,
    vadReason,
    /** 'worker' | 'main-thread' | null — which thread analyzed this turn. */
    processingMode,
    /** Why the analyzer is not in worker mode (null in worker mode / before start). */
    workerFallbackReason,
    /** Whether voice_worker_enabled was on when the turn started. */
    workerRequested,
    gateError,
    micError,
    live,
    finalWindow,
    counts,
    captureId,
    persistError,
    /** The recorded per-frame series (for rendering charts after stop). */
    framesRef,
    startTurn,
    stop,
    teardown,
  };
}
