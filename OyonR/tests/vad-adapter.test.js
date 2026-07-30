import assert from 'node:assert/strict';
import {
  SileroVadAdapter,
  createVadAdapter,
  normalizeVoiceEngine,
  SUPPORTED_VOICE_ENGINES,
  SILERO_FRAME_SAMPLES,
  SILERO_CONTEXT_SAMPLES,
  SILERO_STATE_DIMS,
} from '../src/inference/SileroVadAdapter.js';
import { MockVadAdapter } from '../src/mocks/MockVadAdapter.js';
import {
  SILERO_VAD_MODEL_URL,
  SILERO_VAD_MODEL_SHA256,
  SELF_HOSTED_SILERO_VAD_MODEL_URL,
} from '../src/config/cdnDefaults.js';

/**
 * Fake ORT namespace: records every InferenceSession.create() call and
 * every run() feed so the tests can assert the ONE thing a single-chunk
 * test can never see — that the LSTM state tensor returned by call N is
 * the IDENTICAL object fed as `state` on call N+1, and that the 64-sample
 * context tail of frame N is prepended to frame N+1's input.
 */
class FakeTensor {
  constructor(type, data, dims) {
    this.type = type;
    this.data = data;
    this.dims = dims;
  }
}

function makeFakeOrt({ probabilities = [], delayFirstRun = false } = {}) {
  const created = [];
  const runs = [];
  const returnedStates = [];
  let released = 0;
  let runIndex = 0;
  let firstRunRelease = null;

  const session = {
    inputNames: ['input', 'state', 'sr'],
    outputNames: ['output', 'stateN'],
    async run(feeds) {
      const myIndex = runIndex;
      runIndex += 1;
      if (delayFirstRun && myIndex === 0) {
        await new Promise((resolveFn) => { firstRunRelease = resolveFn; });
      }
      runs.push(feeds);
      const probability = probabilities[myIndex] ?? 0.5;
      const stateN = new FakeTensor('float32', new Float32Array(256).fill(myIndex + 1), [2, 1, 128]);
      returnedStates.push(stateN);
      return {
        output: new FakeTensor('float32', Float32Array.of(probability), [1, 1]),
        stateN,
      };
    },
    async release() { released += 1; },
  };

  const ort = {
    Tensor: FakeTensor,
    env: { wasm: {} },
    InferenceSession: {
      create: async (modelUrl, sessionOptions) => {
        created.push({ modelUrl, sessionOptions });
        return session;
      },
    },
  };

  return {
    ort,
    session,
    created,
    runs,
    returnedStates,
    releaseFirstRun: () => firstRunRelease?.(),
    get released() { return released; },
  };
}

function makeFrame(fill) {
  const frame = new Float32Array(SILERO_FRAME_SAMPLES);
  frame.fill(fill);
  return frame;
}

/** float32 storage loses exactness (0.7 → 0.6999999…), so compare loosely. */
function assertCloseTo(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `expected ≈${expected}, got ${actual}`);
}

// ─── A — init(): session created against the pinned model, wasm configured ──
{
  const fake = makeFakeOrt();
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  assert.equal(fake.created.length, 1);
  assert.equal(fake.created[0].modelUrl, SILERO_VAD_MODEL_URL);
  assert.deepEqual(fake.created[0].sessionOptions.executionProviders, ['wasm']);
  assert.ok(typeof fake.ort.env.wasm.wasmPaths === 'string' && fake.ort.env.wasm.wasmPaths.length > 0,
    'init() must configure ort.env.wasm.wasmPaths like OnnxEmotionClassifier');
  assert.equal(fake.ort.env.wasm.numThreads, 1);
}

// ─── B — first process(): input layout, zero state, zero context, sr int64 ──
{
  const fake = makeFakeOrt({ probabilities: [0.7] });
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  const frame = makeFrame(0.25);
  const result = await adapter.process(frame);
  assertCloseTo(result.speechProbability, 0.7);

  const feeds = fake.runs[0];

  // Input: [1, 576] = 64 zero context samples + the 512-sample frame.
  assert.deepEqual(feeds.input.dims, [1, SILERO_CONTEXT_SAMPLES + SILERO_FRAME_SAMPLES]);
  for (let i = 0; i < SILERO_CONTEXT_SAMPLES; i += 1) {
    assert.equal(feeds.input.data[i], 0, `context sample ${i} must start as zero`);
  }
  for (let i = 0; i < SILERO_FRAME_SAMPLES; i += 1) {
    assert.equal(feeds.input.data[SILERO_CONTEXT_SAMPLES + i], frame[i]);
  }

  // State: zeros with Silero's [2, 1, 128] dims.
  assert.deepEqual(feeds.state.dims, [...SILERO_STATE_DIMS]);
  assert.ok([...feeds.state.data].every((v) => v === 0), 'initial LSTM state must be zeros');

  // sr: int64 16000.
  assert.equal(feeds.sr.type, 'int64');
  assert.equal(feeds.sr.data[0], 16000n);
}

// ─── C — LSTM state threading across consecutive chunks (THE classic bug) ──
{
  const fake = makeFakeOrt({ probabilities: [0.9, 0.8, 0.7] });
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  const frame1 = makeFrame(0.1);
  const frame2 = makeFrame(0.2);
  await adapter.process(frame1);
  await adapter.process(frame2);

  // The state fed on call 2 is the IDENTICAL tensor returned by call 1 —
  // identity, not just equal values.
  assert.equal(fake.runs[1].state, fake.returnedStates[0],
    'call N+1 must feed the exact state tensor returned by call N');

  // The context prepended on call 2 is the last 64 samples of frame 1.
  for (let i = 0; i < SILERO_CONTEXT_SAMPLES; i += 1) {
    assert.equal(fake.runs[1].input.data[i], frame1[SILERO_FRAME_SAMPLES - SILERO_CONTEXT_SAMPLES + i],
      `call 2 context sample ${i} must come from frame 1's tail`);
  }

  // ── reset() clears both the state and the context ──
  adapter.reset();
  const frame3 = makeFrame(0.3);
  await adapter.process(frame3);
  const feeds3 = fake.runs[2];
  assert.notEqual(feeds3.state, fake.returnedStates[1], 'reset() must drop the threaded state');
  assert.ok([...feeds3.state.data].every((v) => v === 0), 'post-reset state must be zeros');
  for (let i = 0; i < SILERO_CONTEXT_SAMPLES; i += 1) {
    assert.equal(feeds3.input.data[i], 0, 'post-reset context must be zeros');
  }
}

// ─── D — concurrent process() calls stay strictly ordered (state safety) ──
{
  const fake = makeFakeOrt({ probabilities: [0.6, 0.4], delayFirstRun: true });
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  const p1 = adapter.process(makeFrame(0.1));
  const p2 = adapter.process(makeFrame(0.2)); // fired before p1 resolves
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.runs.length, 0, 'second call must wait for the first (internal serialization)');
  fake.releaseFirstRun();
  const [r1, r2] = await Promise.all([p1, p2]);
  assertCloseTo(r1.speechProbability, 0.6);
  assertCloseTo(r2.speechProbability, 0.4);
  assert.equal(fake.runs.length, 2);
  assert.equal(fake.runs[1].state, fake.returnedStates[0],
    'even under overlapping calls, state must thread call-1 → call-2');
}

// ─── D2 — regression (finding 3): reset() racing an IN-FLIGHT inference
// must win — the old turn's returned LSTM state and audio tail must not
// overwrite the freshly zeroed state when the inference lands. ──
{
  const fake = makeFakeOrt({ probabilities: [0.6, 0.4], delayFirstRun: true });
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  const first = adapter.process(makeFrame(1)); // enters session.run, then blocks
  await new Promise((r) => setImmediate(r));
  adapter.reset(); // turn boundary lands while call 1 is in flight
  const resetState = adapter._stateTensor;

  fake.releaseFirstRun(); // the OLD turn's inference now completes
  assertCloseTo((await first).speechProbability, 0.6,
    'the old turn\'s caller still gets its measured probability');

  // The state the reset installed must survive the late-landing commit…
  assert.equal(adapter._stateTensor, resetState,
    'an in-flight result must not overwrite the reset LSTM state');
  // …and the next inference must run on zeros, not the old turn's tensors.
  await adapter.process(makeFrame(0.5));
  const feeds = fake.runs[1];
  assert.notEqual(feeds.state, fake.returnedStates[0],
    'turn N+1 must not be fed turn N\'s returned state');
  assert.ok([...feeds.state.data].every((v) => v === 0), 'post-reset state must be zeros');
  for (let i = 0; i < SILERO_CONTEXT_SAMPLES; i += 1) {
    assert.equal(feeds.input.data[i], 0,
      'post-reset context must be zeros, not the old turn\'s audio tail');
  }
}
// ─── D3 — regression (finding 3): a frame QUEUED before a reset() (but not
// yet run) is the previous turn's audio — it must be skipped, not smeared
// into the fresh state. ──
{
  const fake = makeFakeOrt({ probabilities: [0.6, 0.4], delayFirstRun: true });
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();

  const p1 = adapter.process(makeFrame(1));
  const p2 = adapter.process(makeFrame(0.9)); // queued behind p1
  await new Promise((r) => setImmediate(r));
  adapter.reset(); // lands while p1 is in flight, p2 still queued
  fake.releaseFirstRun();
  await p1;
  const r2 = await p2;
  assert.equal(r2.speechProbability, null,
    'a pre-reset queued frame reports no measurement instead of running against the new state');
  assert.equal(fake.runs.length, 1, 'the stale queued frame never reached the model');

  // The next turn's first real frame gets pristine zero state/context.
  await adapter.process(makeFrame(0.2));
  assert.ok([...fake.runs[1].state.data].every((v) => v === 0));
  for (let i = 0; i < SILERO_CONTEXT_SAMPLES; i += 1) {
    assert.equal(fake.runs[1].input.data[i], 0);
  }
}

// ─── E — frame-size contract: exactly 512 samples at 16 kHz ──
{
  const fake = makeFakeOrt();
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await adapter.init();
  await assert.rejects(() => adapter.process(new Float32Array(256)), /512 samples/);
  await assert.rejects(() => adapter.process([0, 1, 2]), /512 samples/);
}

// ─── F — lifecycle guards ──
{
  const fake = makeFakeOrt();
  const adapter = new SileroVadAdapter({ ortModule: fake.ort });
  await assert.rejects(() => adapter.process(makeFrame(0)), /init\(\) must run first/);

  await adapter.init();
  await adapter.process(makeFrame(0));
  adapter.dispose();
  adapter.dispose(); // idempotent
  await new Promise((r) => setImmediate(r));
  assert.equal(fake.released, 1, 'dispose() must release the ORT session exactly once');
  await assert.rejects(() => adapter.process(makeFrame(0)), /dispose/);
  assert.throws(() => adapter.reset(), /dispose/);
}

// ─── G — factory + engine normalization (gaze-factory parity) ──
{
  assert.deepEqual([...SUPPORTED_VOICE_ENGINES], ['silero']);
  assert.equal(normalizeVoiceEngine('silero'), 'silero');
  assert.equal(normalizeVoiceEngine('SILERO '), 'silero');
  assert.equal(normalizeVoiceEngine('bogus'), 'silero');
  assert.equal(normalizeVoiceEngine(undefined), 'silero');

  const fake = makeFakeOrt();
  const adapter = createVadAdapter({ engine: 'anything', ortModule: fake.ort });
  assert.ok(adapter instanceof SileroVadAdapter);
  await adapter.init();
  assert.equal(fake.created[0].modelUrl, SILERO_VAD_MODEL_URL);
}

// ─── H — asset pinning: model URL/checksum constants exist and are shaped ──
{
  assert.match(SILERO_VAD_MODEL_URL, /^https:\/\/.+silero.+\.onnx$/);
  assert.match(SILERO_VAD_MODEL_SHA256, /^sha256:/);
  assert.match(SELF_HOSTED_SILERO_VAD_MODEL_URL, /assets-v1\/silero_vad\.onnx$/);
}

// ─── I — MockVadAdapter: deterministic script, reset, dispose guards ──
{
  const mock = new MockVadAdapter({
    script: [{ probability: 0.9, frames: 2 }, 0.1],
    defaultProbability: 0.05,
  });
  await mock.init();

  assert.equal((await mock.process(makeFrame(0))).speechProbability, 0.9);
  assert.equal((await mock.process(makeFrame(0))).speechProbability, 0.9);
  assert.equal((await mock.process(makeFrame(0))).speechProbability, 0.1);
  assert.equal((await mock.process(makeFrame(0))).speechProbability, 0.05, 'exhausted script → defaultProbability');
  assert.equal(mock.processedFrameCount, 4);

  mock.reset();
  assert.equal(mock.resetCount, 1);
  assert.equal((await mock.process(makeFrame(0))).speechProbability, 0.9, 'reset() rewinds the script');

  mock.dispose();
  mock.dispose(); // idempotent
  await assert.rejects(() => mock.process(makeFrame(0)), /dispose/);
  assert.throws(() => mock.reset(), /dispose/);
}

// ─── J — MockVadAdapter requires init() first, like the real adapter ──
{
  const mock = new MockVadAdapter({ script: [1] });
  await assert.rejects(() => mock.process(makeFrame(0)), /init\(\) before process\(\)/);
}

console.log('vad-adapter.test.js passed');
