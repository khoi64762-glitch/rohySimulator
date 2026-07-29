/**
 * MockVadAdapter — deterministic drop-in for `SileroVadAdapter` in tests,
 * demos, and runtime smoke checks. No ORT, no model download, no Worker.
 * Follows the `MockWebEyeTrackAdapter` conventions: full adapter contract,
 * lifecycle guards after dispose(), scriptable output.
 *
 * The script is a sequence of speech probabilities consumed one per
 * `process()` call. Two authoring forms, mixable:
 *
 *   new MockVadAdapter({ script: [0.9, 0.9, 0.1] })
 *   new MockVadAdapter({ script: [
 *     { probability: 0.9, frames: 6 },   // 6 speech-like frames
 *     { probability: 0.05, frames: 20 }, // then 20 silence frames
 *   ] })
 *
 * When the script is exhausted, `defaultProbability` (default 0) is
 * returned. `reset()` rewinds the script to the start — mirroring how the
 * real adapter zeroes its LSTM state at each turn boundary — and counts
 * invocations so tests can assert the controller resets per turn.
 */

export class MockVadAdapter {
  constructor(options = {}) {
    this.options = {
      script: [],
      defaultProbability: 0,
      ...options,
    };
    this._script = flattenScript(this.options.script);
    this._index = 0;
    this._initialized = false;
    this._disposed = false;
    this._processedFrames = 0;
    this._resetCount = 0;
    this._lastFrame = null;
  }

  async init() {
    if (this._disposed) throw new Error('MockVadAdapter: cannot init after dispose().');
    this._initialized = true;
  }

  async process(frame) {
    if (this._disposed) throw new Error('MockVadAdapter: cannot process after dispose().');
    if (!this._initialized) throw new Error('MockVadAdapter: call init() before process().');
    this._processedFrames += 1;
    this._lastFrame = frame ?? null;
    const probability = this._index < this._script.length
      ? this._script[this._index]
      : this.options.defaultProbability;
    this._index += 1;
    return { speechProbability: probability };
  }

  reset() {
    if (this._disposed) throw new Error('MockVadAdapter: cannot reset after dispose().');
    this._index = 0;
    this._resetCount += 1;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._initialized = false;
    this._lastFrame = null;
  }

  /** Number of frames handed to process() over the adapter's lifetime. */
  get processedFrameCount() { return this._processedFrames; }

  /** Number of reset() calls — lets tests assert per-turn resets. */
  get resetCount() { return this._resetCount; }

  /** The most recent frame passed to process(); null before first call. */
  get lastFrame() { return this._lastFrame; }
}

function flattenScript(script) {
  if (!Array.isArray(script)) return [];
  const out = [];
  for (const entry of script) {
    if (typeof entry === 'number' && Number.isFinite(entry)) {
      out.push(entry);
      continue;
    }
    if (entry && typeof entry === 'object'
        && Number.isFinite(entry.probability)
        && Number.isInteger(entry.frames) && entry.frames > 0) {
      for (let i = 0; i < entry.frames; i += 1) out.push(entry.probability);
    }
  }
  return out;
}
