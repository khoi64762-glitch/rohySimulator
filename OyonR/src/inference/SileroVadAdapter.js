/**
 * SileroVadAdapter — neural voice-activity detection via Silero VAD ONNX,
 * executed through ONNX Runtime Web the same way `OnnxEmotionClassifier`
 * does (dynamic ORT import, `wasmPaths` from cdnDefaults, pinned versions).
 *
 * ── Where this runs (thread placement) ──────────────────────────────────
 * NOT in the AudioWorklet — `AudioWorkletGlobalScope` has no fetch/XHR, so
 * ORT cannot load its WASM there, and the render thread cannot absorb
 * inference jitter. This adapter is deliberately Worker-compatible: no
 * DOM, no `window`, no canvas — only ORT and typed arrays — so the
 * recommended production deployment instantiates it inside a dedicated
 * Worker (behind a postMessage proxy exposing the same
 * `{ init, process, reset, dispose }` surface) to keep inference off the
 * main thread, where MediaPipe face/pose and ONNX emotion already run at
 * 16 fps. It also runs directly on the main thread for lighter setups.
 *
 * ── Silero v5 model contract (the specifics that MUST be right) ─────────
 *   • Input `input`: exactly 512 samples at 16 kHz per call — plus the 64
 *     trailing samples of the PREVIOUS chunk prepended as context, so the
 *     tensor fed to the model is [1, 576]. The context starts as zeros and
 *     is re-zeroed by reset().
 *   • Input `state`: an LSTM state tensor [2, 1, 128] that MUST be carried
 *     across calls — the model returns the next state as output `stateN`,
 *     and that exact tensor is what call N+1 must feed. Dropping or
 *     re-zeroing it silently degrades detection; this is THE classic
 *     Silero integration bug, invisible to any test that feeds a single
 *     chunk. `tests/vad-adapter.test.js` asserts identity threading across
 *     consecutive calls.
 *   • Input `sr`: sample rate as an int64 tensor (16000).
 *   • Output `output`: [1, 1] speech probability in [0, 1].
 *
 * Because the state is order-sensitive, `process()` serializes internally:
 * overlapping calls are queued and executed strictly in call order.
 *
 * Adapter surface (mirrors the gaze adapter + mock + factory pattern —
 * see GazeAdapterFactory / MockWebEyeTrackAdapter):
 *   init()                       — load ORT + create the session
 *   process(frame) → Promise<{ speechProbability }>
 *   reset()                      — zero LSTM state + context (per turn)
 *   dispose()                    — release the session; idempotent
 *
 * `MockVadAdapter` (src/mocks/) is the deterministic drop-in for tests.
 */

import {
  ONNX_RUNTIME_WASM_CDN,
  SILERO_VAD_MODEL_URL,
  SILERO_VAD_MODEL_VERSION,
} from '../config/cdnDefaults.js';
import { resolveWasmPaths } from './OnnxEmotionClassifier.js';

export const VOICE_ENGINE_SILERO = 'silero';
export const SUPPORTED_VOICE_ENGINES = Object.freeze([VOICE_ENGINE_SILERO]);

export const SILERO_SAMPLE_RATE = 16000;
export const SILERO_FRAME_SAMPLES = 512;
export const SILERO_CONTEXT_SAMPLES = 64;
export const SILERO_STATE_DIMS = Object.freeze([2, 1, 128]);

const STATE_SIZE = SILERO_STATE_DIMS[0] * SILERO_STATE_DIMS[1] * SILERO_STATE_DIMS[2];

export class SileroVadAdapter {
  constructor(options = {}) {
    this.options = {
      modelUrl: SILERO_VAD_MODEL_URL,
      wasmPaths: ONNX_RUNTIME_WASM_CDN,
      executionProviders: null,
      // Silero v5 ONNX I/O names; overridable for repackaged exports.
      inputName: 'input',
      stateName: 'state',
      srName: 'sr',
      outputName: 'output',
      stateOutputName: 'stateN',
      sampleRate: SILERO_SAMPLE_RATE,
      // Test/Worker injection point: pass a preloaded ORT namespace to skip
      // the dynamic import (fake ORT in tests, a Worker-scoped import in
      // production Workers).
      ortModule: null,
      modelName: 'silero-vad',
      modelVersion: SILERO_VAD_MODEL_VERSION,
      ...options,
    };
    this.ort = null;
    this.session = null;
    this._stateTensor = null;
    this._context = null;
    this._srTensor = null;
    this._disposed = false;
    this._queue = Promise.resolve();
    // Turn-boundary epoch: bumped by every reset() (and dispose()) so work
    // that predates a reset can neither run against the fresh state nor
    // commit its stale LSTM state / audio context over it — see reset().
    this._epoch = 0;
  }

  async init() {
    if (this._disposed) throw new Error('SileroVadAdapter: cannot init after dispose().');
    this.ort = this.options.ortModule || await loadOrt();
    configureOrt(this.ort, this.options);
    this.session = await this.ort.InferenceSession.create(this.options.modelUrl, {
      executionProviders: executionProviders(this.options),
    });
    // int64 scalar-ish `sr` input. BigInt64Array is what ORT web expects
    // for int64 tensors.
    this._srTensor = new this.ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(this.options.sampleRate)]),
      [1],
    );
    this.reset();
  }

  /**
   * Zero the LSTM state and the 64-sample audio context. Call at every
   * turn boundary: Silero's recurrent state encodes recent audio, and
   * bleeding it across turns biases the first frames of the next turn.
   *
   * Race-safe against outstanding work: bumping `_epoch` here means an
   * inference already IN FLIGHT cannot commit its returned state/context
   * over the fresh zeros when it lands (the classic reset-overwrite race),
   * and a frame QUEUED before the reset is skipped entirely (resolving
   * `{ speechProbability: null }`) rather than smearing the previous
   * turn's audio into the new state.
   */
  reset() {
    if (this._disposed) throw new Error('SileroVadAdapter: cannot reset after dispose().');
    this._epoch += 1;
    if (!this.ort) return; // init() creates the initial state
    this._stateTensor = new this.ort.Tensor(
      'float32',
      new Float32Array(STATE_SIZE),
      [...SILERO_STATE_DIMS],
    );
    this._context = new Float32Array(SILERO_CONTEXT_SAMPLES);
  }

  /**
   * Run one 512-sample 16 kHz frame. Returns `{ speechProbability }`.
   * Calls are serialized internally (see class comment) so the LSTM state
   * and context always thread in strict call order.
   */
  process(frame) {
    // Stamp the call with the CURRENT epoch: a reset() that lands before
    // this frame reaches the head of the queue invalidates it (see _run).
    const callEpoch = this._epoch;
    const run = () => this._run(frame, callEpoch);
    const result = this._queue.then(run, run);
    // Keep the internal chain unrejected so one failure doesn't poison
    // every later call; the caller still sees the rejection via `result`.
    this._queue = result.catch(() => {});
    return result;
  }

  async _run(frame, callEpoch = this._epoch) {
    if (this._disposed) throw new Error('SileroVadAdapter: cannot process after dispose().');
    if (!this.session) throw new Error('SileroVadAdapter: init() must run first.');
    if (callEpoch !== this._epoch) {
      // A reset() landed after this frame was queued: it belongs to the
      // PREVIOUS turn. Running it now would feed old-turn audio into the
      // freshly zeroed state, so skip the inference and report "no
      // measurement" — null, never a fabricated probability.
      return { speechProbability: null };
    }
    if (!(frame instanceof Float32Array) || frame.length !== SILERO_FRAME_SAMPLES) {
      throw new Error(
        `SileroVadAdapter: Silero v5 requires exactly ${SILERO_FRAME_SAMPLES} samples at 16 kHz per call `
        + `(got ${frame?.length ?? 'no'} samples).`,
      );
    }

    // Prepend the previous chunk's 64-sample tail (v5's context window).
    const input = new Float32Array(SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES);
    input.set(this._context, 0);
    input.set(frame, SILERO_CONTEXT_SAMPLES);

    const feeds = {
      [this.options.inputName]: new this.ort.Tensor('float32', input, [1, input.length]),
      [this.options.stateName]: this._stateTensor,
      [this.options.srName]: this._srTensor,
    };
    const results = await this.session.run(feeds);

    // THE state-threading step: the returned tensor becomes the next
    // call's `state` input, identity-preserved — UNLESS a reset() (or
    // dispose()) landed while the inference was in flight, in which case
    // committing would overwrite the fresh zeros with the old turn's LSTM
    // state and audio tail, contaminating turn N+1 with turn N's audio.
    if (callEpoch === this._epoch) {
      const nextState = results[this.options.stateOutputName];
      if (nextState) this._stateTensor = nextState;
      this._context = frame.slice(frame.length - SILERO_CONTEXT_SAMPLES);
    }

    // The probability itself is still returned: the frame was legitimately
    // measured with the state that was current when it ran, and its
    // awaiting caller belongs to that turn.
    const output = results[this.options.outputName];
    const speechProbability = output && output.data ? Number(output.data[0]) : null;
    return { speechProbability };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._epoch += 1; // invalidate any in-flight state commit (see _run)
    const session = this.session;
    if (session && typeof session.release === 'function') {
      try { Promise.resolve(session.release()).catch(() => {}); } catch { /* ignore */ }
    }
    this.session = null;
    this.ort = null;
    this._stateTensor = null;
    this._context = null;
    this._srTensor = null;
  }
}

/**
 * Voice-engine factory, mirroring `createGazeAdapter` /
 * `normalizeGazeEngine`. Silero is currently the only production engine;
 * unknown values fall back to it. Tests and demos inject `MockVadAdapter`
 * directly instead of going through the factory (same convention as
 * `MockWebEyeTrackAdapter`).
 */
export function normalizeVoiceEngine(engine) {
  const value = typeof engine === 'string' ? engine.toLowerCase().trim() : '';
  return SUPPORTED_VOICE_ENGINES.includes(value) ? value : VOICE_ENGINE_SILERO;
}

export function createVadAdapter(options = {}) {
  normalizeVoiceEngine(options.engine); // one engine today; keeps the call-site contract stable
  const { engine, ...adapterOptions } = options;
  return new SileroVadAdapter(adapterOptions);
}

async function loadOrt() {
  // Same load order as OnnxEmotionClassifier: prefer the webgpu build,
  // fall back to the default wasm build.
  try {
    return await import('onnxruntime-web/webgpu');
  } catch {
    return await import('onnxruntime-web');
  }
}

function configureOrt(ort, options) {
  if (ort?.env?.wasm) {
    // Same version-skew guard as OnnxEmotionClassifier: substitute the
    // jsDelivr pin against the ORT version actually loaded.
    ort.env.wasm.wasmPaths = resolveWasmPaths(ort, options.wasmPaths);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
  }
}

function executionProviders(options) {
  if (Array.isArray(options.executionProviders)) return options.executionProviders;
  return ['wasm'];
}
