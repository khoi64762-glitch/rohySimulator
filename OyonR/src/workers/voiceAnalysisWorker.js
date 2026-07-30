/**
 * voiceAnalysisWorker — the dedicated-Worker half of the voice analysis
 * split (audio_text.md §5.2). This module owns everything expensive about
 * per-frame voice analysis: the neural VAD (Silero via ONNX Runtime) and
 * the per-frame DSP (`analyzeFrame`: FFT + spectral shape + NSDF pitch).
 * The AudioWorklet stays framing-only (ORT cannot run there — no fetch, no
 * module loading in `AudioWorkletGlobalScope`), and the main thread — where
 * MediaPipe face, MediaPipe pose, and ONNX emotion already run at 16 fps —
 * keeps only aggregation and UI. Three tiers:
 *
 *   AudioWorklet (voiceFrameWorklet.js)  — framing + cheap time-domain scalars
 *   Worker (THIS FILE)                   — VAD (ORT) + FFT + spectral + pitch
 *   Main thread (WorkerVoiceAnalyzer.js) — proxy, backpressure, aggregation
 *
 * ── Message protocol (voice-worker-v1) ───────────────────────────────────
 * All messages are plain objects with a `type` discriminant.
 *
 * in  → { type: 'init', settings, modelUrl, wasmPaths, vadEnabled }
 *         `settings` is a plain object of `voice_*` settings (cloneable);
 *         `vadEnabled: true` makes the worker construct its own VAD adapter
 *         (`createVadAdapter` from `settings.voice_engine`, with `modelUrl`
 *         / `wasmPaths` forwarded); `false` runs DSP-only (speechProbability
 *         stays null).
 * out ← { type: 'ready', engine }            engine: 'silero' | 'none'
 * out ← { type: 'error', message }           init (or adapter) failure
 *
 * in  → { type: 'frame', seq, sampleRate, buffer }
 *         `buffer` is the frame's ArrayBuffer (Float32Array samples),
 *         TRANSFERRED — never structured-cloned. `seq` is a caller-chosen
 *         monotonically increasing id; it round-trips unchanged so the main
 *         thread can detect drops, reordering, and stale responses.
 * out ← { type: 'features', seq, sampleRate, buffer, features,
 *         speechProbability, vad_error? }
 *         `buffer` is the SAME ArrayBuffer transferred back (zero copies in
 *         either direction); `features` is the `analyzeFrame` record;
 *         `speechProbability` is the VAD output (null without a VAD or on a
 *         VAD error, in which case `vad_error` carries the message).
 * out ← { type: 'error', seq, message }      per-frame failure (bad buffer,
 *                                            frame before init, …)
 *
 * in  → { type: 'reset' }    zero VAD state (turn boundary); no reply
 * in  → { type: 'dispose' }  release the adapter; terminal; no reply
 *
 * Frames are processed strictly in arrival order (Silero's LSTM state is
 * order-sensitive), so `features` responses always come back in `seq`
 * order; only the proxy's own drop bookkeeping ever resolves out of order.
 *
 * ── Dual-load guard (same trick as voiceFrameWorklet.js) ─────────────────
 * This file loads two ways: as a module Worker in the browser
 * (`new Worker(url, { type: 'module' })`, where `DedicatedWorkerGlobalScope`
 * exists and the bottom of this file wires `self.onmessage`) and as a plain
 * ES module in Node tests / `node --check` (where it does not, and only the
 * named exports are used). `createVoiceAnalysisWorkerCore` is the pure
 * message-handling engine — tests drive it directly, and
 * `createInProcessVoiceAnalysisWorker` wraps it in a Worker-shaped shim
 * that `WorkerVoiceAnalyzer` uses as its same-thread fallback, so the
 * worker path and the fallback path run literally the same code.
 */

import { analyzeFrame } from '../analytics/voiceFeatures.js';
import { createVadAdapter, normalizeVoiceEngine } from '../inference/SileroVadAdapter.js';

export const VOICE_WORKER_PROTOCOL_VERSION = 'voice-worker-v1';

const DEFAULT_SAMPLE_RATE = 16000;

/**
 * Pure message-handling core of the voice analysis worker, separated from
 * the Worker global wiring so Node tests can exercise it without a real
 * Worker and the main-thread fallback can reuse it unchanged.
 *
 * @param {object} [options]
 * @param {(adapterOptions: object) => object} [options.createAdapter]
 *   VAD adapter factory (default `createVadAdapter` → SileroVadAdapter).
 *   Tests inject `() => new MockVadAdapter(...)`; the main-thread fallback
 *   injects `() => vadInstance` when the caller supplied an adapter.
 * @param {(frame: Float32Array, sampleRate: number) => object} [options.analyze]
 *   Per-frame DSP (default `analyzeFrame`).
 * @returns {{ handleMessage(message: object, post: Function): Promise<void> }}
 *   `post(message, transfer?)` is invoked with every outbound message.
 *   `handleMessage` resolves when the message is fully handled (frames are
 *   still serialized internally in arrival order).
 */
export function createVoiceAnalysisWorkerCore(options = {}) {
  const {
    createAdapter = createVadAdapter,
    analyze = analyzeFrame,
  } = options;

  let vad = null;
  let engine = 'none';
  let initialized = false;
  let disposed = false;
  // Frames must run strictly in arrival order — Silero's LSTM state makes
  // the whole computation order-sensitive (same rule the controller and
  // the adapter itself apply).
  let chain = Promise.resolve();

  async function handleInit(message, post) {
    if (disposed) {
      post({ type: 'error', message: 'voiceAnalysisWorker: init after dispose' });
      return;
    }
    try {
      const settings = message.settings && typeof message.settings === 'object' ? message.settings : {};
      if (message.vadEnabled === true) {
        engine = normalizeVoiceEngine(settings.voice_engine);
        const adapterOptions = { engine };
        if (message.modelUrl != null) adapterOptions.modelUrl = message.modelUrl;
        if (message.wasmPaths != null) adapterOptions.wasmPaths = message.wasmPaths;
        vad = createAdapter(adapterOptions);
        if (vad && typeof vad.init === 'function') await vad.init();
      } else {
        engine = 'none';
        vad = null;
      }
      initialized = true;
      post({ type: 'ready', engine });
    } catch (err) {
      vad = null;
      initialized = false;
      post({ type: 'error', message: `voiceAnalysisWorker: init failed — ${errorMessage(err)}` });
    }
  }

  async function handleFrame(message, post) {
    const seq = message.seq;
    if (disposed || !initialized) {
      post({ type: 'error', seq, message: 'voiceAnalysisWorker: frame received before init (or after dispose)' });
      return;
    }
    let frame;
    try {
      frame = new Float32Array(message.buffer);
    } catch (err) {
      post({ type: 'error', seq, message: `voiceAnalysisWorker: bad frame buffer — ${errorMessage(err)}` });
      return;
    }
    const sampleRate = Number.isFinite(message.sampleRate) && message.sampleRate > 0
      ? message.sampleRate
      : DEFAULT_SAMPLE_RATE;

    let features = null;
    try {
      features = analyze(frame, sampleRate);
    } catch (err) {
      post({ type: 'error', seq, message: `voiceAnalysisWorker: analyzeFrame failed — ${errorMessage(err)}` });
      return;
    }

    let speechProbability = null;
    let vadError = null;
    if (vad && typeof vad.process === 'function') {
      try {
        const result = await vad.process(frame);
        speechProbability = Number.isFinite(result?.speechProbability) ? result.speechProbability : null;
      } catch (err) {
        // A VAD failure must not withhold the DSP record (research-grade
        // policy: expose what was measured, flag what was not).
        vadError = errorMessage(err);
      }
    }

    const out = { type: 'features', seq, sampleRate, buffer: frame.buffer, features, speechProbability };
    if (vadError != null) out.vad_error = vadError;
    // Transfer the buffer straight back — zero-copy in both directions.
    post(out, [frame.buffer]);
  }

  function handleReset(post) {
    if (disposed) return;
    if (vad && typeof vad.reset === 'function') {
      try {
        vad.reset();
      } catch (err) {
        post({ type: 'error', message: `voiceAnalysisWorker: reset failed — ${errorMessage(err)}` });
      }
    }
  }

  function handleDispose() {
    if (disposed) return;
    disposed = true;
    initialized = false;
    if (vad && typeof vad.dispose === 'function') {
      try { vad.dispose(); } catch { /* a dying adapter must not block teardown */ }
    }
    vad = null;
  }

  function handleMessage(message, post) {
    const send = typeof post === 'function' ? post : () => {};
    if (!message || typeof message.type !== 'string') {
      send({ type: 'error', message: 'voiceAnalysisWorker: malformed message (no type)' });
      return Promise.resolve();
    }
    let job;
    switch (message.type) {
      case 'init': job = () => handleInit(message, send); break;
      case 'frame': job = () => handleFrame(message, send); break;
      case 'reset': job = () => handleReset(send); break;
      case 'dispose': job = () => handleDispose(); break;
      default:
        send({ type: 'error', message: `voiceAnalysisWorker: unknown message type '${message.type}'` });
        return Promise.resolve();
    }
    const result = chain.then(job, job);
    // Keep the internal chain unrejected so one failure cannot poison every
    // later message; handlers report their own errors via post().
    chain = result.catch(() => {});
    return result;
  }

  return { handleMessage };
}

/**
 * Worker-shaped wrapper around the core, for the SAME-THREAD fallback path:
 * `{ postMessage, onmessage, terminate }` matching the subset of the Worker
 * interface `WorkerVoiceAnalyzer` uses. Because it wraps the identical
 * core, the fallback path produces byte-identical results to the worker
 * path — only the thread differs. Transfer lists are accepted and ignored
 * (nothing crosses a thread boundary here, so nothing needs transferring).
 */
export function createInProcessVoiceAnalysisWorker(coreOptions = {}) {
  const core = createVoiceAnalysisWorkerCore(coreOptions);
  const shim = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      // Unlike Worker.postMessage (which returns undefined), the shim
      // returns the handling promise so same-thread callers can await
      // completion — e.g. the proxy's reset() awaits the VAD state zeroing.
      return core.handleMessage(message, (out) => {
        if (typeof shim.onmessage === 'function') shim.onmessage({ data: out });
      });
    },
    terminate() {
      core.handleMessage({ type: 'dispose' }, () => {});
    },
  };
  return shim;
}

function errorMessage(err) {
  return String(err?.message ?? err);
}

// ── Worker global wiring ────────────────────────────────────────────────
// Present only inside a real dedicated Worker (`DedicatedWorkerGlobalScope`
// exists there and nowhere else — not in Node, not on the browser main
// thread), mirroring how voiceFrameWorklet.js guards `registerProcessor`.
if (
  typeof self !== 'undefined'
  && typeof DedicatedWorkerGlobalScope !== 'undefined'
  && self instanceof DedicatedWorkerGlobalScope
) {
  const core = createVoiceAnalysisWorkerCore();
  const post = (message, transfer) => self.postMessage(message, transfer || []);
  self.onmessage = (event) => { core.handleMessage(event?.data, post); };
}
