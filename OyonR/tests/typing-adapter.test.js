import assert from 'node:assert/strict';
import { createTypingComposerAdapter } from '../src/capture/TypingComposerAdapter.js';

/**
 * TypingComposerAdapter tests fake the DOM by hand rather than pulling in a
 * DOM library — same idiom as `tests/gaze-calibration-overlay.test.js` (which
 * fakes a timer queue directly). Here we fake an EventTarget-shaped element
 * (`addEventListener`/`removeEventListener` bookkeeping we can inspect) plus
 * a minimal document for `visibilitychange`, and a recording fake aggregator.
 * The adapter's whole job is translating DOM events into aggregator calls, so
 * asserting on the recorded calls is the real test — not a headless browser.
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

function makeFakeElement(doc) {
  const target = makeFakeTarget('element');
  return {
    ...target,
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    ownerDocument: doc,
  };
}

/**
 * Fake timer queue for `setTimerFn`/`clearTimerFn` — same idiom as
 * `GazeCalibrationDriver`'s injectable `setTimer`/`clearTimer` (see
 * tests/gaze-calibration-overlay.test.js), used here to drive the
 * `selectionchange` trailing-edge throttle deterministically instead of
 * sleeping in a real timer.
 */
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
    /** Fire the next pending timer (FIFO). */
    flushOne() {
      const next = queue.shift();
      if (!next) throw new Error('fake timer queue: no pending timer to flush');
      next.fn();
    },
    pending() { return queue.length; },
  };
}

function makeFakeAggregator() {
  return {
    calls: { start: [], record: [], finalize: [] },
    finalizeResult: { window: true },
    start(args) { this.calls.start.push(args); },
    record(args) { this.calls.record.push(args); },
    finalize(args) {
      this.calls.finalize.push(args);
      return this.finalizeResult;
    },
  };
}

/** Simulate one native `beforeinput` + `input` pair for a plain typing edit. */
function type(element, { inputType, newValue }) {
  element.fire('beforeinput', { inputType });
  element.value = newValue;
  element.fire('input', {});
}

let clock = 0;
function fakeNow() {
  clock += 1;
  return clock;
}

// A — start() attaches listeners on element + document; dispose() removes
// every one of them, matching add calls exactly (the teardown guarantee).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  assert.equal(adapter.active, true);
  assert.equal(aggregator.calls.start.length, 1);
  assert.deepEqual(aggregator.calls.start[0], { timestamp: 1, targetKind: 'chat_composer', targetId: null });

  const expectedElementTypes = ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'];
  assert.deepEqual(element.addCalls.map(([t]) => t).sort(), [...expectedElementTypes].sort());
  assert.deepEqual(doc.addCalls.map(([t]) => t).sort(), ['selectionchange', 'visibilitychange']);
  assert.equal(element.removeCalls.length, 0);
  assert.equal(doc.removeCalls.length, 0);

  adapter.dispose();
  assert.equal(adapter.active, false);
  assert.equal(aggregator.calls.finalize.length, 0, 'dispose must not finalize');

  // Every add call is undone by exactly one matching remove call.
  const key = ([type_, fn]) => `${type_}:${String(fn)}`;
  assert.deepEqual(
    element.removeCalls.map(key).sort(),
    element.addCalls.map(key).sort(),
    'element removeEventListener calls must match addEventListener calls exactly',
  );
  assert.deepEqual(
    doc.removeCalls.map(key).sort(),
    doc.addCalls.map(key).sort(),
    'document removeEventListener calls must match addEventListener calls exactly',
  );

  // No listener ever touched anything other than the element and the document.
  assert.ok(expectedElementTypes.every((t) => element.addCalls.some(([type_]) => type_ === t)));
}

// B — no listener is ever added anywhere but the element and documentRef,
// even when the host's document differs from the element's ownerDocument.
{
  const ownerDoc = makeFakeTarget('owner-document');
  const otherDoc = makeFakeTarget('other-document');
  const element = makeFakeElement(ownerDoc);
  const aggregator = makeFakeAggregator();
  // Explicitly pass a documentRef distinct from element.ownerDocument.
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: otherDoc });

  adapter.start();
  assert.equal(ownerDoc.addCalls.length, 0, 'ownerDocument must not be touched when documentRef is given explicitly');
  assert.equal(otherDoc.addCalls.length, 2);
  assert.deepEqual(otherDoc.addCalls.map(([t]) => t).sort(), ['selectionchange', 'visibilitychange']);
  adapter.dispose();
}

// C — start() twice does not double-attach.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  const firstAddCount = element.addCalls.length;
  adapter.start();
  assert.equal(element.addCalls.length, firstAddCount, 'second start() must not add more listeners');
  assert.equal(aggregator.calls.start.length, 1, 'second start() must not call aggregator.start again');

  adapter.dispose();
  assert.equal(element.removeCalls.length, firstAddCount, 'dispose removes exactly the listeners actually added');
}

// D — typing text produces record() calls with correct previous/current
// grapheme counts, using the real Intl.Segmenter (available in Node).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  assert.equal(adapter.graphemeMode, 'intl-segmenter');

  adapter.start();
  type(element, { inputType: 'insertText', newValue: 'a' });
  type(element, { inputType: 'insertText', newValue: 'ab' });
  type(element, { inputType: 'insertText', newValue: 'abc' });

  assert.equal(aggregator.calls.record.length, 3);
  assert.deepEqual(
    aggregator.calls.record.map((r) => [r.previousGraphemes, r.currentGraphemes]),
    [[0, 1], [1, 2], [2, 3]],
  );
  assert.equal(aggregator.calls.record[0].inputType, 'insertText');
  assert.equal(aggregator.calls.record[0].compositionState, 'none');
  assert.equal(aggregator.calls.record[0].replacedSelection, false);
  adapter.dispose();
}

// E — emoji and a combining sequence count as ONE grapheme each.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  assert.equal(adapter.graphemeMode, 'intl-segmenter');

  adapter.start();
  // Family emoji (multiple code points, one visual cluster via ZWJ).
  const familyEmoji = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // man+ZWJ+woman+ZWJ+girl
  type(element, { inputType: 'insertText', newValue: familyEmoji });
  assert.equal(aggregator.calls.record[0].currentGraphemes, 1, 'family emoji is one grapheme');
  assert.ok([...familyEmoji].length > 1, 'sanity: more than one code point');

  // Combining sequence: 'e' + combining acute accent (U+0301) = one cluster.
  const combining = familyEmoji + 'é';
  type(element, { inputType: 'insertText', newValue: combining });
  assert.equal(aggregator.calls.record[1].currentGraphemes, 2, 'combining e+accent adds exactly one grapheme');
  adapter.dispose();
}

// F — a selection replacement sets replacedSelection true.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  element.value = 'hello world';
  element.selectionStart = 0;
  element.selectionEnd = 5; // "hello" selected
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'HI world';
  element.selectionStart = 2;
  element.selectionEnd = 2;
  element.fire('input', {});

  assert.equal(aggregator.calls.record[0].replacedSelection, true);

  // A plain caret edit (no selection) must report false.
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'HI worldX';
  element.fire('input', {});
  assert.equal(aggregator.calls.record[1].replacedSelection, false);
  adapter.dispose();
}

// G — an IME sequence passes the right compositionState values through.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  element.fire('compositionstart', {});
  element.fire('beforeinput', { inputType: 'insertCompositionText' });
  element.value = 'あ'; // "あ"
  element.fire('input', {});
  assert.equal(aggregator.calls.record[0].compositionState, 'start');

  element.fire('compositionupdate', {});
  element.fire('beforeinput', { inputType: 'insertCompositionText' });
  element.value = 'あい'; // "あい"
  element.fire('input', {});
  assert.equal(aggregator.calls.record[1].compositionState, 'update');

  element.fire('compositionend', {});
  element.fire('beforeinput', { inputType: 'insertCompositionText' });
  element.value = '愛'; // committed "愛"
  element.fire('input', {});
  assert.equal(aggregator.calls.record[2].compositionState, 'end');

  // Subsequent plain typing after composition ends reverts to 'none'.
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = '愛X';
  element.fire('input', {});
  assert.equal(aggregator.calls.record[3].compositionState, 'none');
  adapter.dispose();
}

// H — submit() finalizes with 'submitted' and calls onWindow; detaches listeners.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const windows = [];
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc, onWindow: (w) => windows.push(w),
  });

  adapter.start();
  const result = adapter.submit();
  assert.equal(aggregator.calls.finalize.length, 1);
  assert.equal(aggregator.calls.finalize[0].reason, 'submitted');
  assert.equal(result, aggregator.finalizeResult);
  assert.deepEqual(windows, [aggregator.finalizeResult]);
  assert.equal(adapter.active, false);
  assert.deepEqual(
    element.removeCalls.map(([t]) => t).sort(),
    element.addCalls.map(([t]) => t).sort(),
    'submit() must detach every listener it attached',
  );
}

// H2 — regression (finding 10): a THROWING onWindow must not prevent
// teardown — the add/remove listener symmetry holds even when the host
// misbehaves, and the throw still reaches the submit() caller.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    onWindow() { throw new Error('sink failed'); },
  });

  adapter.start();
  assert.throws(() => adapter.submit(), /sink failed/,
    'the host\'s error propagates — but only after teardown completed');
  assert.equal(adapter.active, false);
  assert.equal(element.removeCalls.length, element.addCalls.length,
    'every element listener detached despite the throwing callback');
  assert.deepEqual(
    element.removeCalls.map(([t]) => t).sort(),
    element.addCalls.map(([t]) => t).sort(),
  );
  assert.equal(doc.removeCalls.length, doc.addCalls.length,
    'every document listener detached despite the throwing callback');
  // Nothing keeps recording after the failed submit.
  type(element, { inputType: 'insertText', newValue: 'x' });
  assert.equal(aggregator.calls.record.length, 0, 'no record() after a throwing submit()');
  // dispose() afterwards stays safe and adds no asymmetric removes.
  const removesBefore = element.removeCalls.length;
  adapter.dispose();
  assert.equal(element.removeCalls.length, removesBefore);
}

// I — abandon() finalizes with 'abandoned'.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const windows = [];
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc, onWindow: (w) => windows.push(w),
  });

  adapter.start();
  adapter.abandon();
  assert.equal(aggregator.calls.finalize.length, 1);
  assert.equal(aggregator.calls.finalize[0].reason, 'abandoned');
  assert.deepEqual(windows, [aggregator.finalizeResult]);
  assert.equal(adapter.active, false);
}

// J — onWindow is not called when finalize() returns null (nothing to report).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  aggregator.finalizeResult = null;
  const windows = [];
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc, onWindow: (w) => windows.push(w),
  });

  adapter.start();
  const result = adapter.abandon();
  assert.equal(result, null);
  assert.deepEqual(windows, [], 'onWindow must not be called for a null window');
}

// K — dispose() does NOT finalize; double dispose is safe; events after
// dispose/submit/abandon are ignored.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  type(element, { inputType: 'insertText', newValue: 'x' });
  assert.equal(aggregator.calls.record.length, 1);

  adapter.dispose();
  assert.equal(aggregator.calls.finalize.length, 0, 'dispose must not finalize');
  assert.equal(adapter.active, false);

  // Double dispose is safe (no throw, no duplicate remove calls).
  const removeCountAfterFirstDispose = element.removeCalls.length;
  adapter.dispose();
  assert.equal(element.removeCalls.length, removeCountAfterFirstDispose, 'second dispose() adds no more removeEventListener calls');

  // Events dispatched after dispose are ignored (listeners are gone anyway,
  // but the internal `active` guard is the real safety net here — fire()
  // would be a no-op since the listener set is now empty).
  element.fire('input', {});
  assert.equal(aggregator.calls.record.length, 1, 'no record() after dispose');

  // submit()/abandon() after dispose are no-ops (already inactive).
  assert.equal(adapter.submit(), null);
  assert.equal(adapter.abandon(), null);
  assert.equal(aggregator.calls.finalize.length, 0);
}

// L — events after submit() are ignored even if something still holds a
// reference to the element's fire() helper.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  adapter.submit();
  assert.equal(aggregator.calls.record.length, 0);
  // Listeners were detached by submit(), so this fire() finds nothing to call.
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'late';
  element.fire('input', {});
  assert.equal(aggregator.calls.record.length, 0, 'events after submit() must not reach the aggregator');
}

// ==================== typing-v2: caret/selection plumbing + selectionchange ====================

// M — onInput() reads element.selectionStart/selectionEnd and passes them
// through to aggregator.record() as caretOffset/selectionLength.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  element.value = 'ab';
  element.selectionStart = 2;
  element.selectionEnd = 2;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.fire('input', {});
  assert.equal(aggregator.calls.record[0].caretOffset, 2);
  assert.equal(aggregator.calls.record[0].selectionLength, 0, 'collapsed caret -> selectionLength 0');

  element.value = 'abcdef';
  element.selectionStart = 2;
  element.selectionEnd = 6; // e.g. autocomplete left a trailing selection
  element.fire('beforeinput', { inputType: 'insertText' });
  element.fire('input', {});
  assert.equal(aggregator.calls.record[1].caretOffset, 2);
  assert.equal(aggregator.calls.record[1].selectionLength, 4);
  adapter.dispose();
}

// N — selectionchange (throttled, trailing edge) reports the SETTLED
// selection, filtered to the tracked element, as select/deselect signal.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const timer = makeFakeTimerQueue();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: timer.setTimer, clearTimerFn: timer.clearTimer,
  });

  adapter.start();
  doc.activeElement = element;

  // Drag-select: three intermediate firings while the selection grows —
  // must coalesce into exactly ONE flush (trailing edge).
  element.selectionStart = 0; element.selectionEnd = 2; doc.fire('selectionchange', {});
  element.selectionStart = 0; element.selectionEnd = 5; doc.fire('selectionchange', {});
  element.selectionStart = 0; element.selectionEnd = 9; doc.fire('selectionchange', {});
  assert.equal(timer.pending(), 1, 'a drag schedules exactly one trailing-edge flush, not one per firing');
  assert.equal(aggregator.calls.record.length, 0, 'nothing recorded until the throttle settles');

  timer.flushOne();
  assert.equal(aggregator.calls.record.length, 1);
  assert.equal(aggregator.calls.record[0].caretOffset, 0);
  assert.equal(aggregator.calls.record[0].selectionLength, 9, 'reports the settled selection, not any intermediate one');
  assert.equal(aggregator.calls.record[0].compositionState, 'none');
  assert.equal(aggregator.calls.record[0].replacedSelection, false);

  // Selection collapses -> another firing, another flush.
  element.selectionStart = 12; element.selectionEnd = 12;
  doc.fire('selectionchange', {});
  timer.flushOne();
  assert.equal(aggregator.calls.record.length, 2);
  assert.equal(aggregator.calls.record[1].caretOffset, 12);
  assert.equal(aggregator.calls.record[1].selectionLength, 0);

  adapter.dispose();
}

// O — selectionchange on any element OTHER than the tracked one is ignored
// entirely (never even schedules a flush) — this is what keeps the adapter
// from reading selection state that belongs to some unrelated field.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const timer = makeFakeTimerQueue();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: timer.setTimer, clearTimerFn: timer.clearTimer,
  });

  adapter.start();
  doc.activeElement = { some: 'other field' };
  element.selectionStart = 1;
  element.selectionEnd = 4;
  doc.fire('selectionchange', {});
  assert.equal(timer.pending(), 0, 'selectionchange while a different element is focused must not schedule a flush');
  adapter.dispose();
}

// P — a selectionchange that merely repeats what the most recent edit
// already reported (every edit moves the caret) must not fire a spurious
// move/select/deselect record() call.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const timer = makeFakeTimerQueue();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: timer.setTimer, clearTimerFn: timer.clearTimer,
  });

  adapter.start();
  doc.activeElement = element;

  element.value = 'a';
  element.selectionStart = 1;
  element.selectionEnd = 1;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.fire('input', {});
  assert.equal(aggregator.calls.record.length, 1, 'the edit itself recorded');

  // A browser fires selectionchange for the caret move the edit itself
  // caused — same position the edit already reported.
  doc.fire('selectionchange', {});
  timer.flushOne();
  assert.equal(aggregator.calls.record.length, 1, 'no duplicate record() for a selectionchange matching the last-reported position');

  adapter.dispose();
}

// Q — selectionChangeThrottleMs is honored, and the shipped default is 200ms.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const recordedDelays = [];
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    selectionChangeThrottleMs: 50,
    setTimerFn: (fn, ms) => { recordedDelays.push(ms); return 1; },
    clearTimerFn: () => {},
  });
  adapter.start();
  doc.activeElement = element;
  element.selectionStart = 0; element.selectionEnd = 3;
  doc.fire('selectionchange', {});
  assert.deepEqual(recordedDelays, [50], 'selectionChangeThrottleMs option is honored');
  adapter.dispose();
}
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const recordedDelays = [];
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: (fn, ms) => { recordedDelays.push(ms); return 1; },
    clearTimerFn: () => {},
  });
  adapter.start();
  doc.activeElement = element;
  element.selectionStart = 0; element.selectionEnd = 1;
  doc.fire('selectionchange', {});
  assert.deepEqual(recordedDelays, [200], 'default selectionChangeThrottleMs is 200ms');
  adapter.dispose();
}

// R — dispose() cancels a pending (not-yet-flushed) selectionchange timer.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const timer = makeFakeTimerQueue();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: timer.setTimer, clearTimerFn: timer.clearTimer,
  });
  adapter.start();
  doc.activeElement = element;
  element.selectionStart = 0; element.selectionEnd = 3;
  doc.fire('selectionchange', {});
  assert.equal(timer.pending(), 1);
  adapter.dispose();
  assert.equal(timer.pending(), 0, 'dispose() cancels a pending selectionchange flush timer');
}

// S — submit()/abandon() also cancel a pending selectionchange timer (not
// just dispose()), same as they detach every other listener.
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const timer = makeFakeTimerQueue();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc,
    setTimerFn: timer.setTimer, clearTimerFn: timer.clearTimer,
  });
  adapter.start();
  doc.activeElement = element;
  element.selectionStart = 0; element.selectionEnd = 3;
  doc.fire('selectionchange', {});
  assert.equal(timer.pending(), 1);
  adapter.submit();
  assert.equal(timer.pending(), 0, 'submit() cancels a pending selectionchange flush timer');
}

// T — teardown symmetry still holds exactly with the new listener included
// (element listeners unchanged; document gains selectionchange alongside
// visibilitychange, and every add is undone by exactly one matching remove).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  assert.deepEqual(doc.addCalls.map(([t]) => t).sort(), ['selectionchange', 'visibilitychange']);
  adapter.dispose();

  const key = ([type_, fn]) => `${type_}:${String(fn)}`;
  assert.deepEqual(
    doc.removeCalls.map(key).sort(),
    doc.addCalls.map(key).sort(),
    'document removeEventListener calls must match addEventListener calls exactly, including selectionchange',
  );
  assert.deepEqual(
    element.removeCalls.map(key).sort(),
    element.addCalls.map(key).sort(),
  );
}

// ==================== typing-v3: word counts + boundary context + wallTimestamp ====================

// U — word counts for plain English, using the real Intl.Segmenter available
// in Node (mirrors test D's grapheme assertions, but for words).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  assert.equal(adapter.wordMode, 'intl-segmenter');

  adapter.start();
  type(element, { inputType: 'insertText', newValue: 'hello' });
  type(element, { inputType: 'insertText', newValue: 'hello world' });
  type(element, { inputType: 'insertText', newValue: 'hello world, how are you?' });

  assert.deepEqual(
    aggregator.calls.record.map((r) => [r.previousWords, r.currentWords]),
    [[0, 1], [1, 2], [2, 5]],
    '"hello world, how are you?" is 5 words: punctuation is not word-like',
  );
  adapter.dispose();
}

// V — Intl.Segmenter word mode counts CJK text with NO spaces correctly,
// which a whitespace split cannot do at all. "私は学生です" (Japanese, "I am
// a student") segments into exactly 4 word-like tokens: 私 / は / 学生 / です
// (verified directly against Intl.Segmenter — this is a real, not assumed,
// expected number).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  assert.equal(adapter.wordMode, 'intl-segmenter');

  adapter.start();
  type(element, { inputType: 'insertText', newValue: '私は学生です' });
  assert.equal(aggregator.calls.record[0].currentWords, 4, 'CJK text with no spaces: 4 word-like segments');
  adapter.dispose();
}

// W — whitespace-fallback word counting path, forced via `wordSegmenter: false`
// (see the option's doc comment — this is how the fallback is exercised
// deterministically in Node, which always has a real Intl.Segmenter).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc, wordSegmenter: false,
  });
  assert.equal(adapter.wordMode, 'whitespace-fallback');

  adapter.start();
  type(element, { inputType: 'insertText', newValue: 'hello world' });
  assert.equal(aggregator.calls.record[0].currentWords, 2, 'plain whitespace split: 2 words');

  type(element, { inputType: 'insertText', newValue: "hello world, don't stop" });
  assert.equal(
    aggregator.calls.record[1].currentWords, 4,
    'fallback splits on whitespace/punctuation but keeps an internal apostrophe: hello / world / don\'t / stop',
  );
  adapter.dispose();
}

// X — boundaryContext: all four classifications, from hand-constructed caret
// positions (value + selectionStart set directly, mirroring tests F/M).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  adapter.start();

  // mid_word: caret between 'e' and 'l' in "hello" — word characters both sides.
  element.value = 'hello';
  element.selectionStart = 2;
  element.selectionEnd = 2;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'heXllo';
  element.selectionStart = 3;
  element.selectionEnd = 3;
  element.fire('input', {});
  assert.equal(aggregator.calls.record[0].boundaryContext, 'mid_word');

  // word_boundary: caret right after the space in "hello world" — the
  // character immediately before the caret is the space itself.
  element.value = 'hello world';
  element.selectionStart = 6;
  element.selectionEnd = 6;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'hello Xworld';
  element.selectionStart = 7;
  element.selectionEnd = 7;
  element.fire('input', {});
  assert.equal(aggregator.calls.record[1].boundaryContext, 'word_boundary');

  // sentence_boundary: caret after ". " — sentence-ending punctuation plus
  // the trailing whitespace the classifier is documented to tolerate.
  element.value = 'Done. ';
  element.selectionStart = 6;
  element.selectionEnd = 6;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'Done. Next';
  element.selectionStart = 7;
  element.selectionEnd = 7;
  element.fire('input', {});
  assert.equal(aggregator.calls.record[2].boundaryContext, 'sentence_boundary');

  // paragraph_boundary: caret right after a newline.
  element.value = 'Line one.\n';
  element.selectionStart = 10;
  element.selectionEnd = 10;
  element.fire('beforeinput', { inputType: 'insertText' });
  element.value = 'Line one.\nLine two';
  element.selectionStart = 11;
  element.selectionEnd = 11;
  element.fire('input', {});
  assert.equal(aggregator.calls.record[3].boundaryContext, 'paragraph_boundary');

  adapter.dispose();
}

// Y — boundary classification is taken at `beforeinput`, not `input`: by the
// time `input` fires the caret has already moved past the edit, and reading
// it THEN would misclassify this sentence-boundary edit as `word_boundary`
// (this is exactly the failure mode `beforeinput` timing avoids).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  adapter.start();

  element.value = 'Hello. ';
  element.selectionStart = 7;
  element.selectionEnd = 7;
  element.fire('beforeinput', { inputType: 'insertText' });
  // Post-edit: the caret has moved past the freshly inserted 'W', which sits
  // between two word characters were it read now — this is `word_boundary`
  // if (wrongly) evaluated at `input` time. Sanity-checked directly against
  // the classifier below.
  element.value = 'Hello. W';
  element.selectionStart = 8;
  element.selectionEnd = 8;
  element.fire('input', {});

  assert.equal(
    aggregator.calls.record[0].boundaryContext, 'sentence_boundary',
    'boundaryContext must reflect the pre-edit (beforeinput) caret position, not the post-edit one',
  );
  adapter.dispose();
}

// Z — wallTimestamp is present, numeric, and plausible: close to the real
// `Date.now()` at record time (the adapter's default `wallClockNow`).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });
  adapter.start();

  const before = Date.now();
  type(element, { inputType: 'insertText', newValue: 'a' });
  const after = Date.now();

  const wallTimestamp = aggregator.calls.record[0].wallTimestamp;
  assert.equal(typeof wallTimestamp, 'number');
  assert.ok(
    wallTimestamp >= before - 5 && wallTimestamp <= after + 5,
    'wallTimestamp must be a real wall-clock reading taken at record() time',
  );
  adapter.dispose();
}

// AA — `wallClockNow` is injectable (mirrors `now`/`setTimerFn`) so a host or
// test can make wallTimestamp deterministic instead of the real Date.now().
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({
    element, aggregator, now: fakeNow, documentRef: doc, wallClockNow: () => 1784900000000,
  });
  adapter.start();
  type(element, { inputType: 'insertText', newValue: 'a' });
  assert.equal(aggregator.calls.record[0].wallTimestamp, 1784900000000);
  adapter.dispose();
}

// AB — teardown symmetry STILL holds exactly with all typing-v3 enrichment
// wired in — no new listener was added anywhere (word/boundary/wallTimestamp
// enrichment is computed synchronously off the existing beforeinput/input
// pair, not a new DOM event).
{
  const doc = makeFakeTarget('document');
  const element = makeFakeElement(doc);
  const aggregator = makeFakeAggregator();
  const adapter = createTypingComposerAdapter({ element, aggregator, now: fakeNow, documentRef: doc });

  adapter.start();
  const expectedElementTypes = ['beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'];
  assert.deepEqual(element.addCalls.map(([t]) => t).sort(), [...expectedElementTypes].sort());
  assert.deepEqual(doc.addCalls.map(([t]) => t).sort(), ['selectionchange', 'visibilitychange']);

  type(element, { inputType: 'insertText', newValue: 'hi' });
  adapter.dispose();

  const key = ([type_, fn]) => `${type_}:${String(fn)}`;
  assert.deepEqual(
    element.removeCalls.map(key).sort(),
    element.addCalls.map(key).sort(),
    'element removeEventListener calls must match addEventListener calls exactly',
  );
  assert.deepEqual(
    doc.removeCalls.map(key).sort(),
    doc.addCalls.map(key).sort(),
    'document removeEventListener calls must match addEventListener calls exactly',
  );
}

console.log('typing-adapter tests passed');
