import assert from 'node:assert/strict';
import {
  createVoiceAnalysisWorkerCore,
  createInProcessVoiceAnalysisWorker,
  VOICE_WORKER_PROTOCOL_VERSION,
} from '../src/workers/voiceAnalysisWorker.js';
import { createWorkerVoiceAnalyzer } from '../src/inference/WorkerVoiceAnalyzer.js';
import { createVoiceTurnController } from '../src/capture/VoiceTurnController.js';
import { VoiceTurnAggregator } from '../src/aggregation/VoiceTurnAggregator.js';
import { analyzeFrame } from '../src/analytics/voiceFeatures.js';
import { MockVadAdapter } from '../src/mocks/MockVadAdapter.js';
import { createOyonSettings } from '../src/settings/OyonSettings.js';

/*
 * voice-worker.test.js — the §5.2 worker analysis path.
 *
 * No real Worker exists in Node, so the tests drive the exported
 * message-handling core (`createVoiceAnalysisWorkerCore`) directly, use the
 * in-process shim as a protocol-faithful "worker" backend, and use a
 * recording fake worker for the proxy's transport concerns (transfer lists,
 * backpressure, stale responses, termination).
 */

assert.equal(VOICE_WORKER_PROTOCOL_VERSION, 'voice-worker-v1');

/** Drain microtasks + a few macrotasks. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** 512-sample 220 Hz sine at 16 kHz — a clearly voiced, spectrally clean frame. */
function toneFrame(freq = 220, amplitude = 0.5) {
  const frame = new Float32Array(512);
  for (let i = 0; i < frame.length; i += 1) {
    frame[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / 16000);
  }
  return frame;
}

/** Worker double: records what was posted; responses are delivered by hand. */
function makeFakeWorker() {
  const worker = {
    posted: [], // [{ message, transfer }]
    onmessage: null,
    onerror: null,
    terminated: 0,
    postMessage(message, transfer) { worker.posted.push({ message, transfer }); },
    terminate() { worker.terminated += 1; },
    emit(data) { if (typeof worker.onmessage === 'function') worker.onmessage({ data }); },
  };
  return worker;
}

// ─── A — core: init → ready, with and without a VAD ──
{
  const posts = [];
  const post = (message) => posts.push(message);
  const core = createVoiceAnalysisWorkerCore({ createAdapter: () => new MockVadAdapter() });
  await core.handleMessage({ type: 'init', settings: { voice_engine: 'silero' }, vadEnabled: true }, post);
  assert.deepEqual(posts, [{ type: 'ready', engine: 'silero' }]);

  const posts2 = [];
  const core2 = createVoiceAnalysisWorkerCore();
  await core2.handleMessage({ type: 'init', vadEnabled: false }, (m) => posts2.push(m));
  assert.deepEqual(posts2, [{ type: 'ready', engine: 'none' }], 'DSP-only init needs no adapter at all');
}

// ─── B — core: a frame round-trips with matching seq, transferred buffer,
// and features EXACTLY equal to calling analyzeFrame directly ──
{
  const vad = new MockVadAdapter({ script: [0.9, 0.05] });
  const core = createVoiceAnalysisWorkerCore({ createAdapter: () => vad });
  const posts = [];
  const post = (message, transfer) => posts.push({ message, transfer });
  await core.handleMessage({ type: 'init', settings: {}, vadEnabled: true }, (m, t) => posts.push({ message: m, transfer: t }));

  const input = toneFrame();
  const reference = analyzeFrame(input.slice(), 16000); // independent copy
  await core.handleMessage({ type: 'frame', seq: 7, sampleRate: 16000, buffer: input.buffer }, post);

  const reply = posts[posts.length - 1];
  assert.equal(reply.message.type, 'features');
  assert.equal(reply.message.seq, 7, 'seq must round-trip unchanged');
  assert.equal(reply.message.sampleRate, 16000);
  assert.equal(reply.message.speechProbability, 0.9);
  assert.deepEqual(reply.message.features, reference,
    'worker-path DSP must be identical to calling analyzeFrame directly');
  assert.ok(reply.message.buffer instanceof ArrayBuffer, 'the frame buffer comes back');
  assert.deepEqual(reply.transfer, [reply.message.buffer], 'the buffer is TRANSFERRED back, not cloned');
  assert.ok(vad.lastFrame instanceof Float32Array);
  assert.equal(vad.lastFrame.length, 512, 'the VAD saw the reconstructed 512-sample frame');

  // reset rewinds the mock script (turn boundary semantics).
  await core.handleMessage({ type: 'reset' }, post);
  assert.equal(vad.resetCount, 1);
  const again = toneFrame();
  await core.handleMessage({ type: 'frame', seq: 8, sampleRate: 16000, buffer: again.buffer }, post);
  assert.equal(posts[posts.length - 1].message.speechProbability, 0.9, 'reset rewound the VAD script');
}

// ─── C — core: protocol errors are messages, never throws ──
{
  const core = createVoiceAnalysisWorkerCore({ createAdapter: () => new MockVadAdapter() });
  const posts = [];
  const post = (message) => posts.push(message);

  await core.handleMessage({ type: 'frame', seq: 1, sampleRate: 16000, buffer: new ArrayBuffer(8) }, post);
  assert.equal(posts[0].type, 'error');
  assert.equal(posts[0].seq, 1, 'a per-frame failure carries its seq so the proxy can settle that frame');
  assert.match(posts[0].message, /before init/);

  await core.handleMessage({ type: 'bogus' }, post);
  assert.equal(posts[1].type, 'error');
  assert.match(posts[1].message, /unknown message type/);

  await core.handleMessage(null, post);
  assert.equal(posts[2].type, 'error');

  // init failure (adapter constructor throws) → error message, not a throw.
  const failing = createVoiceAnalysisWorkerCore({ createAdapter: () => { throw new Error('no model'); } });
  const failPosts = [];
  await failing.handleMessage({ type: 'init', vadEnabled: true }, (m) => failPosts.push(m));
  assert.equal(failPosts[0].type, 'error');
  assert.match(failPosts[0].message, /no model/);

  // A VAD runtime failure yields features + vad_error, never a withheld frame.
  const brokenVad = { init() {}, process() { throw new Error('vad exploded'); }, reset() {} };
  const core2 = createVoiceAnalysisWorkerCore({ createAdapter: () => brokenVad });
  const posts2 = [];
  await core2.handleMessage({ type: 'init', vadEnabled: true }, (m) => posts2.push(m));
  const f = toneFrame();
  await core2.handleMessage({ type: 'frame', seq: 3, sampleRate: 16000, buffer: f.buffer }, (m) => posts2.push(m));
  const featMsg = posts2[posts2.length - 1];
  assert.equal(featMsg.type, 'features');
  assert.equal(featMsg.speechProbability, null);
  assert.match(featMsg.vad_error, /vad exploded/);
  assert.ok(featMsg.features, 'DSP record still present despite the VAD failure');
}

// ─── D — proxy, worker mode: init handshake, transfer on the way in,
// matched resolution on the way back ──
{
  const worker = makeFakeWorker();
  const analyzer = createWorkerVoiceAnalyzer({
    settings: createOyonSettings({ voice_enabled: true }),
    vadEnabled: true,
    workerFactory: () => worker,
  });
  const initPromise = analyzer.init();
  await settle();
  const initMsg = worker.posted[0].message;
  assert.equal(initMsg.type, 'init');
  assert.equal(initMsg.vadEnabled, true);
  assert.equal(initMsg.settings.voice_engine, 'silero', 'voice_* settings cross to the worker');
  assert.equal(Object.keys(initMsg.settings).every((k) => k.startsWith('voice_')), true,
    'only the cloneable voice_* settings are forwarded');
  worker.emit({ type: 'ready', engine: 'silero' });
  await initPromise;
  assert.equal(analyzer.mode, 'worker');
  assert.equal(analyzer.engine, 'silero');
  assert.equal(analyzer.fallbackReason, null);

  const frame = toneFrame();
  const resultPromise = analyzer.analyze(frame, 16000);
  const frameMsg = worker.posted[1];
  assert.equal(frameMsg.message.type, 'frame');
  assert.equal(frameMsg.message.seq, 1);
  assert.equal(frameMsg.message.sampleRate, 16000);
  assert.equal(frameMsg.message.buffer, frame.buffer);
  assert.deepEqual(frameMsg.transfer, [frame.buffer], 'frames are TRANSFERRED in, never cloned');

  const reference = analyzeFrame(toneFrame(), 16000);
  worker.emit({
    type: 'features', seq: 1, sampleRate: 16000, buffer: frame.buffer,
    features: reference, speechProbability: 0.8,
  });
  const result = await resultPromise;
  assert.equal(result.dropped, false);
  assert.equal(result.seq, 1);
  assert.equal(result.speechProbability, 0.8);
  assert.deepEqual(result.features, reference);
  assert.ok(result.frame instanceof Float32Array);
  assert.equal(result.frame.length, 512);
  analyzer.dispose();
}

// ─── E — backpressure: bounded pipeline (never more than maxInFlight frames
// POSTED to the worker), held slot for the newest frame, exact drop count ──
{
  const worker = makeFakeWorker(); // never responds to frames on its own
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => worker, maxInFlight: 2, vadEnabled: false });
  const initPromise = analyzer.init();
  await settle();
  worker.emit({ type: 'ready', engine: 'none' });
  await initPromise;
  assert.equal(analyzer.mode, 'worker');

  const results = [];
  const promises = [];
  for (let i = 0; i < 6; i += 1) {
    promises.push(analyzer.analyze(toneFrame()).then((r) => { results.push(r); return r; }));
    assert.ok(analyzer.inFlight <= 2, 'posted frames must never exceed maxInFlight');
  }
  await settle();

  // THE bound that matters (finding 11): only maxInFlight frames were ever
  // POSTED — a stalled worker's inbound queue cannot grow with arrivals.
  const framePosts = () => worker.posted.filter((p) => p.message.type === 'frame');
  assert.equal(framePosts().length, 2, 'the worker inbound queue is bounded at maxInFlight');
  assert.deepEqual(framePosts().map((p) => p.message.seq), [1, 2]);

  // Seqs 1–5 dropped (posted 1–2 had their promises dropped to keep the
  // caller's chain moving; 3–5 were displaced from the held slot); seq 6 —
  // the NEWEST — waits in the held slot for a free pipeline place.
  assert.equal(analyzer.droppedFrames, 5, 'drop count must be exact');
  assert.equal(analyzer.inFlight, 2);
  assert.equal(analyzer.heldFrames, 1, 'the newest frame is held, not lost');
  assert.deepEqual(results.map((r) => r.seq), [1, 2, 3, 4, 5], 'the OLDEST frames are the ones dropped');
  assert.ok(results.every((r) => r.dropped === true && r.features === null && r.speechProbability === null));
  // A held-then-displaced frame's buffer was never transferred — the raw
  // samples come back on the dropped result (research-grade: never withheld).
  assert.ok(results[2].frame instanceof Float32Array, 'held-slot drops hand the untouched frame back');
  assert.equal(results[0].frame, null, 'posted drops cannot return the transferred buffer');

  // Stale responses for dropped-but-posted seqs free pipeline places, which
  // posts the held newest frame; it then completes normally.
  worker.emit({ type: 'features', seq: 1, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.9 });
  assert.equal(analyzer.heldFrames, 0, 'a freed pipeline place posts the held frame');
  assert.deepEqual(framePosts().map((p) => p.message.seq), [1, 2, 6]);
  worker.emit({ type: 'features', seq: 2, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.9 });
  worker.emit({ type: 'features', seq: 6, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.6 });
  const settled = await Promise.all(promises);
  assert.equal(settled[5].dropped, false);
  assert.equal(settled[5].speechProbability, 0.6, 'the newest frame survives the stall');
  assert.equal(analyzer.inFlight, 0);

  // A LATE response for an unknown seq is stale — discarded without corrupting state.
  worker.emit({ type: 'features', seq: 999, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.9 });
  assert.equal(analyzer.inFlight, 0);
  const after = analyzer.analyze(toneFrame());
  worker.emit({ type: 'features', seq: 7, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.25 });
  assert.equal((await after).speechProbability, 0.25, 'stale responses must not corrupt later frames');
  analyzer.dispose();
}

// ─── E2 — regression (finding 11, stalled-worker probe): 1000 frames into a
// stalled worker must not accumulate in its inbound queue ──
{
  const worker = {
    frames: 0,
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(m) {
      if (m.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready', engine: 'none' } }));
      if (m.type === 'frame') this.frames += 1;
    },
    terminate() { this.terminated = true; },
  };
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => worker, vadEnabled: false, maxInFlight: 2, initTimeoutMs: 1000 });
  await analyzer.init();
  for (let i = 0; i < 1000; i += 1) analyzer.analyze(new Float32Array(512));
  assert.equal(worker.frames, 2, 'a stalled worker holds at most maxInFlight frames — not 1000');
  assert.equal(analyzer.inFlight, 2);
  assert.equal(analyzer.heldFrames, 1);
  assert.equal(analyzer.droppedFrames, 999, 'every undeliverable frame is a counted drop');
  analyzer.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(analyzer.inFlight, 0);
  assert.equal(analyzer.heldFrames, 0);
}

// ─── E3 — regression (finding 11, dispose-during-init probe): a worker whose
// init completes after dispose() must be terminated, never adopted ──
{
  let sentInit = false;
  const worker = {
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage(m) { if (m.type === 'init') sentInit = true; },
    terminate() { this.terminated += 1; },
  };
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => worker, vadEnabled: false, initTimeoutMs: 10000 });
  const initializing = analyzer.init();
  analyzer.dispose(); // lands while the worker is still initializing
  worker.onmessage({ data: { type: 'ready', engine: 'none' } });
  await initializing;
  assert.equal(sentInit, true);
  assert.ok(worker.terminated >= 1, 'dispose() during init must terminate the in-flight worker');
  assert.notEqual(analyzer.mode, 'worker', 'a disposed analyzer must never adopt the late-ready worker');
  await assert.rejects(() => analyzer.analyze(toneFrame()), /dispose/);
}

// ─── F — out-of-order responses resolve to the RIGHT callers ──
{
  const worker = makeFakeWorker();
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => worker, vadEnabled: false });
  const initPromise = analyzer.init();
  await settle();
  worker.emit({ type: 'ready', engine: 'none' });
  await initPromise;

  const p1 = analyzer.analyze(toneFrame());
  const p2 = analyzer.analyze(toneFrame());
  worker.emit({ type: 'features', seq: 2, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.2 });
  worker.emit({ type: 'features', seq: 1, sampleRate: 16000, buffer: new ArrayBuffer(2048), features: null, speechProbability: 0.1 });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.seq, 1);
  assert.equal(r1.speechProbability, 0.1);
  assert.equal(r2.seq, 2);
  assert.equal(r2.speechProbability, 0.2);
  analyzer.dispose();
}

// ─── G — init failure → VISIBLE fallback to main-thread mode ──
{
  const worker = makeFakeWorker();
  const errors = [];
  const analyzer = createWorkerVoiceAnalyzer({
    workerFactory: () => worker,
    vadEnabled: true,
    coreOptions: { createAdapter: () => new MockVadAdapter({ script: [0.7] }) },
    onError: (err) => errors.push(err),
  });
  const initPromise = analyzer.init();
  await settle();
  worker.emit({ type: 'error', message: 'model download failed' });
  await initPromise;

  assert.equal(analyzer.mode, 'main-thread', 'failed worker init must fall back, not die');
  assert.ok(analyzer.fallbackReason, 'the fallback must say WHY');
  assert.ok(errors.length >= 1, 'the failure is surfaced through onError, never silent');
  assert.equal(worker.terminated, 1, 'the dead worker is terminated');

  const result = await analyzer.analyze(toneFrame(), 16000);
  assert.equal(result.dropped, false);
  assert.equal(result.speechProbability, 0.7, 'analysis continues on the fallback path');
  assert.ok(result.features);
  analyzer.dispose();
}
{
  // No Worker at all (workerFactory yields null — Node's reality).
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => null, vadEnabled: false });
  await analyzer.init();
  assert.equal(analyzer.mode, 'main-thread');
  assert.equal(analyzer.fallbackReason, 'worker_unavailable');
  const result = await analyzer.analyze(toneFrame(), 16000);
  assert.equal(result.speechProbability, null, 'DSP-only: no VAD requested, none fabricated');
  assert.ok(result.features);
  analyzer.dispose();
}

// ─── H — worker path and fallback path produce IDENTICAL features ──
{
  const inputs = [toneFrame(220), toneFrame(440, 0.3), new Float32Array(512)];
  const reference = inputs.map((f) => analyzeFrame(f.slice(), 16000));

  // "Worker" path: the real core behind the real protocol, via the shim.
  const workerAnalyzer = createWorkerVoiceAnalyzer({
    workerFactory: () => createInProcessVoiceAnalysisWorker({
      createAdapter: () => new MockVadAdapter({ script: [0.9, 0.9, 0.1] }),
    }),
    vadEnabled: true,
  });
  await workerAnalyzer.init();
  assert.equal(workerAnalyzer.mode, 'worker');
  const workerResults = [];
  for (const input of inputs) workerResults.push(await workerAnalyzer.analyze(input.slice(), 16000));

  // Fallback path: same core, same thread.
  const fallbackAnalyzer = createWorkerVoiceAnalyzer({
    workerFactory: () => null,
    vadEnabled: true,
    coreOptions: { createAdapter: () => new MockVadAdapter({ script: [0.9, 0.9, 0.1] }) },
  });
  await fallbackAnalyzer.init();
  assert.equal(fallbackAnalyzer.mode, 'main-thread');
  const fallbackResults = [];
  for (const input of inputs) fallbackResults.push(await fallbackAnalyzer.analyze(input.slice(), 16000));

  for (let i = 0; i < inputs.length; i += 1) {
    assert.deepEqual(workerResults[i].features, reference[i], `worker path diverged from analyzeFrame on frame ${i}`);
    assert.deepEqual(fallbackResults[i].features, reference[i], `fallback path diverged from analyzeFrame on frame ${i}`);
    assert.equal(workerResults[i].speechProbability, fallbackResults[i].speechProbability);
  }
  workerAnalyzer.dispose();
  fallbackAnalyzer.dispose();
}

// ─── I — dispose(): terminates the worker, settles pending, idempotent ──
{
  const worker = makeFakeWorker();
  const analyzer = createWorkerVoiceAnalyzer({ workerFactory: () => worker, vadEnabled: false });
  const initPromise = analyzer.init();
  await settle();
  worker.emit({ type: 'ready', engine: 'none' });
  await initPromise;

  const hanging = analyzer.analyze(toneFrame());
  analyzer.dispose();
  analyzer.dispose(); // idempotent
  assert.equal(worker.terminated, 1, 'dispose() must terminate the worker exactly once');
  const hung = await hanging;
  assert.equal(hung.dropped, true, 'in-flight frames settle (as dropped) instead of leaking');
  assert.equal(worker.posted.some((p) => p.message.type === 'dispose'), true);
  await assert.rejects(() => analyzer.analyze(toneFrame()), /dispose/);
}

// ─── J — controller integration: worker-path report + per-frame record ──
{
  const track = {
    stop() { this.stopped = true; },
    getSettings() { return { echoCancellation: true, noiseSuppression: true, autoGainControl: false, sampleRate: 16000, channelCount: 1 }; },
    addEventListener() {}, removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const nodes = [];
  let t = 0;
  const frames = [];
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true }),
    hostEnabled: true,
    onFrameFeatures: (record) => frames.push(record),
    getUserMedia: async () => stream,
    audioContextFactory: () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      destination: {},
      close: async () => {},
    }),
    createWorkletNode: (ctx, name, nodeOptions) => {
      const node = { name, nodeOptions, port: { onmessage: null, close() {} }, connect() {}, disconnect() {} };
      nodes.push(node);
      return node;
    },
    workletUrl: 'about:worklet',
    now: () => (t += 1),
    // The controller builds its analyzer through this factory by default —
    // here backed by the real core over the real protocol ("worker" mode).
    analyzerFactory: (opts) => createWorkerVoiceAnalyzer({
      ...opts,
      vad: null,
      vadEnabled: true,
      workerFactory: () => createInProcessVoiceAnalysisWorker({
        createAdapter: () => new MockVadAdapter({ script: [{ probability: 0.9, frames: 8 }] }),
      }),
    }),
  });

  assert.deepEqual(await controller.startTurn({ userAction: true }), { ok: true });
  const node = nodes[0];
  for (let i = 0; i < 8; i += 1) {
    node.port.onmessage({
      data: {
        type: 'voice-frame', frame_index: i, frame: toneFrame(),
        frame_samples: 512, rms: 0.1, peak: 0.2, clipped_count: 0, zcr: 0.05,
      },
    });
    await settle(); // real-cadence pacing: no backpressure drops expected
  }
  const report = controller.stopTurn();

  assert.equal(frames.length, 8);
  assert.equal(frames[0].processing_mode, 'worker');
  assert.equal(frames[0].analysis_dropped, false);
  assert.equal(frames[0].speech_probability, 0.9);
  assert.ok(frames[0].features, 'the off-thread DSP record rides on the per-frame record');
  assert.deepEqual(frames[0].features, analyzeFrame(toneFrame(), 16000));
  assert.ok(frames[0].frame instanceof Float32Array);
  assert.equal(frames[0].frame.length, 512, 'the transferred frame comes back on the record');

  assert.equal(report.processing_mode, 'worker');
  assert.equal(report.dropped_frames, 0);
  assert.equal(report.dropped_frame_ratio, 0);
  controller.dispose();
}

// ─── K — aggregator: worker-path health lands in the quality block, and a
// dropped-heavy turn is flagged insufficient ──
{
  const makeWindow = (reportOverrides) => {
    const aggregator = new VoiceTurnAggregator({ frameMs: 32 });
    aggregator.start({ timestamp: 0 });
    const features = analyzeFrame(toneFrame(), 16000);
    for (let i = 0; i < 60; i += 1) {
      aggregator.recordFrame(features, { timestamp: i * 32, speechProbability: 0.9 });
    }
    return aggregator.finalize({
      timestamp: 60 * 32,
      report: {
        track_settings: null, resample_mode: 'native-16k',
        processing_mode: 'worker', dropped_frames: 0, dropped_frame_ratio: 0,
        ...reportOverrides,
      },
    });
  };

  const clean = makeWindow({});
  assert.equal(clean.quality.processing_mode, 'worker');
  assert.equal(clean.quality.dropped_frames, 0);
  assert.equal(clean.quality.dropped_frame_ratio, 0);
  assert.equal(clean.quality.thresholds.max_dropped_frame_ratio, 0.2);
  assert.ok(!clean.voice.insufficient_reasons.includes('dropped_frames'));

  const degraded = makeWindow({ dropped_frames: 20, dropped_frame_ratio: 20 / 60 });
  assert.equal(degraded.quality.dropped_frames, 20);
  assert.ok(Math.abs(degraded.quality.dropped_frame_ratio - 1 / 3) < 1e-12);
  assert.equal(degraded.voice.insufficient_data, true);
  assert.ok(degraded.voice.insufficient_reasons.includes('dropped_frames'),
    'a turn with a third of its frames dropped must not read as a clean measurement');

  const mainThread = makeWindow({ processing_mode: 'main-thread' });
  assert.equal(mainThread.quality.processing_mode, 'main-thread');

  // No report at all → unknown, never fabricated.
  const aggregator = new VoiceTurnAggregator({ frameMs: 32 });
  aggregator.start({ timestamp: 0 });
  const bare = aggregator.finalize({ timestamp: 32 });
  assert.equal(bare.quality.processing_mode, null);
  assert.equal(bare.quality.dropped_frames, null);
  assert.equal(bare.quality.dropped_frame_ratio, null);
}

// ─── L — voice_worker_enabled: false restores the legacy in-thread path ──
{
  const vad = new MockVadAdapter({ script: [0.9] });
  let analyzerBuilt = false;
  const track = {
    stop() {}, getSettings() { return {}; },
    addEventListener() {}, removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const nodes = [];
  const frames = [];
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, voice_worker_enabled: false }),
    hostEnabled: true,
    vad,
    onFrameFeatures: (record) => frames.push(record),
    getUserMedia: async () => stream,
    audioContextFactory: () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      destination: {},
      close: async () => {},
    }),
    createWorkletNode: (ctx, name, nodeOptions) => {
      const node = { name, nodeOptions, port: { onmessage: null, close() {} }, connect() {}, disconnect() {} };
      nodes.push(node);
      return node;
    },
    workletUrl: 'about:worklet',
    now: () => 0,
    analyzerFactory: () => { analyzerBuilt = true; throw new Error('must not be called'); },
  });
  assert.equal(analyzerBuilt, false, 'voice_worker_enabled:false must not construct an analyzer');
  await controller.startTurn({ userAction: true });
  nodes[0].port.onmessage({
    data: { type: 'voice-frame', frame_index: 0, frame: toneFrame(), frame_samples: 512, rms: 0.1, peak: 0.2, clipped_count: 0, zcr: 0 },
  });
  await settle();
  const report = controller.stopTurn();
  assert.equal(frames[0].speech_probability, 0.9, 'legacy path still runs the injected VAD in-thread');
  // UPDATED for finding 2 (was `features === null`, which starved the
  // aggregator and made the voice window contradict the event stream): the
  // legacy path now attaches a MINIMAL time-domain record built from the
  // worklet scalars; fields it cannot measure are null, never fabricated.
  assert.equal(frames[0].features.rms, 0.1);
  assert.equal(frames[0].features.peak, 0.2);
  assert.equal(frames[0].features.clippedSamples, 0);
  assert.equal(frames[0].features.zeroCrossingRate, 0);
  assert.equal(frames[0].features.centroidHz, null, 'unmeasured spectrum stays null on the legacy path');
  assert.equal(frames[0].features.f0Hz, null);
  assert.equal(frames[0].features.voiced, null, 'voicing is unmeasured, not false');
  assert.equal(frames[0].processing_mode, 'main-thread');
  assert.equal(report.processing_mode, 'main-thread');
  assert.equal(report.dropped_frames, 0);
  controller.dispose();
}

// ─── L2 — regression (finding 2): with voice_worker_enabled:false the voice
// WINDOW must agree with the event stream — a turn whose events say 'speech'
// must not report speech_duration_ms: 0 / vad_coverage: null ──
{
  const vad = new MockVadAdapter({ script: [{ probability: 1, frames: 4 }] });
  const aggregator = new VoiceTurnAggregator({ frameMs: 32 });
  let mono = 0;
  const events = [];
  const track = { stop() {}, getSettings() { return {}; }, addEventListener() {}, removeEventListener() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const nodes = [];
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, voice_worker_enabled: false }),
    hostEnabled: true,
    vad,
    onEvent: (event) => events.push(event.state),
    onFrameFeatures: (record) => aggregator.recordFrame(record.features, {
      timestamp: record.timestamp_ms,
      speechProbability: record.speech_probability,
      inPlayback: record.in_playback,
      muted: record.muted,
    }),
    getUserMedia: async () => stream,
    audioContextFactory: () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      destination: {},
      close: async () => {},
    }),
    createWorkletNode: (ctx, name, nodeOptions) => {
      const node = { name, nodeOptions, port: { onmessage: null, close() {} }, connect() {}, disconnect() {} };
      nodes.push(node);
      return node;
    },
    workletUrl: 'about:worklet',
    now: () => mono,
  });
  aggregator.start({ timestamp: 0 });
  await controller.startTurn({ userAction: true });
  for (let i = 0; i < 4; i += 1) {
    mono = i * 32;
    nodes[0].port.onmessage({
      data: { type: 'voice-frame', frame_index: i, frame: toneFrame(), frame_samples: 512, rms: 0.2, peak: 0.3, clipped_count: 0, zcr: 0 },
    });
  }
  await settle();
  mono = 128;
  const report = controller.stopTurn();
  const row = aggregator.finalize({ timestamp: 128, report });

  assert.ok(events.includes('speech'), 'precondition: the event stream detected speech');
  assert.equal(row.voice.speech_duration_ms, 128,
    'the window must report the speech the event stream detected — not 0');
  assert.equal(row.voice.speech_ratio, 1);
  assert.equal(row.voice.vad_coverage, 1, 'the VAD ran on every frame; coverage must say so');
  assert.ok(Math.abs(row.voice.rms_mean - 0.2) < 1e-12, 'worklet loudness scalars feed the window on the legacy path');
  assert.equal(row.voice.pitch_median_hz, null, 'unmeasured pitch stays null — never fabricated');
  assert.equal(row.voice.spectral_centroid_mean_hz, null);
  controller.dispose();
}

console.log('voice-worker.test.js passed');
