/**
 * voiceFrameWorklet — the AudioWorklet half of the voice capture split.
 *
 * ── Why this file does so little ─────────────────────────────────────────
 * ONNX Runtime CANNOT run here. `AudioWorkletGlobalScope` has no `fetch`,
 * no `XMLHttpRequest`, no `Worker`, and no module loading beyond
 * `addModule`, so ORT can never fetch its WASM binaries from inside a
 * worklet. And even if it could, the audio render thread is the wrong
 * place for a 32 ms-cadence neural VAD: a missed deadline here is an
 * audible glitch, not a dropped analytics frame.
 *
 * The split is therefore (see audio_text.md §5.2):
 *
 *   AudioWorklet (THIS FILE) — ring buffer, fixed-size framing, and CHEAP
 *     time-domain scalars only: RMS, peak, clipped-sample count,
 *     zero-crossing rate. Posts `Float32Array` frames + those scalars over
 *     its MessagePort. Nothing else. The per-frame cost is a few thousand
 *     adds/multiplies — far below the render-quantum budget.
 *
 *   Worker / main thread — everything expensive: Silero VAD (ORT), FFT,
 *     pitch. `VoiceTurnController` receives the frames on the main thread
 *     and forwards them to the injected VAD adapter; the recommended
 *     production deployment hosts that adapter inside a dedicated Worker
 *     (SileroVadAdapter is written to be Worker-compatible — no DOM, no
 *     `window`), because MediaPipe face, MediaPipe pose, and ONNX emotion
 *     ALREADY run on the main thread at 16 fps and the realistic ChatOyon
 *     scenario is voice running WHILE those camera pipelines run.
 *     Main-thread contention is the real performance risk here, not
 *     worklet cost.
 *
 * ── Contract ─────────────────────────────────────────────────────────────
 * Registered under the name exported as `VOICE_FRAME_PROCESSOR_NAME`.
 * `processorOptions`: `{ frameSize, clipThreshold }` — `frameSize` is in
 * samples AT THE AUDIOCONTEXT RATE (512 for 32 ms at 16 kHz; the
 * controller scales it when the context refused the 16 kHz constructor and
 * runs at native rate instead).
 *
 * Each completed frame posts one message (frame buffer transferred, not
 * copied):
 *
 *   {
 *     type: 'voice-frame',
 *     frame_index,        // 0-based, monotonically increasing per turn
 *     frame,              // Float32Array, length === frameSize
 *     frame_samples,      // === frame.length (survives buffer transfer)
 *     rms,                // sqrt(mean(x^2)) over the frame
 *     peak,               // max |x| over the frame
 *     clipped_count,      // samples with |x| >= clipThreshold
 *     zcr,                // sign changes / (frameSize - 1), in [0, 1]
 *   }
 *
 * Per the repo's research-grade data policy the FULL sample frame is
 * forwarded — the worklet computes the cheap scalars for convenience but
 * never withholds the raw samples the downstream DSP (pitch, spectrum)
 * and researchers need.
 *
 * This module is loaded two ways: by `audioWorklet.addModule()` in the
 * browser (where `registerProcessor`/`AudioWorkletProcessor` exist) and as
 * a plain ES module in Node tests (where they do not) — hence the guarded
 * base class and guarded registration at the bottom. Keep this file
 * dependency-free and self-contained: worklet module resolution must not
 * depend on sibling files being reachable from the worklet URL.
 */

export const VOICE_FRAME_PROCESSOR_NAME = 'oyon-voice-frame';

export const DEFAULT_VOICE_FRAME_SIZE = 512; // 32 ms at 16 kHz — Silero v5's exact chunk.
export const DEFAULT_CLIP_THRESHOLD = 0.999;

/**
 * Pure framing + cheap-feature engine, separated from the processor class
 * so Node tests can exercise it without an AudioWorkletGlobalScope.
 *
 * push(block) accepts any-length Float32Array chunks (the render quantum
 * is 128 samples, but nothing here assumes that) and returns an array of
 * completed frame messages (usually empty or length 1).
 */
export class VoiceFrameFramer {
  constructor({ frameSize = DEFAULT_VOICE_FRAME_SIZE, clipThreshold = DEFAULT_CLIP_THRESHOLD } = {}) {
    if (!Number.isInteger(frameSize) || frameSize <= 0) {
      throw new Error(`VoiceFrameFramer: frameSize must be a positive integer, got ${frameSize}`);
    }
    this.frameSize = frameSize;
    this.clipThreshold = clipThreshold;
    this._buffer = new Float32Array(frameSize);
    this._fill = 0;
    this._frameIndex = 0;
  }

  push(block) {
    const out = [];
    if (!block || block.length === 0) return out;
    let offset = 0;
    while (offset < block.length) {
      const take = Math.min(this.frameSize - this._fill, block.length - offset);
      this._buffer.set(block.subarray(offset, offset + take), this._fill);
      this._fill += take;
      offset += take;
      if (this._fill === this.frameSize) {
        out.push(this._finishFrame());
      }
    }
    return out;
  }

  _finishFrame() {
    const frame = this._buffer;
    const n = frame.length;
    let sumSquares = 0;
    let peak = 0;
    let clipped = 0;
    let crossings = 0;
    let prev = frame[0];
    for (let i = 0; i < n; i += 1) {
      const s = frame[i];
      sumSquares += s * s;
      const magnitude = s < 0 ? -s : s;
      if (magnitude > peak) peak = magnitude;
      if (magnitude >= this.clipThreshold) clipped += 1;
      if (i > 0 && ((s >= 0 && prev < 0) || (s < 0 && prev >= 0))) crossings += 1;
      prev = s;
    }
    const message = {
      type: 'voice-frame',
      frame_index: this._frameIndex,
      frame,
      frame_samples: n,
      rms: Math.sqrt(sumSquares / n),
      peak,
      clipped_count: clipped,
      zcr: n > 1 ? crossings / (n - 1) : 0,
    };
    this._frameIndex += 1;
    // Hand the filled buffer to the message (its ArrayBuffer will be
    // transferred by the processor) and start a fresh one.
    this._buffer = new Float32Array(this.frameSize);
    this._fill = 0;
    return message;
  }
}

// In the AudioWorkletGlobalScope `AudioWorkletProcessor` is a global; in
// Node (tests, `node --check`) it is not. Extending a stub keeps the class
// definable in both worlds — only the browser path ever instantiates it.
const ProcessorBase =
  typeof AudioWorkletProcessor === 'function' ? AudioWorkletProcessor : class {};

export class VoiceFrameProcessor extends ProcessorBase {
  constructor(options = {}) {
    super();
    const processorOptions = options.processorOptions || {};
    this._framer = new VoiceFrameFramer({
      frameSize: Number.isInteger(processorOptions.frameSize)
        ? processorOptions.frameSize
        : DEFAULT_VOICE_FRAME_SIZE,
      clipThreshold: Number.isFinite(processorOptions.clipThreshold)
        ? processorOptions.clipThreshold
        : DEFAULT_CLIP_THRESHOLD,
    });
  }

  /**
   * Render-thread callback: ~every 128 samples. Mono analysis — channel 0
   * only. Returning true keeps the processor alive; the controller tears
   * the node down explicitly on stopTurn().
   */
  process(inputs) {
    const channel = inputs?.[0]?.[0];
    if (channel && channel.length > 0) {
      for (const message of this._framer.push(channel)) {
        // Transfer the frame buffer — zero-copy handoff off the render thread.
        this.port.postMessage(message, [message.frame.buffer]);
      }
    }
    return true;
  }
}

if (typeof registerProcessor === 'function') {
  registerProcessor(VOICE_FRAME_PROCESSOR_NAME, VoiceFrameProcessor);
}
