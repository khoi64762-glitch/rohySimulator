import assert from 'node:assert/strict';
import { createSignalCapture } from '../src/core/SignalCapture.js';
import { MockVadAdapter } from '../src/mocks/MockVadAdapter.js';

/**
 * createSignalCapture tests. Everything is faked: DOM targets follow the
 * `tests/typing-adapter.test.js` / `tests/interaction-tracker.test.js` idiom
 * (EventTarget-shaped objects whose add/remove calls are recorded so teardown
 * symmetry is assertable), the store is an in-memory `bulkAdd` recorder, the
 * voice stack injects fake getUserMedia/AudioContext/worklet collaborators
 * into the REAL VoiceTurnController (worker path off, MockVadAdapter), and
 * both clocks are hand-advanced.
 */

// ── fakes ──────────────────────────────────────────────────────────────────

function makeClocks() {
  const state = { wall: 1_700_000_000_000, mono: 10_000 };
  return {
    state,
    now: () => state.wall,
    monotonicNow: () => state.mono,
    advance(ms) { state.wall += ms; state.mono += ms; },
  };
}

function makeFakeTarget(label) {
  const addCalls = [];
  const removeCalls = [];
  const listeners = new Map();
  return {
    label,
    addCalls,
    removeCalls,
    addEventListener(type, fn) {
      addCalls.push([type, fn]);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      removeCalls.push([type, fn]);
      listeners.get(type)?.delete(fn);
    },
    fire(type, props = {}) {
      const set = listeners.get(type);
      if (!set) return;
      for (const fn of [...set]) fn({ type, ...props });
    },
    listenerCount() {
      let count = 0;
      for (const set of listeners.values()) count += set.size;
      return count;
    },
  };
}

function makeFakeDocument() {
  const target = makeFakeTarget('document');
  return {
    ...target,
    hidden: false,
    visibilityState: 'visible',
    activeElement: null,
    documentElement: { scrollHeight: 2000 },
    getSelection: () => ({ toString: () => '' }),
  };
}

function makeFakeWindow() {
  const target = makeFakeTarget('window');
  const timers = new Map();
  let nextId = 1;
  return {
    ...target,
    innerWidth: 1000,
    innerHeight: 800,
    scrollY: 0,
    timers,
    setTimeout(fn, ms) { const id = nextId; nextId += 1; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
}

function makeFakeElement(doc) {
  const target = makeFakeTarget('element');
  const element = {
    ...target,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    ownerDocument: doc,
  };
  return element;
}

function makeFakeStore({ failStores = [] } = {}) {
  const calls = [];
  const failing = new Set(failStores);
  return {
    calls,
    rows(storeName) {
      const out = [];
      for (const [name, records] of calls) {
        if (name === storeName) out.push(...records);
      }
      return out;
    },
    async bulkAdd(storeName, records) {
      if (failing.has(storeName)) throw new Error(`bulkAdd rejected for ${storeName}`);
      calls.push([storeName, records.map((record) => ({ ...record }))]);
      return records.map((_, index) => index);
    },
  };
}

/** Deterministic persistence timers: recorded, never fired (batch flushes drive the tests). */
function makePersistenceTimerFns() {
  const pending = new Set();
  let nextId = 1;
  return {
    pending,
    setTimerFn(fn, ms) { const id = nextId; nextId += 1; pending.add(id); return id; },
    clearTimerFn(id) { pending.delete(id); },
  };
}

/** Type one character through the real TypingComposerAdapter's listeners. */
function typeChar(clocks, element, char, gapMs = 100) {
  clocks.advance(gapMs);
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value += char;
  element.selectionStart = element.value.length;
  element.selectionEnd = element.value.length;
  element.fire('input');
}

/** Fake voice hardware for the REAL VoiceTurnController. */
function makeFakeVoiceHardware() {
  const track = {
    stopped: false,
    muted: false,
    stop() { this.stopped = true; },
    getSettings: () => ({
      autoGainControl: false,
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 16000,
      channelCount: 1,
    }),
    addEventListener() {},
    removeEventListener() {},
  };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const gumCalls = [];
  const disconnects = [];
  return {
    track,
    gumCalls,
    disconnects,
    getUserMedia: async (constraints) => { gumCalls.push(constraints); return stream; },
    audioContextFactory: async () => ({
      sampleRate: 16000,
      audioWorklet: { addModule: async () => {} },
      createMediaStreamSource: () => ({ connect() {}, disconnect() { disconnects.push('source'); } }),
      destination: {},
      close: async () => {},
    }),
    createWorkletNode: () => ({
      port: { onmessage: null, close() {} },
      connect() {},
      disconnect() { disconnects.push('worklet'); },
    }),
  };
}

const settle = () => new Promise((resolveFn) => setTimeout(resolveFn, 0));

// ── 1. settings gate CONSTRUCTION: disabled modalities build nothing ──────

async function testDisabledModalitiesConstructNothing() {
  const clocks = makeClocks();
  const factoryCalls = { voice: 0, interaction: 0, aiAssist: 0, typingAdapter: 0 };
  const gumCalls = [];
  const poison = (name) => new Proxy({}, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'valueOf') return () => true;
      throw new Error(`${name} was touched (${String(prop)}) despite the modality being disabled`);
    },
  });

  const capture = createSignalCapture({
    settings: { typing_enabled: true }, // everything else stays default-off
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    voiceControllerFactory: () => { factoryCalls.voice += 1; throw new Error('voice constructed'); },
    interactionTrackerFactory: () => { factoryCalls.interaction += 1; throw new Error('interaction constructed'); },
    aiAssistTrackerFactory: () => { factoryCalls.aiAssist += 1; throw new Error('ai_assist constructed'); },
    voiceAggregator: poison('voiceAggregator'),
    interactionAggregator: poison('interactionAggregator'),
    discourseAggregator: poison('discourseAggregator'),
    aiAssistAggregator: poison('aiAssistAggregator'),
    voice: { getUserMedia: async () => { gumCalls.push(1); throw new Error('getUserMedia reached'); } },
  });

  capture.start({ capture_id: 'cap-1', session_id: 'ses-1' });

  assert.equal(capture.active, true);
  assert.notEqual(capture.typing, null, 'enabled modality must have a handle');
  assert.equal(capture.voice, null, 'disabled voice handle must be null, not a stub');
  assert.equal(capture.interaction, null);
  assert.equal(capture.discourse, null);
  assert.equal(capture.aiAssist, null);
  assert.deepEqual(factoryCalls, { voice: 0, interaction: 0, aiAssist: 0, typingAdapter: 0 },
    'disabled modalities must never invoke their collaborator factories');
  assert.equal(gumCalls.length, 0, 'getUserMedia must be unreachable while voice is disabled');
  assert.equal(capture.stats.errors, 0, 'nothing should have been constructed, so nothing can have failed');

  await capture.stop();
  console.log('  ✓ disabled modalities construct nothing (handles null, factories untouched)');
}

// ── 2. one log, one clock: sequence_index monotonic ACROSS modalities ─────

async function testSharedSequenceIndexAcrossModalities() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const capture = createSignalCapture({
    settings: { typing_enabled: true, ai_assist_enabled: true },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
  });
  capture.start({ capture_id: 'cap-seq', session_id: 'ses-seq' });

  capture.typing.attach(element, { targetKind: 'chat_composer', targetId: 'composer-1' });
  typeChar(clocks, element, 'h');          // typing: insert
  capture.aiAssist.requested({ suggestion_id: 's1' });  // ai_assist: suggestion_request
  typeChar(clocks, element, 'i');          // typing: insert
  clocks.advance(40);
  capture.aiAssist.shown({ suggestion_id: 's1', options_shown: 3 });
  capture.aiAssist.accepted({ suggestion_id: 's1', chosen_index: 0, accepted_graphemes: 12 });
  typeChar(clocks, element, '!');          // typing: insert
  capture.typing.submit();                 // typing: submit

  const events = capture.log.all();
  const states = events.map((event) => `${event.modality}:${event.state}`);
  assert.deepEqual(states, [
    'typing:start',
    'typing:insert',
    'ai_assist:suggestion_request',
    'typing:insert',
    'ai_assist:suggestion_shown',
    'ai_assist:suggestion_accept',
    'typing:insert',
    'typing:submit',
  ], 'events from both modalities must interleave on one timeline in emission order');

  const indices = events.map((event) => event.sequence_index);
  assert.deepEqual(indices, [0, 1, 2, 3, 4, 5, 6, 7],
    'sequence_index must be strictly increasing ACROSS modalities');

  // Unfiltered toSequences(): one interleaved chain, same order.
  const sequences = capture.log.toSequences();
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0], events.map((event) => event.state));

  // Latency correlation crossed the shared clock correctly.
  const shown = events.find((event) => event.state === 'suggestion_shown');
  assert.equal(shown.detail.latency_ms, 140, 'request→shown latency measured on the shared monotonic clock');

  await capture.stop();
  console.log('  ✓ shared monotonic sequence_index across modalities (interleaved toSequences)');
}

// ── 3. windows reach the store, the transport, and onWindow ───────────────

async function testWindowsReachStoreAndTransport() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const store = makeFakeStore();
  const transportCalls = [];
  const onWindowRows = [];
  const timerFns = makePersistenceTimerFns();

  const capture = createSignalCapture({
    settings: { typing_enabled: true },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    transport: { send: async (rows, context) => { transportCalls.push([rows, context]); } },
    onWindow: (row) => onWindowRows.push(row),
    persistenceOptions: { batchSize: 3, ...timerFns },
  });
  capture.start({ capture_id: 'cap-w', session_id: 'ses-w' });

  capture.typing.attach(element, {});
  typeChar(clocks, element, 'a');
  typeChar(clocks, element, 'b');
  const rawWindow = capture.typing.submit();
  assert.equal(rawWindow.typing.committed_graphemes, 2);

  await capture.stop();

  const windowRows = store.rows('signal_windows');
  assert.equal(windowRows.length, 1, 'the finalized typing window must land in signal_windows');
  const row = windowRows[0];
  assert.equal(row.modality, 'typing');
  assert.equal(row.capture_id, 'cap-w');
  assert.equal(row.session_id, 'ses-w');
  assert.match(row.window_id, /^win_/);
  assert.equal(row.typing.submitted, true);

  assert.equal(transportCalls.length, 1, 'the window must also go out through the transport');
  assert.equal(transportCalls[0][0][0].window_id, row.window_id);
  assert.deepEqual(transportCalls[0][1], { capture_id: 'cap-w', session_id: 'ses-w' });

  assert.equal(onWindowRows.length, 1);
  assert.equal(onWindowRows[0].window_id, row.window_id);

  console.log('  ✓ finalized windows reach signal_windows, the transport, and onWindow');
}

// ── 4. batched events reach signal_events; stats track persistence ────────

async function testBatchedEventPersistence() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const store = makeFakeStore();
  const timerFns = makePersistenceTimerFns();
  const onEventSeen = [];

  const capture = createSignalCapture({
    settings: { typing_enabled: true },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    onEvent: (event) => onEventSeen.push(event.state),
    persistenceOptions: { batchSize: 2, ...timerFns },
  });
  capture.start({ capture_id: 'cap-p', session_id: 'ses-p' });

  capture.typing.attach(element, {});
  typeChar(clocks, element, 'x'); // 2 events so far (start, insert) → one batch flush
  await settle();
  assert.equal(store.rows('signal_events').length, 2,
    'reaching batchSize must flush a batch mid-capture, not only at stop');

  typeChar(clocks, element, 'y'); // 3rd event, sits pending
  assert.equal(capture.stats.persistence.pending, 1);
  await capture.stop(); // abandons the episode (+abandon event) and flushes

  const persisted = store.rows('signal_events');
  assert.deepEqual(persisted.map((event) => event.state), ['start', 'insert', 'insert', 'abandon']);
  assert.deepEqual(persisted.map((event) => event.sequence_index), [0, 1, 2, 3]);
  assert.equal(persisted[0].capture_id, 'cap-p');
  assert.equal(persisted[0].state_vocabulary, 'typing-states-v1');

  const stats = capture.stats;
  assert.equal(stats.persistence.written, 4);
  assert.equal(stats.persistence.failed, 0);
  assert.equal(stats.persistence.pending, 0);
  assert.deepEqual(onEventSeen, ['start', 'insert', 'insert', 'abandon']);
  assert.equal(timerFns.pending.size, 0, 'persistence flush timers must all be cleared by stop()');

  console.log('  ✓ events persist to signal_events in batches; stats.persistence accurate');
}

// ── 5. stop() finalizes in-flight typing episode AND voice turn, ──────────
//      removes every listener, stops every track

async function testStopFinalizesEverythingAndTearsDown() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const win = makeFakeWindow();
  const element = makeFakeElement(doc);
  const store = makeFakeStore();
  const hardware = makeFakeVoiceHardware();
  const timerFns = makePersistenceTimerFns();

  const capture = createSignalCapture({
    settings: {
      typing_enabled: true,
      voice_enabled: true,
      interaction_enabled: true,
      voice_worker_enabled: false, // in-thread path: injected MockVadAdapter, no Worker
    },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    documentRef: doc,
    windowRef: win,
    persistenceOptions: { batchSize: 100, ...timerFns },
    voice: {
      vad: new MockVadAdapter({ script: [{ probability: 0.9, frames: 8 }] }),
      getUserMedia: hardware.getUserMedia,
      audioContextFactory: hardware.audioContextFactory,
      createWorkletNode: hardware.createWorkletNode,
    },
  });
  capture.start({ capture_id: 'cap-t', session_id: 'ses-t' });

  // Interaction is ambient: listeners attached at start.
  assert.ok(doc.addCalls.length > 0, 'interaction tracker must attach document listeners');
  assert.ok(win.addCalls.length > 0, 'interaction tracker must attach window listeners');
  doc.fire('mousemove', { clientX: 250, clientY: 200 });
  clocks.advance(50);
  doc.fire('click', { clientX: 250, clientY: 200, button: 0 });

  // In-flight typing episode (never submitted).
  capture.typing.attach(element, {});
  typeChar(clocks, element, 'z');
  assert.ok(element.addCalls.length > 0);

  // In-flight voice turn (never stopped by the host).
  const result = await capture.voice.startTurn();
  assert.equal(result.ok, true, `voice turn must start (got ${JSON.stringify(result)})`);
  assert.equal(hardware.gumCalls.length, 1, 'getUserMedia called exactly once for the turn');
  assert.equal(hardware.track.stopped, false);
  assert.equal(capture.voice.active, true);

  await capture.stop();

  // Teardown: nothing left attached, nothing left running.
  assert.equal(element.listenerCount(), 0, 'every composer listener must be removed');
  assert.equal(element.addCalls.length, element.removeCalls.length,
    'composer add/remove listener calls must be exactly symmetric');
  assert.equal(doc.listenerCount(), 0, 'every document listener must be removed');
  assert.equal(doc.addCalls.length, doc.removeCalls.length);
  assert.equal(win.listenerCount(), 0, 'every window listener must be removed');
  assert.equal(win.addCalls.length, win.removeCalls.length);
  assert.equal(win.timers.size, 0, 'the interaction idle/selection timers must be cleared');
  assert.equal(hardware.track.stopped, true, 'stop() must stop the MediaStreamTrack — a leaked microphone is the worst failure');
  assert.equal(capture.voice, null, 'handles reset to null once the capture stops');
  assert.equal(capture.active, false);

  // Finalization: all three in-flight windows were emitted and persisted.
  const rows = store.rows('signal_windows');
  const byModality = Object.fromEntries(rows.map((row) => [row.modality, row]));
  assert.ok(byModality.typing, 'in-flight typing episode must be finalized at stop()');
  assert.equal(byModality.typing.typing.abandoned, true, 'an unsubmitted episode finalizes as abandoned');
  assert.ok(byModality.voice, 'in-flight voice turn must be finalized at stop()');
  assert.ok(byModality.voice.voice.turn_duration_ms >= 0);
  assert.ok(byModality.interaction, 'the ambient interaction interval must be finalized at stop()');
  assert.equal(byModality.interaction.interaction.click_count, 1);
  assert.equal(byModality.interaction.interaction.pointer_sample_count, 1);

  // The terminal lifecycle events made it into the log before it closed.
  const states = capture.log.all().map((event) => `${event.modality}:${event.state}`);
  assert.ok(states.includes('typing:abandon'), `log must carry the abandon event (${states.join(', ')})`);
  assert.ok(states.includes('voice:start'), 'log must carry the voice start event');
  assert.ok(states.includes('voice:end'), 'log must carry the voice end event');
  assert.ok(states.includes('interaction:click'));

  // And the events store holds everything (single final flush).
  assert.equal(store.rows('signal_events').length, capture.log.all().length);

  console.log('  ✓ stop() finalizes in-flight typing episode + voice turn; listeners removed, tracks stopped');
}

// ── 6. dispose() idempotent; events after teardown are ignored ────────────

async function testDisposeIdempotentAndPostStopEventsIgnored() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const store = makeFakeStore();
  const timerFns = makePersistenceTimerFns();

  const capture = createSignalCapture({
    settings: { typing_enabled: true, ai_assist_enabled: true, discourse_enabled: true },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    persistenceOptions: { batchSize: 100, ...timerFns },
  });
  capture.start({ capture_id: 'cap-d', session_id: 'ses-d' });

  const typing = capture.typing;
  const aiAssist = capture.aiAssist;
  const discourse = capture.discourse;

  typing.attach(element, {});
  typeChar(clocks, element, 'q');
  aiAssist.requested({ suggestion_id: 'r1' });
  discourse.analyze('This is a statement.');

  await capture.stop();
  const statsAfterStop = capture.stats;
  const logSizeAfterStop = capture.log.all().length;

  // Stale handles: every late call is ignored, never recorded, never throws.
  assert.equal(typing.attach(element, {}), null, 'attach after stop must be refused');
  assert.equal(typing.submit(), null);
  assert.equal(aiAssist.requested({ suggestion_id: 'r2' }), null, 'disposed tracker returns null');
  assert.deepEqual(discourse.analyze('More text after stop.'), [], 'discourse after stop is ignored');
  element.fire('beforeinput', { inputType: 'insertText' });
  element.fire('input'); // listeners are gone — nothing to receive it

  assert.equal(capture.log.all().length, logSizeAfterStop, 'no event may be recorded after teardown');
  assert.deepEqual(capture.stats.events, statsAfterStop.events);

  // dispose() is idempotent and safe after stop().
  await capture.dispose();
  await capture.dispose();
  assert.throws(() => capture.start({}), /after dispose/);

  // Windows from the stop-time finalization are all present exactly once.
  const modalities = store.rows('signal_windows').map((row) => row.modality).sort();
  assert.deepEqual(modalities, ['ai_assist', 'discourse', 'typing']);

  console.log('  ✓ dispose() idempotent after stop(); post-teardown events ignored');
}

// ── 7. failures are visible: persistence, window writes, modality start ───

async function testFailuresSurfaceNotSwallowed() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const errors = [];
  const timerFns = makePersistenceTimerFns();

  // 7a. Event persistence failure.
  {
    const store = makeFakeStore({ failStores: ['signal_events'] });
    const capture = createSignalCapture({
      settings: { typing_enabled: true },
      now: clocks.now,
      monotonicNow: clocks.monotonicNow,
      store,
      onError: (error, info) => errors.push(info.scope),
      persistenceOptions: { batchSize: 1, ...timerFns },
    });
    capture.start({ capture_id: 'cap-f1', session_id: 'ses-f1' });
    capture.typing.attach(element, {});
    typeChar(clocks, element, 'a');
    await settle();
    await capture.stop();
    await settle();
    assert.ok(errors.includes('persistence'), `persistence failure must surface via onError (saw: ${errors.join(', ')})`);
    assert.ok(capture.stats.persistence.failed > 0, 'stats.persistence.failed must count the lost batch');
    assert.ok(capture.stats.errors > 0);
  }

  // 7b. Window persistence failure — stop() still resolves, error surfaces.
  {
    errors.length = 0;
    const store = makeFakeStore({ failStores: ['signal_windows'] });
    const element2 = makeFakeElement(doc);
    const capture = createSignalCapture({
      settings: { typing_enabled: true },
      now: clocks.now,
      monotonicNow: clocks.monotonicNow,
      store,
      onError: (error, info) => errors.push(info.scope),
      persistenceOptions: { batchSize: 100, ...timerFns },
    });
    capture.start({ capture_id: 'cap-f2', session_id: 'ses-f2' });
    capture.typing.attach(element2, {});
    typeChar(clocks, element2, 'b');
    capture.typing.submit();
    await capture.stop();
    assert.ok(errors.includes('window_persistence'),
      `window write failure must surface via onError (saw: ${errors.join(', ')})`);
  }

  // 7c. A modality that fails to START surfaces and stays null.
  {
    errors.length = 0;
    const capture = createSignalCapture({
      settings: { interaction_enabled: true },
      now: clocks.now,
      monotonicNow: clocks.monotonicNow,
      interactionTrackerFactory: () => { throw new Error('no DOM here'); },
    });
    capture.start({ capture_id: 'cap-f3', session_id: 'ses-f3' });
    assert.equal(capture.interaction, null, 'a failed modality start leaves the handle null');
    assert.equal(capture.active, true, 'one failed modality must not kill the capture');
    assert.equal(capture.stats.errors, 1);
    await capture.stop();
  }

  // Failure scopes surfaced through onError, never thrown into the pipeline.
  console.log('  ✓ persistence/window/start failures surface via onError + stats, never swallowed');
}

// ── 8. voice refusal path leaves no half-started turn ─────────────────────

async function testVoiceRefusalDiscardsTurn() {
  const clocks = makeClocks();
  const store = makeFakeStore();
  const hardware = makeFakeVoiceHardware();
  const timerFns = makePersistenceTimerFns();

  const capture = createSignalCapture({
    settings: { voice_enabled: true, voice_worker_enabled: false },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    persistenceOptions: { batchSize: 100, ...timerFns },
    voice: {
      vad: new MockVadAdapter(),
      getUserMedia: hardware.getUserMedia,
      audioContextFactory: hardware.audioContextFactory,
      createWorkletNode: hardware.createWorkletNode,
    },
  });
  capture.start({ capture_id: 'cap-v', session_id: 'ses-v' });

  // Controller refuses (no user action) — the aggregator turn is discarded.
  const refused = await capture.voice.startTurn({ userAction: false });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'no_user_action');
  assert.equal(hardware.gumCalls.length, 0, 'a refused gate must never reach getUserMedia');

  await capture.stop();
  assert.equal(store.rows('signal_windows').length, 0,
    'a refused turn must not leave a phantom voice window behind');
  assert.equal(capture.stats.errors, 0);

  console.log('  ✓ refused voice turn is discarded cleanly (no getUserMedia, no phantom window)');
}

// ── 9. stats: per-modality counts + window counts + drop count ────────────

async function testStatsAccurate() {
  const clocks = makeClocks();
  const doc = makeFakeDocument();
  const element = makeFakeElement(doc);
  const store = makeFakeStore();
  const timerFns = makePersistenceTimerFns();

  const capture = createSignalCapture({
    settings: { typing_enabled: true, ai_assist_enabled: true, discourse_enabled: true },
    now: clocks.now,
    monotonicNow: clocks.monotonicNow,
    store,
    persistenceOptions: { batchSize: 100, ...timerFns },
  });
  capture.start({ capture_id: 'cap-s', session_id: 'ses-s' });

  capture.typing.attach(element, {});
  typeChar(clocks, element, 'a');
  typeChar(clocks, element, 'b');
  capture.typing.submit(); // start + 2 inserts + submit = 4 typing events, 1 window
  capture.aiAssist.requested({ suggestion_id: 's' });
  capture.aiAssist.shown({ suggestion_id: 's' }); // 2 ai_assist events
  capture.discourse.analyze('One sentence. And a question?'); // 2 discourse events

  const live = capture.stats;
  assert.equal(live.active, true);
  assert.deepEqual(live.events, { typing: 4, ai_assist: 2, discourse: 2 });
  assert.deepEqual(live.windows, { typing: 1 });
  assert.equal(live.dropped_events, 0);

  await capture.stop(); // finalizes ai_assist + discourse windows

  const final = capture.stats;
  assert.equal(final.active, false);
  assert.deepEqual(final.events, { typing: 4, ai_assist: 2, discourse: 2 });
  assert.deepEqual(final.windows, { typing: 1, ai_assist: 1, discourse: 1 });
  assert.equal(final.persistence.written, 8);
  assert.equal(final.persistence.pending, 0);
  assert.equal(final.errors, 0);

  console.log('  ✓ stats report per-modality events, windows, drops, and persistence health');
}

// ── run ────────────────────────────────────────────────────────────────────

await testDisabledModalitiesConstructNothing();
await testSharedSequenceIndexAcrossModalities();
await testWindowsReachStoreAndTransport();
await testBatchedEventPersistence();
await testStopFinalizesEverythingAndTearsDown();
await testDisposeIdempotentAndPostStopEventsIgnored();
await testFailuresSurfaceNotSwallowed();
await testVoiceRefusalDiscardsTurn();
await testStatsAccurate();

console.log('signal-capture.test.js passed');
