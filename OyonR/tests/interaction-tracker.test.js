import assert from 'node:assert/strict';
import { createInteractionTracker, createElementAoiResolver } from '../src/capture/InteractionTracker.js';

/**
 * InteractionTracker tests fake the DOM by hand, same idiom as
 * `tests/typing-adapter.test.js`: an EventTarget-shaped `documentRef`/
 * `windowRef` we can inspect add/remove calls on and fire synthetic events
 * through, plus a fake timer queue standing in for `windowRef.setTimeout`/
 * `clearTimeout` (the tracker's idle timer and throttled `selectionchange`
 * flush both go through `windowRef`, not a separate injection point — see
 * the class doc in `src/capture/InteractionTracker.js`).
 */

function makeFakeTarget(label) {
  const addCalls = [];
  const removeCalls = [];
  const listeners = new Map(); // type -> Set(fn)
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
  };
}

/** Fake timer queue for `windowRef.setTimeout`/`clearTimeout` — same idiom as
 * `tests/typing-adapter.test.js`'s `makeFakeTimerQueue`, extended with
 * `flushByMs` since the idle timer (`idleThresholdMs`) and the selection
 * throttle timer (`selectionThrottleMs`) share this one queue and need to be
 * flushed independently by their distinct configured delays. */
function makeFakeTimerQueue() {
  const queue = [];
  let nextHandle = 1;
  return {
    setTimer(fn, ms) {
      const handle = nextHandle++;
      queue.push({ handle, fn, ms });
      return handle;
    },
    clearTimer(handle) {
      const index = queue.findIndex((entry) => entry.handle === handle);
      if (index >= 0) queue.splice(index, 1);
    },
    pending() { return queue.length; },
    pendingMs() { return queue.map((entry) => entry.ms); },
    flushOne() {
      const next = queue.shift();
      if (!next) throw new Error('fake timer queue: no pending timer to flush');
      next.fn();
    },
    flushByMs(ms) {
      const index = queue.findIndex((entry) => entry.ms === ms);
      if (index < 0) throw new Error(`fake timer queue: no pending timer with ms=${ms}`);
      const [entry] = queue.splice(index, 1);
      entry.fn();
    },
  };
}

function makeFakeDocument(overrides = {}) {
  const target = makeFakeTarget('document');
  return {
    ...target,
    hidden: false,
    visibilityState: 'visible',
    documentElement: { scrollHeight: 800 },
    getSelection: () => ({ toString: () => '' }),
    ...overrides,
  };
}

function makeFakeWindow(timerQueue, overrides = {}) {
  const target = makeFakeTarget('window');
  return {
    ...target,
    innerWidth: 1000,
    innerHeight: 800,
    scrollY: 0,
    setTimeout: timerQueue.setTimer,
    clearTimeout: timerQueue.clearTimer,
    ...overrides,
  };
}

let clock = 0;
function fakeNow() { return clock; }

// A — start() attaches listeners to exactly documentRef/windowRef; dispose()
// removes every one of them, matching add calls exactly (the teardown
// guarantee), including the idle timer scheduled at start().
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers);
  const tracker = createInteractionTracker({ documentRef: doc, windowRef: win, now: fakeNow });

  tracker.start();
  assert.equal(tracker.active, true);
  assert.equal(timers.pending(), 1, 'the idle timer is scheduled at start()');

  const expectedDocTypes = ['mousemove', 'click', 'dblclick', 'selectionchange', 'visibilitychange'];
  assert.deepEqual(doc.addCalls.map(([t]) => t).sort(), [...expectedDocTypes].sort());
  const expectedWinTypes = ['scroll', 'focus', 'blur'];
  assert.deepEqual(win.addCalls.map(([t]) => t).sort(), [...expectedWinTypes].sort());
  assert.equal(doc.removeCalls.length, 0);
  assert.equal(win.removeCalls.length, 0);

  tracker.dispose();
  assert.equal(tracker.active, false);
  assert.equal(timers.pending(), 0, 'dispose() cancels the pending idle timer');

  const key = ([type_, fn]) => `${type_}:${String(fn)}`;
  assert.deepEqual(
    doc.removeCalls.map(key).sort(),
    doc.addCalls.map(key).sort(),
    'document removeEventListener calls must match addEventListener calls exactly',
  );
  assert.deepEqual(
    win.removeCalls.map(key).sort(),
    win.addCalls.map(key).sort(),
    'window removeEventListener calls must match addEventListener calls exactly',
  );
}

// B — start() twice does not double-attach; dispose() is idempotent and
// events after dispose are ignored.
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers);
  const events = [];
  const tracker = createInteractionTracker({ documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow });

  tracker.start();
  const firstAddCount = doc.addCalls.length + win.addCalls.length;
  tracker.start();
  assert.equal(doc.addCalls.length + win.addCalls.length, firstAddCount, 'second start() must not add more listeners');

  doc.fire('click', { clientX: 1, clientY: 1, button: 0 });
  assert.equal(events.length, 1);

  tracker.dispose();
  const removeCountAfterFirst = doc.removeCalls.length + win.removeCalls.length;
  tracker.dispose(); // idempotent — safe to call twice.
  assert.equal(doc.removeCalls.length + win.removeCalls.length, removeCountAfterFirst, 'second dispose() adds no more removeEventListener calls');

  doc.fire('click', { clientX: 2, clientY: 2, button: 0 });
  assert.equal(events.length, 1, 'no event fires after dispose()');

  // stop() after dispose() is also a safe no-op.
  tracker.stop();
  assert.equal(events.length, 1);
}

// C — pointer sampling: 50 moves fed within one pointerSampleMs interval
// (the clock does not advance) must emit exactly ONE pointer_move, carrying
// normalized [0, 1] coordinates. Advancing the clock past pointerSampleMs
// lets the next move emit a second sample.
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers, { innerWidth: 1000, innerHeight: 800 });
  const events = [];
  clock = 0;
  const tracker = createInteractionTracker({
    documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow, pointerSampleMs: 100,
  });
  tracker.start();

  for (let i = 0; i < 50; i += 1) {
    doc.fire('mousemove', { clientX: 100 + i, clientY: 200 });
  }
  let moves = events.filter((e) => e.state === 'pointer_move');
  assert.equal(moves.length, 1, '50 moves within one sample interval -> exactly one pointer_move');
  assert.deepEqual(moves[0].detail, { x: 100 / 1000, y: 200 / 800, aoi: null });

  clock = 150; // past pointerSampleMs (100) since the last emitted sample.
  doc.fire('mousemove', { clientX: 300, clientY: 200 });
  moves = events.filter((e) => e.state === 'pointer_move');
  assert.equal(moves.length, 2, 'a move after the throttle window elapses emits a second sample');
  assert.deepEqual(moves[1].detail, { x: 0.3, y: 0.25, aoi: null });

  tracker.dispose();
}

// D — idle: no movement for idleThresholdMs emits exactly one pointer_idle,
// not repeatedly; movement resumes idle tracking for a NEW stretch.
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers);
  const events = [];
  clock = 0;
  const tracker = createInteractionTracker({
    documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow, idleThresholdMs: 1500,
  });
  tracker.start();
  assert.equal(timers.pending(), 1);

  timers.flushByMs(1500);
  assert.equal(events.filter((e) => e.state === 'pointer_idle').length, 1);
  assert.equal(timers.pending(), 0, 'the idle timer is NOT rescheduled after firing — no repeat within the same stretch');

  // A subsequent movement resets the idle clock for a new stretch.
  doc.fire('mousemove', { clientX: 10, clientY: 10 });
  assert.equal(timers.pending(), 1, 'movement reschedules the idle timer');
  timers.flushByMs(1500);
  assert.equal(events.filter((e) => e.state === 'pointer_idle').length, 2, 'a new idle stretch after movement fires again');

  tracker.dispose();
}

// E — scroll coalescing: emits only once cumulative scroll since the last
// emitted event exceeds scrollThresholdPx, and the baseline resets on each
// emission (net displacement, not total path length).
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument({ documentElement: { scrollHeight: 2000 } });
  const win = makeFakeWindow(timers, { innerHeight: 800, scrollY: 0 });
  const events = [];
  const tracker = createInteractionTracker({
    documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow, scrollThresholdPx: 40,
  });
  tracker.start();
  const scrolls = () => events.filter((e) => e.state === 'scroll_down' || e.state === 'scroll_up');

  win.scrollY = 20;
  win.fire('scroll', {});
  assert.equal(scrolls().length, 0, 'below threshold: no emission');

  win.scrollY = 50; // delta from baseline 0 -> 50 >= 40.
  win.fire('scroll', {});
  assert.equal(scrolls().length, 1);
  assert.equal(scrolls()[0].state, 'scroll_down');
  assert.equal(scrolls()[0].detail.delta_px, 50);
  assert.ok(Math.abs(scrolls()[0].detail.depth_ratio - (50 / 1200)) < 1e-9, 'depth_ratio = scrollY / (scrollHeight - innerHeight)');

  win.scrollY = 20; // net -30 from the new baseline (50) -> below threshold.
  win.fire('scroll', {});
  assert.equal(scrolls().length, 1, 'net displacement below threshold stays silent');

  win.scrollY = 5; // net -45 from baseline (50) -> exceeds threshold.
  win.fire('scroll', {});
  assert.equal(scrolls().length, 2);
  assert.equal(scrolls()[1].state, 'scroll_up');
  assert.equal(scrolls()[1].detail.delta_px, 45);

  tracker.dispose();
}

// F — select_text: throttled trailing-edge (a drag coalesces to one flush),
// carries LENGTH only (never the text), and nothing is emitted for a
// collapsed/empty selection.
{
  const timers = makeFakeTimerQueue();
  let selectionText = '';
  const doc = makeFakeDocument({ getSelection: () => ({ toString: () => selectionText }) });
  const win = makeFakeWindow(timers);
  const events = [];
  const tracker = createInteractionTracker({
    documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow, selectionThrottleMs: 200,
  });
  tracker.start();

  selectionText = 'hello world'; // 11 characters
  doc.fire('selectionchange', {});
  doc.fire('selectionchange', {}); // simulates a drag — must coalesce to ONE scheduled flush.
  doc.fire('selectionchange', {});
  assert.equal(timers.pendingMs().filter((ms) => ms === 200).length, 1, 'a drag schedules exactly one trailing-edge flush');

  timers.flushByMs(200);
  const selections = events.filter((e) => e.state === 'select_text');
  assert.equal(selections.length, 1);
  assert.deepEqual(selections[0].detail, { length: 11 });
  assert.deepEqual(Object.keys(selections[0].detail), ['length'], 'detail carries ONLY length, never the text');

  selectionText = '';
  doc.fire('selectionchange', {});
  timers.flushByMs(200);
  assert.equal(events.filter((e) => e.state === 'select_text').length, 1, 'a collapsed/empty selection emits nothing');

  tracker.dispose();
}

// G — focus_gain/focus_loss (windowRef focus/blur) and tab_hidden/tab_visible
// (documentRef visibilitychange) are reported as distinct, faithful passthroughs.
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers);
  const events = [];
  const tracker = createInteractionTracker({ documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow });
  tracker.start();

  win.fire('blur', {});
  win.fire('focus', {});
  assert.deepEqual(
    events.filter((e) => e.state === 'focus_loss' || e.state === 'focus_gain').map((e) => e.state),
    ['focus_loss', 'focus_gain'],
  );

  doc.hidden = true;
  doc.visibilityState = 'hidden';
  doc.fire('visibilitychange', {});
  doc.hidden = false;
  doc.visibilityState = 'visible';
  doc.fire('visibilitychange', {});
  assert.deepEqual(
    events.filter((e) => e.state === 'tab_hidden' || e.state === 'tab_visible').map((e) => e.state),
    ['tab_hidden', 'tab_visible'],
  );

  tracker.dispose();
}

// H — click / double_click carry { x, y, aoi, button } in normalized coordinates.
{
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers, { innerWidth: 1000, innerHeight: 800 });
  const events = [];
  const tracker = createInteractionTracker({ documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow });
  tracker.start();

  doc.fire('click', { clientX: 500, clientY: 400, button: 0 });
  doc.fire('dblclick', { clientX: 500, clientY: 400, button: 0 });
  doc.fire('click', { clientX: 900, clientY: 720, button: 2 });

  const click = events.find((e) => e.state === 'click');
  const dbl = events.find((e) => e.state === 'double_click');
  assert.deepEqual(click.detail, { x: 0.5, y: 0.5, aoi: null, button: 0 });
  assert.deepEqual(dbl.detail, { x: 0.5, y: 0.5, aoi: null, button: 0 });
  const rightClick = events.filter((e) => e.state === 'click')[1];
  assert.deepEqual(rightClick.detail, { x: 0.9, y: 0.9, aoi: null, button: 2 });

  tracker.dispose();
}

// I — createElementAoiResolver: a point inside an element's (region/minSize-
// adjusted) gaze AOI resolves to its id; a point far outside resolves to
// null. Uses the same fixture shape as tests/dom-aoi.test.js's `chat_panel`
// case (element centered in a 1000x800 viewport), hand-verified there.
{
  const fakeWindow = {
    innerWidth: 1000,
    innerHeight: 800,
    screenX: 0,
    screenY: 0,
    outerWidth: 1000,
    outerHeight: 800,
    screen: { width: 1000, height: 800 },
  };
  const element = {
    ownerDocument: { defaultView: fakeWindow },
    getBoundingClientRect: () => ({ left: 400, top: 300, width: 200, height: 200 }),
  };
  const resolver = createElementAoiResolver([{ id: 'chat_panel', element }]);

  // Element rect center = (500, 400) — the element's own AOI is centered at
  // gaze-space (0, 0) (verified in tests/dom-aoi.test.js), so the viewport
  // pixel point (500, 400) maps to gaze-space (0, 0) too and must resolve.
  assert.equal(resolver(500, 400), 'chat_panel', 'a point inside the element resolves to its id');
  // Top-left corner of the viewport maps to gaze-space (-0.5, -0.5), well
  // outside the element's AOI.
  assert.equal(resolver(0, 0), null, 'a point far outside the element resolves to null');
  assert.equal(resolver(Number.NaN, 0), null, 'a non-finite point resolves to null, never throws');

  // Wired end-to-end through the tracker: pointer_move and click both
  // resolve through the SAME resolver, to the SAME AOI id.
  const timers = makeFakeTimerQueue();
  const doc = makeFakeDocument();
  const win = makeFakeWindow(timers, { innerWidth: 1000, innerHeight: 800 });
  const events = [];
  const tracker = createInteractionTracker({
    documentRef: doc, windowRef: win, onEvent: (e) => events.push(e), now: fakeNow, aoiResolver: resolver,
  });
  tracker.start();
  doc.fire('mousemove', { clientX: 500, clientY: 400 });
  doc.fire('click', { clientX: 500, clientY: 400, button: 0 });
  doc.fire('click', { clientX: 0, clientY: 0, button: 0 });

  const move = events.find((e) => e.state === 'pointer_move');
  const clickInside = events.filter((e) => e.state === 'click')[0];
  const clickOutside = events.filter((e) => e.state === 'click')[1];
  assert.equal(move.detail.aoi, 'chat_panel');
  assert.equal(clickInside.detail.aoi, 'chat_panel');
  assert.equal(clickOutside.detail.aoi, null);

  tracker.dispose();
}

// J — documentRef/windowRef are required.
{
  assert.throws(() => createInteractionTracker({ windowRef: makeFakeWindow(makeFakeTimerQueue()) }), /documentRef is required/);
  assert.throws(() => createInteractionTracker({ documentRef: makeFakeDocument() }), /windowRef is required/);
}

console.log('interaction-tracker.test.js passed');
