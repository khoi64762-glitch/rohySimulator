/**
 * WorkerVoiceAnalyzer — main-thread proxy for the voice analysis Worker
 * (src/workers/voiceAnalysisWorker.js; protocol `voice-worker-v1`).
 *
 * Moves the expensive per-frame voice work — Silero VAD (ONNX Runtime) and
 * the FFT/spectral/NSDF-pitch DSP — off the main thread, where MediaPipe
 * face, MediaPipe pose, and ONNX emotion already run at 16 fps. The
 * realistic ChatOyon scenario is a learner speaking WHILE those camera
 * pipelines run; this proxy is what makes that concurrency viable
 * (audio_text.md §5.2).
 *
 * Surface (what `VoiceTurnController` consumes):
 *
 *   const analyzer = createWorkerVoiceAnalyzer(options);
 *   await analyzer.init();
 *   const { features, speechProbability, frame, dropped } =
 *     await analyzer.analyze(frame, sampleRate);
 *   analyzer.reset();      // turn boundary: zero VAD state + drop counter
 *   analyzer.dispose();    // terminate the worker; idempotent
 *   analyzer.engine        // 'silero' | 'none'
 *   analyzer.mode          // 'worker' | 'main-thread' (null before init)
 *   analyzer.droppedFrames // frames dropped by backpressure since reset()
 *
 * ── Fallback (never silent) ──────────────────────────────────────────────
 * When `Worker` is unavailable, worker construction throws, or worker init
 * fails or times out, the proxy falls back to SAME-THREAD analysis through
 * `createInProcessVoiceAnalysisWorker` — the identical message-handling
 * core, so results are byte-identical; only the thread differs. The
 * fallback is visible, not silent: `mode` reports `'main-thread'`,
 * `fallbackReason` says why, and every failure is surfaced through
 * `onError`. A caller-supplied `vad` adapter INSTANCE also forces
 * main-thread mode (`fallbackReason: 'injected_vad_adapter'`) — an object
 * cannot cross a thread boundary; to run VAD inside the worker, pass
 * `vadEnabled: true` and let the worker construct its own adapter from
 * `settings.voice_engine` (+ `modelUrl` / `wasmPaths`).
 *
 * ── Backpressure (bounded pipeline + one-deep held slot) ─────────────────
 * Frames arrive every ~32 ms. If the worker falls behind, queuing without
 * bound grows memory until the tab dies — and a message POSTED to a worker
 * sits in its inbound queue whether or not anyone still awaits it, so the
 * bound must be enforced BEFORE postMessage, not on the pending map alone.
 * The proxy therefore posts AT MOST `maxInFlight` (default 2) frames into
 * the worker pipeline; while the pipeline is full, the NEWEST frame waits
 * in a one-deep held slot and is posted the moment a response frees a
 * pipeline place. Arrivals beyond that drop the pipeline's oldest
 * still-awaited promise (so the caller's ordered chain keeps moving; the
 * worker's eventual response for that seq is discarded as stale) and then
 * displace the held frame. A dropped frame's promise resolves
 * `{ dropped: true, features: null, speechProbability: null }` — with
 * `frame` set to the untouched samples when the drop happened in the held
 * slot (its buffer was never transferred away), null when the frame was
 * already inside the worker. Newest-frame freshness wins over
 * completeness, and the degradation is COUNTED — the controller puts
 * `droppedFrames` into the `stopTurn()` report, and the aggregator flags
 * `insufficient_data: ['dropped_frames']` past its documented threshold, so
 * a degraded turn can never read as a clean measurement. Backpressure
 * applies to worker mode only: in main-thread mode the analysis is
 * performed by this same thread anyway, so refusing frames would lose data
 * without freeing any capacity (this also preserves the pre-worker
 * serialized-chain semantics of the fallback path exactly).
 *
 * The result: a stalled worker holds at most `maxInFlight` frames in its
 * inbound queue — never a turn's worth — and the stall is surfaced by a
 * large `dropped_frame_ratio` and released by `dispose()`.
 *
 * `seq` round-trips through the worker so drops, reordering, and stale
 * responses are detected exactly (pending map keyed by seq); an unknown or
 * already-dropped seq in a response is ignored without corrupting state.
 */

import { createInProcessVoiceAnalysisWorker } from '../workers/voiceAnalysisWorker.js';

// Re-exported so `oyon/voice/worker` is the complete worker surface: the
// proxy, the worker's pure message core, its in-process wrapper, and the
// protocol version tag.
export {
  createVoiceAnalysisWorkerCore,
  createInProcessVoiceAnalysisWorker,
  VOICE_WORKER_PROTOCOL_VERSION,
} from '../workers/voiceAnalysisWorker.js';

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_MAX_IN_FLIGHT = 2;
const DEFAULT_INIT_TIMEOUT_MS = 8000;

/**
 * @param {object} [options]
 * @param {object} [options.settings]  Oyon settings; the `voice_*` keys are
 *   forwarded to the worker (they are plain cloneable primitives).
 * @param {number} [options.sampleRate=16000]  default frame sample rate.
 * @param {object|null} [options.vad]  VAD adapter INSTANCE — forces
 *   main-thread mode (see header) and is used by the fallback core.
 * @param {boolean|null} [options.vadEnabled]  true → the worker constructs
 *   its own adapter (Silero by default). Default: true iff `vad` was given.
 * @param {string} [options.modelUrl]    forwarded to the worker's adapter.
 * @param {string|object} [options.wasmPaths]  forwarded to the worker's adapter.
 * @param {Function} [options.workerFactory]  `(url?) => Worker-like | null`;
 *   injectable for tests. Default constructs the module worker with the
 *   bundler-visible `new Worker(new URL(...), { type: 'module' })` form.
 * @param {string|URL} [options.workerUrl]  override the worker URL (for
 *   bundlers that cannot resolve `import.meta.url`-relative assets).
 * @param {number} [options.maxInFlight=2]  backpressure bound (worker mode).
 * @param {number} [options.initTimeoutMs=8000]  worker init deadline before
 *   falling back to main-thread mode.
 * @param {Function|null} [options.onError]  error sink; never throws back.
 * @param {object} [options.coreOptions]  extra options for the fallback
 *   core (tests inject `createAdapter` here).
 */
export function createWorkerVoiceAnalyzer(options = {}) {
  const {
    settings = {},
    sampleRate: defaultSampleRate = DEFAULT_SAMPLE_RATE,
    vad = null,
    vadEnabled = null,
    modelUrl = null,
    wasmPaths = null,
    workerFactory = defaultWorkerFactory,
    workerUrl = null,
    maxInFlight = DEFAULT_MAX_IN_FLIGHT,
    initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS,
    onError = null,
    coreOptions = {},
  } = options;

  const wantVad = vadEnabled === true || (vadEnabled == null && vad != null);
  const inFlightLimit = Number.isInteger(maxInFlight) && maxInFlight > 0
    ? maxInFlight
    : DEFAULT_MAX_IN_FLIGHT;

  let backend = null;
  let mode = null; // 'worker' | 'main-thread' — set by init()
  let engine = 'none';
  let fallbackReason = null;
  let disposed = false;
  let initPromise = null;
  // Backend candidate currently mid-initialization: dispose() must be able
  // to terminate it even though init() has not adopted it yet — otherwise a
  // dispose() racing init() leaks a live worker forever.
  let initCandidate = null;
  let seq = 0;
  let droppedFrames = 0;
  const pending = new Map(); // seq → { resolve } (Map preserves insertion order)
  // Seqs actually POSTED to the backend whose response has not arrived yet —
  // the true worker-pipeline depth. Differs from `pending` once a posted
  // frame's promise has been dropped: the promise is settled but the frame
  // still occupies the worker's inbound queue until its (stale) response.
  const postedSeqs = new Set();
  // One-deep slot for the newest frame while the pipeline is full (worker
  // mode only) — see the backpressure header section.
  let held = null; // { seq, entry, frame, sampleRate }

  function reportError(err) {
    if (typeof onError === 'function') {
      try { onError(err); } catch { /* an error sink must never throw back */ }
    }
  }

  function noteFallback(reason) {
    if (fallbackReason == null) fallbackReason = reason;
  }

  /** Only the cloneable voice_* keys cross the thread boundary. */
  function voiceSettingsSnapshot() {
    const out = {};
    for (const key of Object.keys(settings)) {
      if (key.startsWith('voice_')) out[key] = settings[key];
    }
    return out;
  }

  function handleRuntimeMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'features') {
      postedSeqs.delete(message.seq); // a response frees one pipeline place
      const entry = pending.get(message.seq);
      if (!entry) {
        promoteHeld(); // stale response for a dropped seq still frees a place
        return;
      }
      pending.delete(message.seq);
      if (message.vad_error != null) {
        reportError(new Error(`WorkerVoiceAnalyzer: VAD error — ${message.vad_error}`));
      }
      entry.resolve({
        seq: message.seq,
        dropped: false,
        features: message.features ?? null,
        speechProbability: Number.isFinite(message.speechProbability) ? message.speechProbability : null,
        frame: message.buffer instanceof ArrayBuffer ? new Float32Array(message.buffer) : null,
        error: message.vad_error != null ? String(message.vad_error) : null,
      });
      promoteHeld();
      return;
    }
    if (message.type === 'error') {
      const err = new Error(message.message || 'WorkerVoiceAnalyzer: analysis error');
      reportError(err);
      postedSeqs.delete(message.seq);
      if (pending.has(message.seq)) {
        const entry = pending.get(message.seq);
        pending.delete(message.seq);
        entry.resolve({
          seq: message.seq,
          dropped: false,
          features: null,
          speechProbability: null,
          frame: null,
          error: err.message,
        });
      }
      promoteHeld();
    }
  }

  /**
   * Post 'init' to a candidate backend and await ready/error. Resolves true
   * on ready (runtime handlers attached), false on error/timeout. The
   * timeout applies only to real workers — the in-process core is
   * same-thread and cannot be abandoned mid-init.
   */
  function initBackend(candidate, { useTimeout, vadOff = false } = {}) {
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        if (timer != null) clearTimeout(timer);
        resolve(ok);
      };
      if (useTimeout && Number.isFinite(initTimeoutMs) && initTimeoutMs > 0) {
        timer = setTimeout(() => {
          noteFallback('init_timeout');
          reportError(new Error(`WorkerVoiceAnalyzer: worker init timed out after ${initTimeoutMs} ms`));
          finish(false);
        }, initTimeoutMs);
      }
      candidate.onmessage = (event) => {
        const message = event?.data;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'ready') {
          engine = typeof message.engine === 'string' ? message.engine : 'none';
          candidate.onmessage = (evt) => handleRuntimeMessage(evt?.data);
          finish(true);
        } else if (message.type === 'error') {
          noteFallback(message.message || 'init_error');
          reportError(new Error(message.message || 'WorkerVoiceAnalyzer: init failed'));
          finish(false);
        }
      };
      if ('onerror' in candidate || typeof candidate.onerror !== 'undefined') {
        candidate.onerror = (err) => {
          noteFallback('worker_error');
          reportError(err instanceof Error ? err : new Error(String(err?.message ?? err)));
          finish(false);
        };
      }
      try {
        candidate.postMessage({
          type: 'init',
          settings: voiceSettingsSnapshot(),
          modelUrl,
          wasmPaths,
          vadEnabled: vadOff ? false : wantVad,
        });
      } catch (err) {
        noteFallback('init_post_failed');
        reportError(err);
        finish(false);
      }
    });
  }

  async function doInit() {
    // Every await below is a window where dispose() can land: each candidate
    // is registered in `initCandidate` (so dispose() can terminate it
    // immediately) and `disposed` is re-checked before adoption (so a
    // candidate that reports ready after dispose() is shut down, never
    // adopted — the leak the old code had was a worker that finished init
    // after dispose() and became an unreachable live backend).

    // ── worker path ──
    if (vad != null) {
      // An adapter instance cannot cross a thread boundary.
      noteFallback('injected_vad_adapter');
    } else {
      let worker = null;
      try {
        worker = workerFactory(workerUrl);
      } catch (err) {
        noteFallback('worker_construction_failed');
        reportError(err);
      }
      if (worker == null) {
        noteFallback('worker_unavailable');
      } else {
        initCandidate = worker;
        const ok = await initBackend(worker, { useTimeout: true });
        initCandidate = null;
        if (disposed) {
          shutDownBackend(worker);
          return;
        }
        if (ok) {
          backend = worker;
          mode = 'worker';
          return;
        }
        if (typeof worker.terminate === 'function') {
          try { worker.terminate(); } catch { /* ignore */ }
        }
      }
    }
    if (disposed) return;

    // ── same-thread fallback: the identical core, in-process ──
    const shimOptions = { ...(vad != null ? { createAdapter: () => vad } : {}), ...coreOptions };
    const shim = createInProcessVoiceAnalysisWorker(shimOptions);
    initCandidate = shim;
    const ok = await initBackend(shim, { useTimeout: false });
    initCandidate = null;
    if (disposed) {
      shutDownBackend(shim);
      return;
    }
    if (ok) {
      backend = shim;
      mode = 'main-thread';
      return;
    }
    // Even the same-thread adapter failed to init (e.g. model unreachable):
    // run DSP-only so per-frame features are still measured; the failure was
    // already surfaced through onError and fallbackReason.
    const bare = createInProcessVoiceAnalysisWorker(coreOptions);
    initCandidate = bare;
    await initBackend(bare, { useTimeout: false, vadOff: true });
    initCandidate = null;
    if (disposed) {
      shutDownBackend(bare);
      return;
    }
    backend = bare;
    mode = 'main-thread';
    engine = 'none';
  }

  function init() {
    if (disposed) return Promise.reject(new Error('WorkerVoiceAnalyzer: init after dispose()'));
    if (!initPromise) initPromise = doInit();
    return initPromise;
  }

  /** Drop a POSTED frame's promise (its buffer is already in the worker). */
  function dropEntry(entrySeq, entry) {
    pending.delete(entrySeq);
    droppedFrames += 1;
    entry.resolve({
      seq: entrySeq,
      dropped: true,
      features: null,
      speechProbability: null,
      // The buffer was already transferred to the worker; nothing to return.
      frame: null,
      error: null,
    });
  }

  /** Drop the HELD frame — never posted, so its samples come back intact. */
  function dropHeld() {
    const stale = held;
    held = null;
    droppedFrames += 1;
    stale.entry.resolve({
      seq: stale.seq,
      dropped: true,
      features: null,
      speechProbability: null,
      frame: stale.frame,
      error: null,
    });
  }

  /** Post one frame into the backend pipeline, settling on a post failure. */
  function dispatchFrame(frameSeq, entry, frame, sampleRate) {
    pending.set(frameSeq, entry);
    postedSeqs.add(frameSeq);
    // Views on shared or offset buffers cannot be transferred whole;
    // compact once (rare — worklet and resampler frames own their buffer).
    const compact = frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength
      ? frame
      : frame.slice();
    try {
      backend.postMessage(
        { type: 'frame', seq: frameSeq, sampleRate, buffer: compact.buffer },
        [compact.buffer],
      );
    } catch (err) {
      pending.delete(frameSeq);
      postedSeqs.delete(frameSeq);
      reportError(err);
      entry.resolve({ seq: frameSeq, dropped: false, features: null, speechProbability: null, frame: null, error: String(err?.message ?? err) });
    }
  }

  /** A pipeline place freed up: post the held frame, if any. */
  function promoteHeld() {
    if (held == null || backend == null || disposed) return;
    if (postedSeqs.size >= inFlightLimit) return;
    const next = held;
    held = null;
    dispatchFrame(next.seq, next.entry, next.frame, next.sampleRate);
  }

  function analyze(frame, sampleRate = defaultSampleRate) {
    if (disposed) return Promise.reject(new Error('WorkerVoiceAnalyzer: analyze after dispose()'));
    if (backend == null) return Promise.reject(new Error('WorkerVoiceAnalyzer: init() must complete before analyze()'));
    if (!(frame instanceof Float32Array)) {
      return Promise.reject(new TypeError('WorkerVoiceAnalyzer: analyze() requires a Float32Array frame'));
    }
    seq += 1;
    const frameSeq = seq;
    return new Promise((resolve) => {
      const entry = { resolve };
      // Backpressure (worker mode only — see header): the pipeline bound is
      // enforced BEFORE postMessage, because a posted frame occupies the
      // worker's inbound queue regardless of what happens to its promise.
      if (mode === 'worker' && postedSeqs.size >= inFlightLimit) {
        // Keep the caller's ordered chain moving: settle the oldest posted
        // promise as dropped (its stale response is discarded on arrival)…
        const oldestSeq = pending.keys().next().value;
        if (oldestSeq !== undefined) dropEntry(oldestSeq, pending.get(oldestSeq));
        // …and park the NEWEST frame in the held slot, displacing (and
        // counting) whatever was waiting there.
        if (held != null) dropHeld();
        held = { seq: frameSeq, entry, frame, sampleRate };
        return;
      }
      dispatchFrame(frameSeq, entry, frame, sampleRate);
    });
  }

  function reset() {
    droppedFrames = 0;
    // Frames still in flight belong to the previous turn: resolve them as
    // dropped (uncounted — the turn is over) and discard late responses.
    for (const [pendingSeq, entry] of pending) {
      pending.delete(pendingSeq);
      entry.resolve({ seq: pendingSeq, dropped: true, features: null, speechProbability: null, frame: null, error: null });
    }
    if (held != null) {
      const stale = held;
      held = null;
      stale.entry.resolve({ seq: stale.seq, dropped: true, features: null, speechProbability: null, frame: stale.frame, error: null });
    }
    postedSeqs.clear();
    if (backend != null && !disposed) {
      try {
        // The in-process shim returns the handling promise (a real Worker
        // returns undefined but guarantees in-order processing instead) —
        // returning it lets same-thread callers await the state zeroing.
        const done = backend.postMessage({ type: 'reset' });
        if (done && typeof done.then === 'function') return done;
      } catch (err) {
        reportError(err);
      }
    }
    return Promise.resolve();
  }

  /** Tear down a backend or candidate: dispose message + terminate. */
  function shutDownBackend(target) {
    if (target == null) return;
    try { target.postMessage({ type: 'dispose' }); } catch { /* ignore */ }
    if (typeof target.terminate === 'function') {
      try { target.terminate(); } catch { /* ignore */ }
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [pendingSeq, entry] of pending) {
      pending.delete(pendingSeq);
      entry.resolve({ seq: pendingSeq, dropped: true, features: null, speechProbability: null, frame: null, error: null });
    }
    if (held != null) {
      const stale = held;
      held = null;
      stale.entry.resolve({ seq: stale.seq, dropped: true, features: null, speechProbability: null, frame: stale.frame, error: null });
    }
    postedSeqs.clear();
    // A backend candidate still mid-init (dispose() racing init()) must be
    // terminated too — doInit() also re-checks `disposed` after every await
    // so a candidate that reports ready afterwards is never adopted.
    if (initCandidate != null) {
      shutDownBackend(initCandidate);
      initCandidate = null;
    }
    if (backend != null) {
      shutDownBackend(backend);
      backend = null;
    }
  }

  return {
    init,
    analyze,
    reset,
    dispose,
    get engine() { return engine; },
    get mode() { return mode; },
    get droppedFrames() { return droppedFrames; },
    get fallbackReason() { return fallbackReason; },
    /** Frames posted into the backend pipeline, awaiting a response — the
     *  true worker inbound-queue depth, bounded by `maxInFlight`. */
    get inFlight() { return postedSeqs.size; },
    /** Frames parked in the one-deep held slot (0 or 1). */
    get heldFrames() { return held == null ? 0 : 1; },
  };
}

/**
 * Default worker construction — the exact `new Worker(new URL(...),
 * { type: 'module' })` form bundlers (Vite, webpack 5, Rollup with the
 * appropriate plugin) statically detect and rewrite. Returns null when the
 * environment has no `Worker` (Node, some SSR contexts) so the caller falls
 * back to main-thread mode instead of throwing.
 */
function defaultWorkerFactory(workerUrl) {
  if (typeof Worker !== 'function') return null;
  if (workerUrl != null) return new Worker(workerUrl, { type: 'module' });
  return new Worker(new URL('../workers/voiceAnalysisWorker.js', import.meta.url), { type: 'module' });
}
