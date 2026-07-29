import assert from 'node:assert/strict';
import { createVoiceTurnController, linearResample } from '../src/capture/VoiceTurnController.js';
import {
  VoiceFrameFramer,
  VOICE_FRAME_PROCESSOR_NAME,
} from '../src/capture/voiceFrameWorklet.js';
import { MockVadAdapter } from '../src/mocks/MockVadAdapter.js';
import { createOyonSettings } from '../src/settings/OyonSettings.js';
import { OYON_VOICE_STATES, OYON_VOICE_STATES_VERSION } from '../src/version.js';

/**
 * Everything is injected — no real audio stack. The fake AudioContext /
 * worklet-node pair lets tests drive frames by hand through
 * `node.port.onmessage`, the fake getUserMedia records whether hardware
 * was ever requested (the activation-gate assertion), and the fake tracks
 * record stop() (the teardown assertion).
 */

function makeFakeTrack(settings = {}) {
  const listeners = new Map();
  return {
    stopped: false,
    muted: false,
    _settings: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      sampleRate: 16000,
      channelCount: 1,
      ...settings,
    },
    stop() { this.stopped = true; },
    getSettings() { return { ...this._settings }; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type) { for (const fn of [...(listeners.get(type) || [])]) fn({ type }); },
  };
}

function makeFakeStream(tracks) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks,
  };
}

function makeEnv({
  trackSettings = {},
  refuse16k = false,
  nativeRate = 48000,
  vad = null,
  settingsOverrides = {},
  hostEnabled = true,
} = {}) {
  const tracks = [makeFakeTrack(trackSettings)];
  const stream = makeFakeStream(tracks);

  const gumCalls = [];
  const getUserMedia = async (constraints) => {
    gumCalls.push(constraints);
    return stream;
  };

  const contextFactoryCalls = [];
  const contexts = [];
  const audioContextFactory = (contextOptions) => {
    contextFactoryCalls.push(contextOptions ?? null);
    if (contextOptions?.sampleRate === 16000 && refuse16k) {
      throw new Error('sampleRate constraint not supported');
    }
    const ctx = {
      sampleRate: contextOptions?.sampleRate === 16000 && !refuse16k ? 16000 : nativeRate,
      closed: false,
      addModuleCalls: [],
      audioWorklet: { addModule: async (url) => { ctx.addModuleCalls.push(String(url)); } },
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      destination: {},
      async close() { ctx.closed = true; },
    };
    contexts.push(ctx);
    return ctx;
  };

  const nodes = [];
  const createWorkletNode = (ctx, name, nodeOptions) => {
    const node = {
      name,
      nodeOptions,
      port: { onmessage: null, close() { this.closed = true; }, closed: false },
      connect() {},
      disconnect() { node.disconnected = true; },
      disconnected: false,
    };
    nodes.push(node);
    return node;
  };

  const events = [];
  const frames = [];
  const errors = [];
  let t = 0;

  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, ...settingsOverrides }),
    vad,
    hostEnabled,
    onEvent: (event) => events.push(event),
    onFrameFeatures: (features) => frames.push(features),
    onError: (err) => errors.push(err),
    getUserMedia,
    audioContextFactory,
    createWorkletNode,
    workletUrl: 'about:oyon-voice-worklet',
    now: () => (t += 1),
  });

  return {
    controller, tracks, stream, gumCalls, contextFactoryCalls, contexts, nodes, events, frames, errors,
  };
}

/** Push one worklet frame message into the active node. */
function pushFrame(env, overrides = {}) {
  const node = env.nodes[env.nodes.length - 1];
  const samples = overrides.frame
    || new Float32Array(node.nodeOptions.processorOptions.frameSize);
  node.port.onmessage({
    data: {
      type: 'voice-frame',
      frame_index: overrides.frame_index ?? 0,
      frame: samples,
      frame_samples: samples.length,
      rms: overrides.rms ?? 0.1,
      peak: overrides.peak ?? 0.2,
      clipped_count: overrides.clipped_count ?? 0,
      zcr: overrides.zcr ?? 0.05,
    },
  });
}

/** Drain the controller's async VAD chain. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
}

function states(env) {
  return env.events.map((e) => e.state);
}

// ─── A — activation gate: three INDEPENDENT conditions, each alone blocks
// getUserMedia (audio_text.md §5.1; acceptance criterion 10.3). ──
{
  // A1: voice_enabled false in settings — host enabled, user acted.
  const env = makeEnv({ settingsOverrides: { voice_enabled: false }, hostEnabled: true });
  const result = await env.controller.startTurn({ userAction: true });
  assert.deepEqual(result, { ok: false, reason: 'voice_disabled_in_settings' });
  assert.equal(env.gumCalls.length, 0, 'getUserMedia must be unreachable while voice_enabled is false');
  assert.equal(env.controller.active, false);
}
{
  // A2: host has not enabled voice — settings on, user acted.
  const env = makeEnv({ hostEnabled: false });
  const result = await env.controller.startTurn({ userAction: true });
  assert.deepEqual(result, { ok: false, reason: 'host_not_enabled' });
  assert.equal(env.gumCalls.length, 0, 'getUserMedia must be unreachable without host enablement');
}
{
  // A3: no deliberate per-turn user action — settings on, host enabled.
  const env = makeEnv({ hostEnabled: true });
  const result = await env.controller.startTurn();
  assert.deepEqual(result, { ok: false, reason: 'no_user_action' });
  assert.equal(env.gumCalls.length, 0, 'getUserMedia must be unreachable without a user action');
  // Function-valued hostEnabled is honoured too.
  const env2 = makeEnv({ hostEnabled: () => false });
  assert.equal((await env2.controller.startTurn({ userAction: true })).reason, 'host_not_enabled');
  assert.equal(env2.gumCalls.length, 0);
}

// ─── B — full turn: start … speech/silence/pause transitions from the mock
// script … end. Defaults: 32 ms frames, min_speech 100 ms (4 frames),
// min_silence 300 ms (10 frames), pause 500 ms (16 frames). ──
{
  const vad = new MockVadAdapter({
    script: [
      { probability: 0.9, frames: 6 },   // → 'speech' on frame 4 (128 ms ≥ 100 ms)
      { probability: 0.05, frames: 20 }, // → 'silence' on frame 16, 'pause' on frame 22
    ],
  });
  const env = makeEnv({ vad });
  const result = await env.controller.startTurn({ userAction: true });
  assert.deepEqual(result, { ok: true });
  assert.equal(env.controller.active, true);
  assert.equal(env.gumCalls.length, 1);
  assert.equal(vad.resetCount, 1, 'VAD state must be reset at turn start');

  for (let i = 0; i < 26; i += 1) pushFrame(env, { frame_index: i });
  await settle();
  env.controller.stopTurn();

  assert.deepEqual(states(env), ['start', 'speech', 'silence', 'pause', 'end']);
  for (const event of env.events) {
    assert.ok(OYON_VOICE_STATES.includes(event.state), `unknown state ${event.state}`);
    assert.equal(event.states_version, OYON_VOICE_STATES_VERSION);
    assert.ok(Number.isFinite(event.timestamp_ms));
  }

  // Research-grade per-frame stream: every frame surfaced with raw samples
  // + scalars + VAD probability. Nothing withheld.
  assert.equal(env.frames.length, 26);
  assert.equal(env.frames[0].sample_rate, 16000);
  assert.ok(env.frames[0].frame instanceof Float32Array);
  assert.equal(env.frames[0].frame.length, 512);
  assert.equal(env.frames[0].speech_probability, 0.9);
  assert.equal(env.frames[25].speech_probability, 0.05);
  assert.equal(env.frames[25].vad_state, 'silence');

  // End report carries the turn summary inputs the aggregator needs.
  const end = env.events[env.events.length - 1];
  assert.equal(end.detail.frames_processed, 26);
  assert.equal(end.detail.frame_coverage_ms, 26 * 32);
}

// ─── C — teardown: EVERY track stopped after stopTurn(); graph torn down.
// A microphone that keeps running after a turn is the worst failure. ──
{
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  const report = env.controller.stopTurn();

  assert.ok(env.tracks.every((track) => track.stopped === true),
    'every MediaStreamTrack must be stopped immediately by stopTurn()');
  assert.equal(env.nodes[0].disconnected, true);
  assert.equal(env.nodes[0].port.onmessage, null);
  await settle();
  assert.equal(env.contexts[0].closed, true);
  assert.equal(env.controller.active, false);
  assert.equal(report.reason, 'host_stop');
  assert.equal(env.controller.state, 'end');

  // stopTurn() again is a no-op returning null.
  assert.equal(env.controller.stopTurn(), null);
}

// ─── D — dispose(): idempotent, safe after stopTurn(), silences everything ──
{
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  env.controller.stopTurn();
  env.controller.dispose();
  env.controller.dispose(); // idempotent

  const eventCount = env.events.length;
  const frameCount = env.frames.length;
  // Late frame + lifecycle calls after dispose: nothing may be emitted.
  if (env.nodes[0].port.onmessage) pushFrame(env);
  env.controller.aiPlaybackStart();
  env.controller.aiPlaybackEnd();
  await settle();
  assert.equal(env.events.length, eventCount, 'no events after dispose()');
  assert.equal(env.frames.length, frameCount);
  assert.deepEqual(await env.controller.startTurn({ userAction: true }), { ok: false, reason: 'disposed' });
  assert.equal(env.gumCalls.length, 1, 'no new hardware requests after dispose()');
}
{
  // dispose() while a turn is ACTIVE stops the tracks itself.
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  env.controller.dispose();
  assert.ok(env.tracks.every((track) => track.stopped === true), 'dispose() mid-turn must stop tracks');
  assert.equal(states(env).pop(), 'end');
}

// ─── D2 — regression (finding 9, dispose-mid-start probe): dispose() while
// getUserMedia is still pending must stop the arriving stream and refuse
// the start. A microphone recording after dispose() is the worst failure
// this library can have. ──
{
  let resolveStream;
  let stops = 0;
  const track = {
    muted: false,
    stop() { stops += 1; },
    getSettings() { return {}; },
    addEventListener() {},
    removeEventListener() {},
  };
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, voice_worker_enabled: false }),
    hostEnabled: true,
    getUserMedia: () => new Promise((r) => { resolveStream = r; }),
    audioContextFactory: async () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      destination: {},
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      close() {},
    }),
    createWorkletNode: () => ({ port: { onmessage: null, close() {} }, connect() {}, disconnect() {} }),
    now: () => 0,
  });
  const starting = controller.startTurn({ userAction: true });
  controller.dispose(); // lands while getUserMedia is pending
  resolveStream({ getTracks: () => [track], getAudioTracks: () => [track] });
  const result = await starting;
  assert.deepEqual(result, { ok: false, reason: 'disposed' },
    'a start overtaken by dispose() must resolve refused, never ok');
  assert.equal(controller.active, false);
  assert.ok(stops >= 1, 'the stream arriving after dispose() must be stopped immediately');
}
// ─── D3 — regression (finding 9): stopTurn() during startup cancels the
// pending start the same way. ──
{
  let resolveStream;
  let stops = 0;
  const track = {
    muted: false,
    stop() { stops += 1; },
    getSettings() { return {}; },
    addEventListener() {},
    removeEventListener() {},
  };
  const events = [];
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, voice_worker_enabled: false }),
    hostEnabled: true,
    onEvent: (event) => events.push(event.state),
    getUserMedia: () => new Promise((r) => { resolveStream = r; }),
    audioContextFactory: async () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      destination: {},
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      close() {},
    }),
    createWorkletNode: () => ({ port: { onmessage: null, close() {} }, connect() {}, disconnect() {} }),
    now: () => 0,
  });
  const starting = controller.startTurn({ userAction: true });
  assert.equal(controller.stopTurn('host_stop'), null, 'no turn was active — no report, no end event');
  resolveStream({ getTracks: () => [track], getAudioTracks: () => [track] });
  const result = await starting;
  assert.deepEqual(result, { ok: false, reason: 'stopped_during_start' });
  assert.equal(controller.active, false);
  assert.ok(stops >= 1, 'the stream arriving after stopTurn() must be stopped immediately');
  assert.ok(!events.includes('start') && !events.includes('end'),
    'a cancelled start emits neither start nor end');
  // The controller is still usable: the next start works normally.
  const env = makeEnv({ vad: new MockVadAdapter() });
  assert.deepEqual(await env.controller.startTurn({ userAction: true }), { ok: true });
  env.controller.stopTurn();
}
// ─── D4 — regression (finding 9, concurrent-start probe): two overlapping
// startTurn() calls must not acquire two streams and leak one track. ──
{
  const tracks = [0, 1].map((id) => ({
    id,
    stopped: 0,
    muted: false,
    stop() { this.stopped += 1; },
    getSettings() { return {}; },
    addEventListener() {},
    removeEventListener() {},
  }));
  let gumCalls = 0;
  const getUserMedia = async () => {
    const track = tracks[gumCalls];
    gumCalls += 1;
    return { id: track.id, getTracks: () => [track], getAudioTracks: () => [track] };
  };
  const contexts = [];
  const controller = createVoiceTurnController({
    settings: createOyonSettings({ voice_enabled: true, voice_worker_enabled: false }),
    hostEnabled: true,
    getUserMedia,
    audioContextFactory: async () => {
      const ctx = {
        sampleRate: 16000,
        audioWorklet: { addModule: async () => {} },
        destination: {},
        seen: null,
        createMediaStreamSource(s) { ctx.seen = s.id; return { connect() {}, disconnect() {} }; },
        close() {},
      };
      contexts.push(ctx);
      return ctx;
    },
    createWorkletNode: () => ({ port: { onmessage: null, close() {} }, connect() {}, disconnect() {} }),
    now: () => 0,
  });
  const [first, second] = await Promise.all([
    controller.startTurn({ userAction: true }),
    controller.startTurn({ userAction: true }),
  ]);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: false, reason: 'start_in_progress' },
    'the losing concurrent start is refused, not silently doubled');
  assert.equal(gumCalls, 1, 'only ONE getUserMedia — the loser never touches hardware');
  assert.equal(contexts.length, 1);
  assert.equal(controller.active, true);
  controller.stopTurn();
  assert.equal(controller.active, false);
  assert.equal(tracks[0].stopped, 1, 'the single acquired track is stopped by stopTurn()');
  assert.equal(tracks[1].stopped, 0, 'no second track was ever acquired to leak');
}

// ─── E — AI playback exclusion (§5.9): interval excluded from the speech
// machine; VAD speech during playback emits 'contaminated', never 'speech'. ──
{
  const vad = new MockVadAdapter({ script: [{ probability: 0.95, frames: 30 }] });
  const env = makeEnv({ vad });
  await env.controller.startTurn({ userAction: true });

  env.controller.aiPlaybackStart();
  env.controller.aiPlaybackStart(); // double-start is a no-op
  for (let i = 0; i < 10; i += 1) pushFrame(env, { frame_index: i });
  await settle();
  env.controller.aiPlaybackEnd();

  assert.ok(!states(env).includes('speech'),
    'speech during an AI playback interval must never count as learner speech');
  assert.equal(states(env).filter((s) => s === 'contaminated').length, 1,
    'one contaminated event per contiguous leakage run');
  assert.equal(states(env).filter((s) => s === 'playback').length, 2, 'playback start + end markers');
  assert.ok(env.frames.every((frame) => frame.in_playback === true));

  // After the interval, the same VAD speech DOES count as learner speech.
  for (let i = 10; i < 16; i += 1) pushFrame(env, { frame_index: i });
  await settle();
  assert.ok(states(env).includes('speech'), 'post-playback speech resumes normal counting');

  const report = env.controller.stopTurn();
  assert.equal(report.playback_intervals.length, 1);
  assert.ok(Number.isFinite(report.playback_intervals[0].start_ms));
  assert.ok(Number.isFinite(report.playback_intervals[0].end_ms));
  assert.equal(report.contaminated_runs, 1);
}
{
  // An interval still open at stopTurn() is closed into the report.
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  env.controller.aiPlaybackStart();
  const report = env.controller.stopTurn();
  assert.equal(report.playback_intervals.length, 1);
  assert.ok(Number.isFinite(report.playback_intervals[0].end_ms));
}

// ─── F — clipping and muting ──
{
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });

  pushFrame(env, { frame_index: 0, clipped_count: 7, peak: 1.0 });
  await settle();
  assert.ok(states(env).includes('clipped'));
  const clippedEvent = env.events.find((e) => e.state === 'clipped');
  assert.equal(clippedEvent.detail.clipped_count, 7);

  // Track mute event → 'muted'; muted frames bypass the speech machine.
  env.tracks[0].muted = true;
  env.tracks[0].fire('mute');
  assert.ok(states(env).includes('muted'));
  pushFrame(env, { frame_index: 1 });
  await settle();
  assert.equal(env.frames[1].muted, true);
  env.controller.stopTurn();
}
{
  // Mute detected from per-frame track state even without a 'mute' event.
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  env.tracks[0].muted = true; // no event fired
  pushFrame(env);
  await settle();
  assert.ok(states(env).includes('muted'));
  env.controller.stopTurn();
}

// ─── G — 16 kHz requested from the context factory AND getUserMedia; AGC
// requested off when Oyon owns the stream (§5.6). ──
{
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });

  assert.deepEqual(env.contextFactoryCalls, [{ sampleRate: 16000 }]);
  assert.equal(env.gumCalls[0].audio.sampleRate, 16000);
  assert.equal(env.gumCalls[0].audio.autoGainControl, false,
    'Oyon-owned streams request AGC off (voice_request_agc_off default)');
  assert.equal(env.gumCalls[0].audio.channelCount, 1);

  // Worklet plumbing: module loaded, processor name + 512-sample frames.
  assert.deepEqual(env.contexts[0].addModuleCalls, ['about:oyon-voice-worklet']);
  assert.equal(env.nodes[0].name, VOICE_FRAME_PROCESSOR_NAME);
  assert.equal(env.nodes[0].nodeOptions.processorOptions.frameSize, 512);

  const start = env.events[0];
  assert.equal(start.state, 'start');
  assert.equal(start.detail.resample_mode, 'native-16k');
  assert.equal(start.detail.context_sample_rate, 16000);
  env.controller.stopTurn();
}
{
  // voice_request_agc_off:false → AGC left on.
  const env = makeEnv({ vad: new MockVadAdapter(), settingsOverrides: { voice_request_agc_off: false } });
  await env.controller.startTurn({ userAction: true });
  assert.equal(env.gumCalls[0].audio.autoGainControl, true);
  env.controller.stopTurn();
}

// ─── H — documented fallback: context refuses 16 kHz → native rate +
// linear interpolation down to 512-sample 16 kHz frames. ──
{
  const vad = new MockVadAdapter({ script: [{ probability: 0.9, frames: 8 }] });
  const env = makeEnv({ vad, refuse16k: true, nativeRate: 48000 });
  await env.controller.startTurn({ userAction: true });

  assert.deepEqual(env.contextFactoryCalls, [{ sampleRate: 16000 }, null],
    'factory retried without the sampleRate constraint');
  assert.equal(env.events[0].detail.resample_mode, 'linear-interpolation');
  assert.equal(env.events[0].detail.context_sample_rate, 48000);
  // 32 ms at 48 kHz = 1536 samples per worklet frame.
  assert.equal(env.nodes[0].nodeOptions.processorOptions.frameSize, 1536);

  pushFrame(env, { frame: new Float32Array(1536).fill(0.5) });
  await settle();
  assert.equal(env.frames[0].frame.length, 512, 'fallback path must hand VAD 512-sample 16 kHz frames');
  assert.equal(env.frames[0].resampled, true);
  assert.ok(vad.lastFrame instanceof Float32Array);
  assert.equal(vad.lastFrame.length, 512);
  env.controller.stopTurn();
}
{
  // linearResample unit behaviour: length scaling + endpoint preservation.
  const input = Float32Array.of(0, 1, 2, 3, 4, 5);
  const out = linearResample(input, 48000, 16000);
  assert.equal(out.length, 2);
  assert.equal(out[0], 0);
  assert.equal(out[out.length - 1], 5);
  assert.equal(linearResample(input, 16000, 16000), input, 'same-rate input passes through untouched');
}

// ─── I — track.getSettings() surfaced, including AGC / owner / loudness
// contamination; host-owned streams are reported and NOT stopped. ──
{
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true });
  const trackSettings = env.controller.getTrackSettings();
  assert.equal(trackSettings.echo_cancellation, true);
  assert.equal(trackSettings.noise_suppression, true);
  assert.equal(trackSettings.auto_gain_control, false);
  assert.equal(trackSettings.sample_rate, 16000);
  assert.equal(trackSettings.channel_count, 1);
  assert.equal(trackSettings.stream_owner, 'oyon');
  assert.equal(trackSettings.loudness_contaminated, false);
  assert.deepEqual(env.events[0].detail.track_settings, trackSettings);
  env.controller.stopTurn();
}
{
  // Host-owned stream with AGC on: surfaced as loudness-contaminated
  // (§5.6 — mark, don't pretend comparable), no getUserMedia call, and the
  // host's tracks are left running on stopTurn() (the host shares them
  // with its STT path; see the controller's teardown doc).
  const hostTrack = makeFakeTrack({ autoGainControl: true });
  const hostStream = makeFakeStream([hostTrack]);
  const env = makeEnv({ vad: new MockVadAdapter() });
  await env.controller.startTurn({ userAction: true, stream: hostStream });

  assert.equal(env.gumCalls.length, 0, 'host-supplied stream must not trigger getUserMedia');
  const trackSettings = env.controller.getTrackSettings();
  assert.equal(trackSettings.stream_owner, 'host');
  assert.equal(trackSettings.auto_gain_control, true);
  assert.equal(trackSettings.loudness_contaminated, true);

  env.controller.stopTurn();
  assert.equal(hostTrack.stopped, false, 'host-owned tracks are not stopped by default');
}

// ─── J — a second turn on the same controller works (fresh state). ──
{
  const vad = new MockVadAdapter({ script: [{ probability: 0.9, frames: 6 }] });
  const env = makeEnv({ vad });
  await env.controller.startTurn({ userAction: true });
  assert.deepEqual(await env.controller.startTurn({ userAction: true }),
    { ok: false, reason: 'turn_already_active' });
  env.controller.stopTurn();

  vad.reset(); // controller also resets; harmless double
  const result = await env.controller.startTurn({ userAction: true });
  assert.deepEqual(result, { ok: true });
  assert.ok(vad.resetCount >= 2, 'each turn re-resets the VAD');
  for (let i = 0; i < 6; i += 1) pushFrame(env, { frame_index: i });
  await settle();
  assert.equal(states(env).filter((s) => s === 'start').length, 2);
  assert.ok(states(env).includes('speech'));
  env.controller.stopTurn();
  assert.ok(env.tracks.every((t) => t.stopped));
}

// ─── K — worklet framer: framing + cheap time-domain features (the logic
// that runs on the render thread, exercised directly in Node). ──
{
  const framer = new VoiceFrameFramer({ frameSize: 256, clipThreshold: 0.999 });

  // Two 128-sample render quanta complete exactly one 256-sample frame.
  const block = new Float32Array(128).fill(0.5);
  assert.deepEqual(framer.push(block), []);
  const messages = framer.push(block);
  assert.equal(messages.length, 1);
  const [message] = messages;
  assert.equal(message.type, 'voice-frame');
  assert.equal(message.frame_index, 0);
  assert.equal(message.frame.length, 256);
  assert.ok(Math.abs(message.rms - 0.5) < 1e-9);
  assert.equal(message.peak, 0.5);
  assert.equal(message.clipped_count, 0);
  assert.equal(message.zcr, 0);

  // Alternating full-scale samples: all clipped, ZCR = 1.
  const square = new Float32Array(256);
  for (let i = 0; i < square.length; i += 1) square[i] = i % 2 === 0 ? 1 : -1;
  const [clippedMessage] = framer.push(square);
  assert.equal(clippedMessage.frame_index, 1);
  assert.equal(clippedMessage.clipped_count, 256);
  assert.equal(clippedMessage.zcr, 1);
  assert.equal(clippedMessage.peak, 1);

  // Oversized block yields multiple frames in one push.
  const big = new Float32Array(512);
  assert.equal(framer.push(big).length, 2);
}

console.log('voice-turn-controller.test.js passed');
