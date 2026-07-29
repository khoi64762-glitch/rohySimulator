import assert from 'node:assert/strict';
import { TypingAggregator } from '../src/aggregation/TypingAggregator.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';

// ---------- A. Simple insert-only episode ----------
{
  const agg = new TypingAggregator({ now: () => 1000 });
  agg.start({ timestamp: 0, targetKind: 'chat_composer', targetId: 'abc' });

  agg.record({ timestamp: 200, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 3, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 500, inputType: 'insertText', previousGraphemes: 3, currentGraphemes: 8, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 900, inputType: 'insertText', previousGraphemes: 8, currentGraphemes: 12, replacedSelection: false, compositionState: 'none' });

  const win = agg.finalize({ timestamp: 1200, reason: 'submitted' });
  assert.ok(win, 'window produced');
  assert.equal(win.modality, 'typing');
  assert.equal(win.window_kind, 'episode');
  assert.equal(win.feature_profile, 'typing-v3');
  assert.equal(win.window_start, new Date(1000).toISOString());
  assert.equal(win.window_end, new Date(1000).toISOString());
  assert.deepEqual(win.target, { kind: 'chat_composer', id: 'abc' });

  const t = win.typing;
  assert.equal(t.elapsed_ms, 1200, 'elapsed_ms = finalize ts - start ts');
  assert.equal(t.first_input_latency_ms, 200, 'latency = first edit ts - start ts');
  assert.equal(t.inserted_graphemes, 12, '3 + 5 + 4');
  assert.equal(t.deleted_graphemes, 0);
  assert.equal(t.replacement_graphemes, 0);
  assert.equal(t.pasted_graphemes, 0);
  assert.equal(t.committed_graphemes, 12, 'net final grapheme count');
  assert.equal(t.edit_event_count, 3);
  assert.equal(t.composition_count, 0);
  assert.equal(t.revision_ratio, 0, '0 deleted / 12 inserted');
  assert.deepEqual(t.inter_event_intervals_ms, [300, 400], 'intervals between the 3 edits (2 intervals)');
  assert.equal(t.burst_count, 1, 'all intervals below default 2000ms threshold -> one burst');
  assert.equal(t.active_input_ms, 700, 'sum of sub-threshold intervals: 300 + 400');
  assert.ok(Math.abs(t.production_rate_per_active_min - (12 / (700 / 60000))) < 1e-9);
  assert.equal(t.submitted, true);
  assert.equal(t.abandoned, false);
  assert.equal(win.quality.intervals_truncated, false);
  assert.deepEqual(win.quality.thresholds.pause_buckets, [500, 1000, 2000, 5000]);
  assert.equal(win.quality.thresholds.burst_threshold_ms, 2000);
  // typing-v2 additions: no caretOffset was ever supplied above, so there is
  // nothing positional to record — additive, does not disturb any v1 field.
  assert.deepEqual(t.revision_locations, [], 'no caretOffset supplied -> no revision_locations entries');
  assert.equal(win.quality.revision_locations_truncated, false);
}

// ---------- B. Deletion and revision_ratio ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 20, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 300, inputType: 'deleteContentBackward', previousGraphemes: 20, currentGraphemes: 15, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 500, inputType: 'deleteContentBackward', previousGraphemes: 15, currentGraphemes: 10, replacedSelection: false, compositionState: 'none' });

  const win = agg.finalize({ timestamp: 600, reason: 'abandoned' });
  const t = win.typing;
  assert.equal(t.inserted_graphemes, 20);
  assert.equal(t.deleted_graphemes, 10, '5 + 5');
  assert.equal(t.committed_graphemes, 10);
  assert.ok(Math.abs(t.revision_ratio - (10 / 20)) < 1e-9);
  assert.equal(t.submitted, false);
  assert.equal(t.abandoned, true);
  // target omitted entirely when both kind and id are null.
  assert.ok(!('target' in win), 'target key omitted when both kind and id are null');
}

// ---------- C. Selection replacement ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  // Select "abcdef" (6 graphemes) and replace with "xy" (2 graphemes): net -4.
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 6, currentGraphemes: 2, replacedSelection: true, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 200, reason: 'submitted' });
  const t = win.typing;
  assert.equal(t.deleted_graphemes, 4, 'delta = -4 -> deleted_graphemes += 4');
  assert.equal(t.replacement_graphemes, 4, 'replacedSelection: max(0, 6 - 2) = 4');
  assert.equal(t.edit_event_count, 1);

  // Documented limitation: a same-length replacement reports 0 replacement
  // graphemes because only the net delta is observed.
  const agg2 = new TypingAggregator({ now: () => 0 });
  agg2.start({ timestamp: 0 });
  agg2.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 3, currentGraphemes: 3, replacedSelection: true, compositionState: 'none' });
  const win2 = agg2.finalize({ timestamp: 200, reason: 'submitted' });
  assert.equal(win2.typing.replacement_graphemes, 0, 'same-length replacement -> max(0, 3-3) = 0 (limitation)');
  assert.equal(win2.typing.edit_event_count, 1, 'delta === 0 with replacedSelection true is still an edit event');
}

// ---------- D. Paste ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, inputType: 'insertFromPaste', previousGraphemes: 0, currentGraphemes: 50, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 200, inputType: 'InsertFromPaste', previousGraphemes: 50, currentGraphemes: 55, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 300, inputType: 'insertText', previousGraphemes: 55, currentGraphemes: 56, replacedSelection: false, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 400, reason: 'submitted' });
  const t = win.typing;
  assert.equal(t.pasted_graphemes, 55, '50 + 5 from the two paste events (case-insensitive match), not the plain insert');
  assert.equal(t.inserted_graphemes, 56);
}

// ---------- E. IME composition sequence ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  // start: composition begins, no visible text change yet.
  agg.record({ timestamp: 100, inputType: null, previousGraphemes: 0, currentGraphemes: 0, replacedSelection: false, compositionState: 'start' });
  // two intermediate IME updates — must not move edit/grapheme accounting.
  agg.record({ timestamp: 150, inputType: null, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'update' });
  agg.record({ timestamp: 200, inputType: null, previousGraphemes: 0, currentGraphemes: 2, replacedSelection: false, compositionState: 'update' });
  // end: commits the whole composed text.
  agg.record({ timestamp: 260, inputType: 'insertCompositionText', previousGraphemes: 0, currentGraphemes: 2, replacedSelection: false, compositionState: 'end' });

  const win = agg.finalize({ timestamp: 300, reason: 'submitted' });
  const t = win.typing;
  assert.equal(t.edit_event_count, 2, 'only start + end commit; the two updates do not inflate edit_event_count');
  assert.equal(t.composition_count, 3, 'both updates and the end event count into composition_count');
  assert.equal(t.inserted_graphemes, 2, 'only end contributes graphemes: delta 0 (start) + delta 2 (end)');
  assert.equal(t.inter_event_intervals_ms.length, 1, 'one interval recorded: start -> end (updates recorded no interval)');
}

// ---------- F. Pause bucketing across every boundary ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  // First edit at t=0 has no interval (it sets first_input_latency_ms).
  agg.record({ timestamp: 0, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  const gaps = [499, 500, 999, 1000, 1999, 2000, 4999, 5000, 5001];
  let t = 0;
  let count = 1;
  for (const gap of gaps) {
    t += gap;
    agg.record({ timestamp: t, previousGraphemes: count, currentGraphemes: count + 1, replacedSelection: false, compositionState: 'none' });
    count += 1;
  }
  const win = agg.finalize({ timestamp: t + 10, reason: 'submitted' });
  const hist = win.typing.pause_histogram;
  // 499 -> lt_500 ; 500 -> 500_to_1000 ; 999 -> 500_to_1000 ; 1000 -> 1000_to_2000
  // 1999 -> 1000_to_2000 ; 2000 -> 2000_to_5000 ; 4999 -> 2000_to_5000 ; 5000 -> gte_5000 ; 5001 -> gte_5000
  assert.equal(hist.lt_500_ms, 1, '499');
  assert.equal(hist['500_to_1000_ms'], 2, '500, 999');
  assert.equal(hist['1000_to_2000_ms'], 2, '1000, 1999');
  assert.equal(hist['2000_to_5000_ms'], 2, '2000, 4999');
  assert.equal(hist.gte_5000_ms, 2, '5000, 5001');
  const total = hist.lt_500_ms + hist['500_to_1000_ms'] + hist['1000_to_2000_ms'] + hist['2000_to_5000_ms'] + hist.gte_5000_ms;
  assert.equal(total, gaps.length, 'every gap lands in exactly one bucket');
}

// ---------- G. Burst counting ----------
{
  const agg = new TypingAggregator({ now: () => 0, burstThresholdMs: 2000 });
  agg.start({ timestamp: 0 });
  // burst 1: three edits close together.
  agg.record({ timestamp: 0, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 100, previousGraphemes: 1, currentGraphemes: 2, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 200, previousGraphemes: 2, currentGraphemes: 3, replacedSelection: false, compositionState: 'none' });
  // pause >= threshold -> new burst.
  agg.record({ timestamp: 2500, previousGraphemes: 3, currentGraphemes: 4, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 2600, previousGraphemes: 4, currentGraphemes: 5, replacedSelection: false, compositionState: 'none' });
  // another pause >= threshold -> third burst.
  agg.record({ timestamp: 5000, previousGraphemes: 5, currentGraphemes: 6, replacedSelection: false, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 5100, reason: 'submitted' });
  assert.equal(win.typing.burst_count, 3);
}

// ---------- H. first_input_latency_ms ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 1000 });
  agg.record({ timestamp: 1350, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 1400, reason: 'submitted' });
  assert.equal(win.typing.first_input_latency_ms, 350);
}

// ---------- I. maxIntervals truncation ----------
{
  const agg = new TypingAggregator({ now: () => 0, maxIntervals: 2 });
  agg.start({ timestamp: 0 });
  // 6 edits -> 5 intervals; only the first 2 are retained.
  for (let i = 0; i <= 5; i += 1) {
    agg.record({ timestamp: i * 100, previousGraphemes: i, currentGraphemes: i + 1, replacedSelection: false, compositionState: 'none' });
  }
  const win = agg.finalize({ timestamp: 700, reason: 'submitted' });
  assert.equal(win.typing.inter_event_intervals_ms.length, 2, 'series capped at maxIntervals');
  assert.equal(win.quality.intervals_truncated, true);
  // Everything else still counts all 5 intervals correctly.
  const hist = win.typing.pause_histogram;
  const total = Object.values(hist).reduce((a, b) => a + b, 0);
  assert.equal(total, 5, 'histogram counts all intervals, not just the retained series');
  assert.equal(win.typing.active_input_ms, 500, 'sum of all 5 sub-threshold 100ms intervals, not just retained ones');
}

// ---------- J. finalize before start returns null ----------
{
  const agg = new TypingAggregator();
  // record() before start() must be a silent no-op, never throw.
  agg.record({ timestamp: 10, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  assert.equal(agg.active, false);
  const win = agg.finalize({ timestamp: 100, reason: 'submitted' });
  assert.equal(win, null, 'finalize with no started episode returns null');
}

// ---------- K. double finalize returns null ----------
{
  const agg = new TypingAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 10, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  const first = agg.finalize({ timestamp: 100, reason: 'submitted' });
  assert.ok(first, 'first finalize produces a window');
  assert.equal(agg.active, false);
  const second = agg.finalize({ timestamp: 200, reason: 'submitted' });
  assert.equal(second, null, 'second finalize on an already-finalized episode returns null');
}

// ---------- L. invalid reason throws ----------
{
  const agg = new TypingAggregator();
  agg.start({ timestamp: 0 });
  assert.throws(
    () => agg.finalize({ timestamp: 100, reason: 'cancelled' }),
    /reason must be 'submitted' or 'abandoned'/,
  );
}

// ---------- M. validator round-trip ----------
{
  const agg = new TypingAggregator({ now: () => Date.now() });
  agg.start({ timestamp: 0, targetKind: 'textarea', targetId: 'essay-1' });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 400, inputType: 'insertFromPaste', previousGraphemes: 5, currentGraphemes: 40, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 900, inputType: 'deleteContentBackward', previousGraphemes: 40, currentGraphemes: 35, replacedSelection: false, compositionState: 'none' });
  agg.record({ timestamp: 1500, inputType: null, previousGraphemes: 35, currentGraphemes: 36, replacedSelection: false, compositionState: 'start' });
  agg.record({ timestamp: 1550, inputType: null, previousGraphemes: 35, currentGraphemes: 38, replacedSelection: false, compositionState: 'update' });
  agg.record({ timestamp: 1650, inputType: 'insertCompositionText', previousGraphemes: 35, currentGraphemes: 39, replacedSelection: false, compositionState: 'end' });
  const win = agg.finalize({ timestamp: 3000, reason: 'submitted' });

  const errors = validateEmotionEvent(win);
  assert.deepEqual(errors, [], `validator should accept a finalized typing window, got: ${JSON.stringify(errors)}`);
}

// ---------- N. validator round-trip with no target and no edits ----------
{
  const agg = new TypingAggregator({ now: () => Date.now() });
  agg.start({ timestamp: 0 });
  const win = agg.finalize({ timestamp: 500, reason: 'abandoned' });
  const errors = validateEmotionEvent(win);
  assert.deepEqual(errors, [], `validator should accept an empty abandoned episode, got: ${JSON.stringify(errors)}`);
  assert.equal(win.typing.first_input_latency_ms, null, 'no edits -> null latency');
  assert.equal(win.typing.committed_graphemes, 0);
  assert.equal(win.typing.burst_count, 0, 'no edits -> no bursts');
}

// ==================== typing-v2: per-event states + positional deltas ====================

// ---------- O. Event stream: start, one edit, submit ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 5000, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0, targetKind: 'chat_composer', targetId: 'o' });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 3, replacedSelection: false, compositionState: 'none', caretOffset: 3 });
  const win = agg.finalize({ timestamp: 500, reason: 'submitted' });

  assert.equal(events.length, 3, 'start, insert, submit');

  assert.equal(events[0].modality, 'typing');
  assert.equal(events[0].source, 'user');
  assert.equal(events[0].state, 'start');
  assert.equal(events[0].monotonic_ms, 0);
  assert.equal(events[0].timestamp, 5000, 'wall clock = startWallClock + (monotonic - startTimestamp)');
  assert.equal(events[0].detail, null);

  assert.equal(events[1].state, 'insert');
  assert.equal(events[1].monotonic_ms, 100);
  assert.equal(events[1].timestamp, 5100);
  assert.deepEqual(events[1].detail, { offset: 3, length: 3, op: 'insert' });
  // typing-v3: wall_ms sits alongside timestamp/monotonic_ms on every event;
  // no wallTimestamp was supplied on the record() call, so it falls back to
  // the same synthesized value as `timestamp`.
  assert.equal(events[1].wall_ms, 5100, 'no wallTimestamp supplied -> falls back to the synthesized wall clock');
  assert.equal(events[0].wall_ms, 5000, 'start has no wallTimestamp input either -> synthesized');

  assert.equal(events[2].state, 'submit');
  assert.equal(events[2].monotonic_ms, 500);
  assert.equal(events[2].timestamp, 5500);
  assert.equal(events[2].detail, null);
  assert.equal(events[2].wall_ms, 5500);

  assert.equal(win.feature_profile, 'typing-v3');
  assert.deepEqual(win.typing.revision_locations, [
    { offset: 3, length: 3, op: 'insert', t: 100, wall_ms: 5100, distance: 0 },
  ], 'distance = currentGraphemes(3) - caretOffset(3) = 0 (leading edge); wall_ms synthesized as above');
  assert.equal(win.quality.revision_locations_truncated, false);
}

// ---------- P. abandon() emits 'abandon', not 'submit' ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });
  agg.finalize({ timestamp: 100, reason: 'abandoned' });
  assert.deepEqual(events.map((e) => e.state), ['start', 'abandon']);
}

// ---------- Q. State-mapping table, including replace / paste precedence ----------
{
  // Fires one edit event into a fresh episode and returns the event emitted
  // for it (events[0] is always start).
  function singleEditState(recordArgs) {
    const events = [];
    const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
    agg.start({ timestamp: 0 });
    agg.record({ timestamp: 100, caretOffset: 5, compositionState: 'none', replacedSelection: false, ...recordArgs });
    agg.finalize({ timestamp: 200, reason: 'abandoned' });
    return events[1];
  }

  assert.equal(
    singleEditState({ inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5 }).state,
    'insert', 'net delta > 0 -> insert',
  );
  assert.equal(
    singleEditState({ inputType: 'deleteContentBackward', previousGraphemes: 5, currentGraphemes: 0 }).state,
    'delete', 'net delta < 0 -> delete',
  );
  assert.equal(
    singleEditState({ inputType: 'insertText', previousGraphemes: 5, currentGraphemes: 2, replacedSelection: true }).state,
    'replace', 'replacedSelection takes precedence over delete (net-shorter replacement)',
  );
  assert.equal(
    singleEditState({ inputType: 'insertText', previousGraphemes: 2, currentGraphemes: 8, replacedSelection: true }).state,
    'replace', 'replacedSelection takes precedence over insert (net-longer replacement)',
  );
  assert.equal(
    singleEditState({ inputType: 'insertFromPaste', previousGraphemes: 0, currentGraphemes: 10 }).state,
    'paste', 'inputType indicates paste -> paste',
  );
  assert.equal(
    singleEditState({ inputType: 'insertFromPaste', previousGraphemes: 5, currentGraphemes: 2, replacedSelection: true }).state,
    'paste', 'paste takes precedence over replace (pasting over a selection is still a paste)',
  );
  assert.equal(
    singleEditState({ inputType: 'historyUndo', previousGraphemes: 5, currentGraphemes: 2 }).state,
    'undo', "inputType 'historyUndo' -> undo",
  );
  assert.equal(
    singleEditState({ inputType: 'historyRedo', previousGraphemes: 2, currentGraphemes: 5 }).state,
    'redo', "inputType 'historyRedo' -> redo",
  );
  assert.equal(
    singleEditState({ inputType: 'historyUndo', previousGraphemes: 5, currentGraphemes: 2, replacedSelection: true }).state,
    'undo', 'undo takes precedence over replace',
  );
  assert.equal(
    singleEditState({ inputType: null, previousGraphemes: 0, currentGraphemes: 0, compositionState: 'start' }).state,
    'compose', "compositionState 'start' -> compose",
  );
  assert.equal(
    singleEditState({ inputType: 'insertCompositionText', previousGraphemes: 0, currentGraphemes: 2, compositionState: 'end' }).state,
    'commit', "compositionState 'end' -> commit",
  );

  // compositionState 'update' is the one state that isn't reachable through
  // singleEditState's finalize (it always early-returns without touching v1
  // accounting) — verified directly instead.
  {
    const events = [];
    const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
    agg.start({ timestamp: 0 });
    agg.record({ timestamp: 100, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'update', caretOffset: 1 });
    agg.finalize({ timestamp: 200, reason: 'abandoned' });
    assert.equal(events[1].state, 'composing');
  }
}

// ---------- R. move / select / deselect (no text change) ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });

  // Caret repositioned, no selection before or after -> move.
  agg.record({ timestamp: 100, previousGraphemes: 0, currentGraphemes: 0, replacedSelection: false, compositionState: 'none', caretOffset: 4, selectionLength: 0 });
  assert.equal(events[1].state, 'move');
  assert.deepEqual(events[1].detail, { offset: 4, length: 0, op: 'move' });

  // Selection becomes non-empty -> select ("extended").
  agg.record({ timestamp: 200, previousGraphemes: 0, currentGraphemes: 0, replacedSelection: false, compositionState: 'none', caretOffset: 4, selectionLength: 6 });
  assert.equal(events[2].state, 'select');
  assert.deepEqual(events[2].detail, { offset: 4, length: 6, op: 'select' });

  // Selection collapses back to empty, having been non-empty -> deselect.
  agg.record({ timestamp: 300, previousGraphemes: 0, currentGraphemes: 0, replacedSelection: false, compositionState: 'none', caretOffset: 10, selectionLength: 0 });
  assert.equal(events[3].state, 'deselect');
  assert.deepEqual(events[3].detail, { offset: 10, length: 0, op: 'deselect' });

  const win = agg.finalize({ timestamp: 400, reason: 'abandoned' });
  // None of the three above were edits: v1 accounting is entirely untouched.
  assert.equal(win.typing.edit_event_count, 0);
  assert.equal(win.typing.committed_graphemes, 0);
  assert.deepEqual(win.typing.revision_locations, [], 'selection/cursor events never produce a revision_locations entry');
}

// ---------- S. Pause synthesis at the burstThresholdMs boundary ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, burstThresholdMs: 2000, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });

  // Gap of 1999ms — strictly below threshold — must NOT synthesize a pause.
  agg.record({ timestamp: 100 + 1999, previousGraphemes: 1, currentGraphemes: 2, replacedSelection: false, compositionState: 'none' });
  assert.ok(!events.map((e) => e.state).includes('pause'), 'gap just below burstThresholdMs must not synthesize a pause');

  const beforeCount = events.length;
  // Gap of exactly 2000ms — at threshold — must synthesize a pause immediately before the triggering event.
  agg.record({ timestamp: 100 + 1999 + 2000, previousGraphemes: 2, currentGraphemes: 3, replacedSelection: false, compositionState: 'none' });
  const newEvents = events.slice(beforeCount);
  assert.equal(newEvents.length, 2, 'pause, then the triggering insert');
  assert.equal(newEvents[0].state, 'pause');
  assert.equal(newEvents[0].detail.duration_ms, 2000);
  assert.equal(newEvents[0].monotonic_ms, 100 + 1999, "pause's own timestamp is when the gap began, not when it was detected");
  assert.equal(newEvents[1].state, 'insert');

  agg.finalize({ timestamp: 100 + 1999 + 2000 + 10, reason: 'abandoned' });
}

// ---------- T. Pause synthesis before finalize() (submit/abandon) ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, burstThresholdMs: 2000, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, previousGraphemes: 0, currentGraphemes: 1, replacedSelection: false, compositionState: 'none' });
  // Long silence, then submit — the pause must appear before 'submit'.
  agg.finalize({ timestamp: 100 + 2500, reason: 'submitted' });
  assert.deepEqual(events.map((e) => e.state), ['start', 'insert', 'pause', 'submit']);
  assert.equal(events[2].detail.duration_ms, 2500);
}

// ---------- U. Graceful degradation when caretOffset is absent ----------
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });
  // No caretOffset / selectionLength supplied at all.
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 200, reason: 'submitted' });

  const editEvent = events.find((e) => e.state === 'insert');
  assert.deepEqual(editEvent.detail, { offset: null, length: 5, op: 'insert' }, 'still emits the correct state, with detail.offset: null');
  assert.deepEqual(win.typing.revision_locations, [], 'no offset -> nothing positional to record, but the window is otherwise complete');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- V. revision_locations correctness + shares the maxIntervals cap ----------
{
  const agg = new TypingAggregator({ now: () => 0, maxIntervals: 2 });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 3, replacedSelection: false, compositionState: 'none', caretOffset: 3 });
  agg.record({ timestamp: 200, inputType: 'insertText', previousGraphemes: 3, currentGraphemes: 6, replacedSelection: false, compositionState: 'none', caretOffset: 6 });
  // Third edit exceeds maxIntervals (2) for BOTH inter_event_intervals_ms and revision_locations.
  agg.record({ timestamp: 300, inputType: 'deleteContentBackward', previousGraphemes: 6, currentGraphemes: 4, replacedSelection: false, compositionState: 'none', caretOffset: 4 });
  const win = agg.finalize({ timestamp: 400, reason: 'submitted' });

  assert.deepEqual(win.typing.revision_locations, [
    { offset: 3, length: 3, op: 'insert', t: 100, wall_ms: 100, distance: 0 },
    { offset: 6, length: 3, op: 'insert', t: 200, wall_ms: 200, distance: 0 },
  ], 'hand-computed: two inserts of length 3 each, at their respective caret offsets and timestamps; both land at the document end (distance 0)');
  assert.equal(win.quality.revision_locations_truncated, true, 'third edit exceeded the cap, same as inter_event_intervals_ms');
  assert.equal(win.typing.edit_timestamps_ms.length, win.typing.inter_event_intervals_ms.length, 'edit_timestamps_ms shares the same cap and push site as inter_event_intervals_ms');
  // Note: revision_locations is bounded per EDIT (3 edits -> the 3rd is
  // rejected), while inter_event_intervals_ms is bounded per INTERVAL
  // (3 edits -> only 2 intervals, neither rejected) — same numeric cap
  // (`maxIntervals`), different denominators, so the two truncation flags
  // can legitimately disagree. That is exactly why this is a sibling flag
  // rather than a reuse of `intervals_truncated` (see TypingAggregator.js).
  assert.equal(win.quality.intervals_truncated, false, 'only 2 intervals were ever produced by 3 edits; the cap was not reached');
}

// ---------- W. Validator: typing-v2 window round-trips; malformed revision_locations entry rejected ----------
{
  const agg = new TypingAggregator({ now: () => Date.now() });
  agg.start({ timestamp: 0, targetKind: 'textarea', targetId: 'v2-1' });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none', caretOffset: 5, selectionLength: 0 });
  const win = agg.finalize({ timestamp: 200, reason: 'submitted' });
  assert.deepEqual(validateEmotionEvent(win), [], 'typing-v2 window with revision_locations validates cleanly');

  const badWin = JSON.parse(JSON.stringify(win));
  badWin.typing.revision_locations[0].offset = -1;
  const errors = validateEmotionEvent(badWin);
  assert.ok(
    errors.some((e) => e.includes('revision_locations[0].offset')),
    `expected a revision_locations offset error, got: ${JSON.stringify(errors)}`,
  );
}

// ---------- X. Validator: a typing-v1-shaped payload (no revision_locations at all) still validates ----------
{
  const win = {
    modality: 'typing',
    window_kind: 'episode',
    feature_profile: 'typing-v1',
    window_start: new Date().toISOString(),
    window_end: new Date().toISOString(),
    typing: {
      elapsed_ms: 1000,
      active_input_ms: 500,
      first_input_latency_ms: 100,
      committed_graphemes: 10,
      inserted_graphemes: 10,
      deleted_graphemes: 0,
      replacement_graphemes: 0,
      pasted_graphemes: 0,
      edit_event_count: 1,
      composition_count: 0,
      revision_ratio: 0,
      production_rate_per_active_min: 100,
      inter_event_intervals_ms: [],
      pause_histogram: {},
      burst_count: 1,
      submitted: true,
      abandoned: false,
      // no revision_locations field at all — the pre-v2 shape.
    },
    quality: {
      thresholds: { pause_buckets: [500, 1000, 2000, 5000], burst_threshold_ms: 2000 },
      intervals_truncated: false,
      // no revision_locations_truncated field at all.
    },
  };
  assert.deepEqual(validateEmotionEvent(win), [], 'a typing-v1 payload with no revision_locations field stays valid (additive)');
}

// ==================== typing-v3: writing-process metrics + absolute timestamps ====================

// ---------- Y. P-burst / R-burst classification (incl. the tie case), revision distance
//              (leading-edge + far-back), product_ratio, chars_per_min(_active), and every
//              word/boundary-dependent metric staying null when never supplied ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });

  // Edit 1 (t=0): insert "abc" (0->3), caret at the end. First edit of the
  // episode: opens the first (as yet unclosed) burst.
  agg.record({ timestamp: 0, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 3, replacedSelection: false, compositionState: 'none', caretOffset: 3 });
  // Edit 2 (t=100, interval 100 < 2000): insert 2 more (3->5), caret at end.
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 3, currentGraphemes: 5, replacedSelection: false, compositionState: 'none', caretOffset: 5 });
  // Edit 3 (t=300, interval 200 < 2000): DELETE 1 (5->4) — no pause preceded
  // it, so this revision closes burst #1 (5 graphemes: 3 + 2) as an R-burst.
  agg.record({ timestamp: 300, inputType: 'deleteContentBackward', previousGraphemes: 5, currentGraphemes: 4, replacedSelection: false, compositionState: 'none', caretOffset: 4 });
  // Edit 4 (t=400, interval 100 < 2000): insert 3 (4->7), caret at end. Opens burst #2.
  agg.record({ timestamp: 400, inputType: 'insertText', previousGraphemes: 4, currentGraphemes: 7, replacedSelection: false, compositionState: 'none', caretOffset: 7 });
  // Edit 5 (t=3000, interval 2600 >= 2000): a PAUSE precedes this insert (7->9).
  // Closes burst #2 (3 graphemes, from edit 4) as a P-burst, then opens burst #3.
  agg.record({ timestamp: 3000, inputType: 'insertText', previousGraphemes: 7, currentGraphemes: 9, replacedSelection: false, compositionState: 'none', caretOffset: 9 });
  // Edit 6 (t=3100, interval 100 < 2000): insert 1 more (9->10), caret at end.
  agg.record({ timestamp: 3100, inputType: 'insertText', previousGraphemes: 9, currentGraphemes: 10, replacedSelection: false, compositionState: 'none', caretOffset: 10 });
  // Edit 7 (t=6000, interval 2900 >= 2000): the TIE CASE — a pause AND a
  // revision (delete 2, 10->8) land on the same transition. The pause is
  // resolved first and closes burst #3 (3 graphemes: 2 + 1, from edits 5-6)
  // as a P-burst; the revision then arrives on an already-empty burst and so
  // does NOT itself close an R-burst (rBurstCount stays at 1, not 2). Caret
  // is set far from the document end (1, vs. a post-edit length of 8) to
  // double as the "far-back" revision-distance case below.
  agg.record({ timestamp: 6000, inputType: 'deleteContentBackward', previousGraphemes: 10, currentGraphemes: 8, replacedSelection: false, compositionState: 'none', caretOffset: 1 });

  const win = agg.finalize({ timestamp: 6100, reason: 'submitted' });
  const t = win.typing;

  // v1 burst_count is untouched by any of this: 1 (initial) + 2 pauses (2600, 2900) = 3.
  assert.equal(t.burst_count, 3, 'v1 burst_count is unaffected by the new P/R split');

  // ---- P-burst / R-burst, including the tie ----
  assert.equal(t.r_burst_count, 1, 'only edit 3 closed an R-burst; the tie-case revision at edit 7 did not');
  assert.equal(t.p_burst_count, 2, 'edit 5 (plain pause) and edit 7 (pause+revision tie, pause wins) each closed a P-burst');
  assert.equal(t.r_burst_mean_graphemes, 5, 'the sole R-burst held 3 (edit1) + 2 (edit2) = 5 graphemes');
  assert.equal(t.p_burst_mean_graphemes, 3, '(3 [edit4] + 3 [edit5+edit6=2+1]) / 2 P-bursts');
  assert.ok(Math.abs(t.mean_burst_graphemes - (11 / 3)) < 1e-9, '(5 + 3 + 3) graphemes across all 3 closed bursts');

  // ---- revision distance from the point of inscription ----
  // `revision_locations` still logs EVERY positioned edit — it is the
  // positional replay stream. 6 landed at the document end (distance 0); edit 7
  // landed 7 graphemes back (8 - 1 = 7).
  assert.deepEqual(t.revision_locations.map((entry) => entry.distance), [0, 0, 0, 0, 0, 0, 7]);

  // The distance STATISTICS, however, are over revisions only (delete /
  // replace / correct). Two of the seven edits were deletes: edit 3 at the
  // leading edge (0) and edit 7 seven graphemes back (7). Including plain
  // inserts here would put a 0 on every keystroke and make a writer who never
  // goes back look identical to one who does — which is what these fields exist
  // to distinguish.
  assert.ok(Math.abs(t.revision_distance_mean - 3.5) < 1e-9, '(0 + 7) / 2 revisions');
  assert.ok(Math.abs(t.revision_distance_median - 3.5) < 1e-9, 'median of [0, 7]');
  assert.ok(Math.abs(t.leading_edge_revision_ratio - 0.5) < 1e-9, '1 of 2 revisions within the 2-grapheme tolerance');

  // ---- process vs. product ----
  assert.equal(t.produced_graphemes, 11, 'same total as inserted_graphemes: 3+2+3+2+1');
  assert.equal(t.produced_graphemes, t.inserted_graphemes, 'produced_graphemes is the v3-named alias of inserted_graphemes');
  assert.ok(Math.abs(t.product_ratio - (8 / 11)) < 1e-9, 'committed_graphemes(8) / produced_graphemes(11)');

  // ---- fluency, field-conventional units ----
  assert.ok(Math.abs(t.chars_per_min - (8 * 60000 / 6100)) < 1e-9, 'committed_graphemes over elapsed_ms(6100)');
  assert.equal(t.chars_per_min_active, 960, 'committed_graphemes(8) over active_input_ms(500): 8 * 60000 / 500');

  // ---- absolute timestamps anchor the interval series ----
  assert.equal(t.edit_timestamps_ms.length, t.inter_event_intervals_ms.length, 'one anchor per retained interval');
  assert.deepEqual(t.edit_timestamps_ms, [100, 300, 400, 3000, 3100, 6000], 'no wallTimestamp supplied -> synthesized wall clock (now: () => 0) equals the monotonic timestamp of each edit');

  // ---- every word/boundary-dependent metric is null (not 0) — never supplied ----
  assert.equal(t.mean_burst_words, null);
  assert.equal(t.words_per_min, null);
  assert.equal(t.words_per_min_active, null);
  assert.equal(t.pause_location_counts, null);

  assert.deepEqual(validateEmotionEvent(win), [], `typing-v3 window should validate cleanly, got: ${JSON.stringify(validateEmotionEvent(win))}`);
}

// ---------- Z. Word counts supplied: mean_burst_words / words_per_min(_active) become numeric ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  // Word 1: "hello" (0->5 graphemes, 0->1 words).
  agg.record({ timestamp: 0, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none', caretOffset: 5, previousWords: 0, currentWords: 1 });
  // Word 2: " world" (5->11 graphemes, 1->2 words); interval 500 < 2000.
  agg.record({ timestamp: 500, inputType: 'insertText', previousGraphemes: 5, currentGraphemes: 11, replacedSelection: false, compositionState: 'none', caretOffset: 11, previousWords: 1, currentWords: 2 });
  // A pause (interval 2500 >= 2000) precedes word 3, closing burst #1 (11
  // graphemes, 2 words) as a P-burst; word 3 (11->17 graphemes, 2->3 words)
  // opens and (at finalize) closes burst #2 as a trailing P-burst.
  agg.record({ timestamp: 3000, inputType: 'insertText', previousGraphemes: 11, currentGraphemes: 17, replacedSelection: false, compositionState: 'none', caretOffset: 17, previousWords: 2, currentWords: 3 });
  const win = agg.finalize({ timestamp: 3200, reason: 'submitted' });
  const t = win.typing;

  assert.equal(t.p_burst_count, 2);
  assert.equal(t.r_burst_count, 0);
  assert.equal(t.mean_burst_graphemes, 8.5, '(11 + 6) / 2');
  assert.equal(t.mean_burst_words, 1.5, '(2 + 1) / 2 closed bursts');

  assert.equal(t.produced_graphemes, 17, 'pure-insert episode: produced == committed');
  assert.equal(t.product_ratio, 1, 'nothing was deleted');

  // elapsed_ms = 3200, active_input_ms = 500 (only the first, sub-threshold interval).
  assert.ok(Math.abs(t.words_per_min - (3 * 60000 / 3200)) < 1e-9, 'final committed word count (3) over elapsed time');
  assert.ok(Math.abs(t.words_per_min_active - (3 * 60000 / 500)) < 1e-9, 'final committed word count (3) over active time');
  assert.ok(Math.abs(t.chars_per_min - (17 * 60000 / 3200)) < 1e-9);
  assert.equal(t.chars_per_min_active, 2040, '17 * 60000 / 500');

  // Pure-insert episode: there were no revisions at all, so the revision
  // distance statistics are null — not 0. A 0 would assert "revisions happened,
  // all at the leading edge", which is a different claim from "no revisions".
  assert.equal(t.revision_distance_mean, null);
  assert.equal(t.revision_distance_median, null);
  assert.equal(t.leading_edge_revision_ratio, null);

  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- AA. pause_location_counts: only pause-preceded edits are counted, bucketed by boundaryContext ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 0, previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none', caretOffset: 5 });
  // interval 100 < 2000 -> boundaryContext supplied but NOT a pause -> no count.
  agg.record({ timestamp: 100, previousGraphemes: 5, currentGraphemes: 9, replacedSelection: false, compositionState: 'none', caretOffset: 9, boundaryContext: 'mid_word' });
  // interval 2100 >= 2000 -> pause -> counts under word_boundary.
  agg.record({ timestamp: 2200, previousGraphemes: 9, currentGraphemes: 14, replacedSelection: false, compositionState: 'none', caretOffset: 14, boundaryContext: 'word_boundary' });
  // interval 100 < 2000 -> not a pause -> no count.
  agg.record({ timestamp: 2300, previousGraphemes: 14, currentGraphemes: 18, replacedSelection: false, compositionState: 'none', caretOffset: 18, boundaryContext: 'sentence_boundary' });
  // interval 2700 >= 2000 -> pause -> counts under paragraph_boundary.
  agg.record({ timestamp: 5000, previousGraphemes: 18, currentGraphemes: 23, replacedSelection: false, compositionState: 'none', caretOffset: 23, boundaryContext: 'paragraph_boundary' });
  // interval 100 < 2000 -> not a pause, even though boundaryContext is 'mid_word' again -> no count.
  agg.record({ timestamp: 5100, previousGraphemes: 23, currentGraphemes: 20, replacedSelection: false, compositionState: 'none', caretOffset: 5, boundaryContext: 'mid_word' });

  const win = agg.finalize({ timestamp: 5200, reason: 'submitted' });
  assert.deepEqual(win.typing.pause_location_counts, {
    mid_word: 0, word_boundary: 1, sentence_boundary: 0, paragraph_boundary: 1,
  }, 'only the two pause-preceded edits are counted, under their respective boundaryContext');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- BB. Adaptive pause threshold: differs from fixed, while fixed-bucket output stays identical ----------
{
  // Same event sequence run through two aggregators: one 'fixed' (default),
  // one 'adaptive'. Inter-edit gaps: [100, 120, 110, 90, 600, 110, 100] ms.
  // median = 110 -> adaptive threshold = 110 * 3 = 330ms (see class doc
  // "Adaptive pause threshold": 3x median IKI). Only the 600ms gap clears
  // 330ms, while none clear the fixed 2000ms threshold.
  function runGapSequence(agg) {
    agg.start({ timestamp: 0 });
    const gaps = [100, 120, 110, 90, 600, 110, 100];
    let g = 0;
    let ts = 0;
    agg.record({ timestamp: ts, previousGraphemes: g, currentGraphemes: g + 1, replacedSelection: false, compositionState: 'none' });
    g += 1;
    for (const gap of gaps) {
      ts += gap;
      agg.record({ timestamp: ts, previousGraphemes: g, currentGraphemes: g + 1, replacedSelection: false, compositionState: 'none' });
      g += 1;
    }
    return agg.finalize({ timestamp: ts + 10, reason: 'submitted' });
  }

  const fixedWin = runGapSequence(new TypingAggregator({ now: () => 0 }));
  const adaptiveWin = runGapSequence(new TypingAggregator({ now: () => 0, pauseThresholdMode: 'adaptive' }));

  // Fixed-threshold figures: identical in both modes.
  assert.equal(fixedWin.typing.burst_count, 1, 'no gap reaches the fixed 2000ms threshold');
  assert.equal(fixedWin.typing.active_input_ms, 1230, 'sum of all 7 gaps');
  assert.equal(adaptiveWin.typing.burst_count, fixedWin.typing.burst_count, 'adaptive mode never changes the fixed-threshold burst_count');
  assert.equal(adaptiveWin.typing.active_input_ms, fixedWin.typing.active_input_ms, 'adaptive mode never changes the fixed-threshold active_input_ms');
  assert.deepEqual(adaptiveWin.typing.pause_histogram, fixedWin.typing.pause_histogram, 'the pause histogram always uses the fixed buckets, in both modes');

  // Mode metadata + adaptive-only fields.
  assert.equal(fixedWin.quality.thresholds.pause_threshold_mode, 'fixed');
  assert.equal(fixedWin.quality.thresholds.adaptive_burst_threshold_ms, undefined, 'fixed mode adds no adaptive_* keys at all');
  assert.equal(fixedWin.typing.adaptive_burst_count, undefined);

  assert.equal(adaptiveWin.quality.thresholds.pause_threshold_mode, 'adaptive');
  assert.equal(adaptiveWin.quality.thresholds.adaptive_burst_threshold_ms, 330, 'median(110) x 3');
  assert.equal(adaptiveWin.quality.thresholds.adaptive_rule, 'median_iki_x3');
  assert.equal(adaptiveWin.typing.adaptive_burst_count, 2, '1 (initial) + 1 gap (600ms) clearing the adaptive 330ms threshold');
  assert.equal(adaptiveWin.typing.adaptive_active_input_ms, 630, 'sum of the six gaps below 330ms: 1230 - 600');

  assert.deepEqual(validateEmotionEvent(fixedWin), []);
  assert.deepEqual(validateEmotionEvent(adaptiveWin), []);
}

// ---------- CC. Invalid pauseThresholdMode throws ----------
{
  assert.throws(
    () => new TypingAggregator({ pauseThresholdMode: 'bogus' }),
    /pauseThresholdMode must be 'fixed' or 'adaptive'/,
  );
}

// ---------- DD. No caretOffset ever supplied -> revision-distance/word/boundary metrics null; process/product metrics stay numeric ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, replacedSelection: false, compositionState: 'none' });
  const win = agg.finalize({ timestamp: 200, reason: 'submitted' });
  const t = win.typing;

  assert.equal(t.revision_distance_mean, null, 'no caretOffset ever supplied -> null, not 0');
  assert.equal(t.revision_distance_median, null);
  assert.equal(t.leading_edge_revision_ratio, null);
  assert.equal(t.words_per_min, null);
  assert.equal(t.words_per_min_active, null);
  assert.equal(t.mean_burst_words, null);
  assert.equal(t.pause_location_counts, null);

  // These do not depend on caretOffset/word counts, so they stay numeric.
  assert.equal(t.produced_graphemes, 5);
  assert.equal(t.product_ratio, 1, '5 committed / 5 produced');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- EE. Empty episode: produced_graphemes 0 -> product_ratio null (not NaN);
//              burst COUNTS are real zeros, burst MEANS are unmeasured nulls ----------
// NOTE: this test originally asserted `mean_burst_graphemes === 0` for an
// episode with zero closed bursts, calling it "a real, measured 0". That
// encoded the null-vs-zero mistake this codebase's invariant forbids: a mean
// over an empty set is UNMEASURED, not zero — only the counts are real zeros.
// Corrected as part of the statistical-defect fixes (zero denominators must
// never silently become zero results).
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  const win = agg.finalize({ timestamp: 100, reason: 'abandoned' });
  const t = win.typing;

  assert.equal(t.produced_graphemes, 0);
  assert.equal(t.product_ratio, null, 'produced_graphemes is 0 -> null, distinct from a measured 0 or NaN');
  assert.equal(t.baseline_graphemes, null, 'no edits -> the episode never observed a document length');
  assert.equal(t.p_burst_count, 0, 'a COUNT over zero bursts is a real, measured 0');
  assert.equal(t.r_burst_count, 0);
  assert.equal(t.mean_burst_graphemes, null, 'a MEAN over zero closed bursts is unmeasured -> null, never 0');
  assert.equal(t.p_burst_mean_graphemes, null);
  assert.equal(t.r_burst_mean_graphemes, null);
  // Rates/ratios with a zero or absent denominator are null, not 0.
  assert.equal(t.revision_ratio, null, 'nothing inserted -> deletions have no insertion base -> null');
  assert.equal(t.production_rate_per_active_min, null, 'no active time observed -> null');
  assert.equal(t.chars_per_min_active, null, 'no active time observed -> null');
  assert.equal(t.chars_per_min, 0, 'elapsed time exists (100 ms) and net production is a real 0');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- FF. Validator: typing-v3 fields (adaptive mode, word counts, boundary context) round-trip; malformed values rejected ----------
{
  const agg = new TypingAggregator({ now: () => Date.now(), pauseThresholdMode: 'adaptive' });
  agg.start({ timestamp: 0, targetKind: 'textarea', targetId: 'v3-1' });
  agg.record({
    timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5,
    replacedSelection: false, compositionState: 'none', caretOffset: 5,
    previousWords: 0, currentWords: 1, boundaryContext: 'word_boundary',
  });
  agg.record({
    timestamp: 2300, inputType: 'deleteContentBackward', previousGraphemes: 5, currentGraphemes: 3,
    replacedSelection: false, compositionState: 'none', caretOffset: 1,
    previousWords: 1, currentWords: 1, boundaryContext: 'mid_word',
  });
  const win = agg.finalize({ timestamp: 2400, reason: 'submitted' });

  assert.deepEqual(
    validateEmotionEvent(win), [],
    `typing-v3 window (adaptive mode + word counts + boundary context) should validate cleanly, got: ${JSON.stringify(validateEmotionEvent(win))}`,
  );

  const badBurst = JSON.parse(JSON.stringify(win));
  badBurst.typing.p_burst_count = -1;
  assert.ok(validateEmotionEvent(badBurst).some((e) => e.includes('p_burst_count')));

  const badPauseLocationKey = JSON.parse(JSON.stringify(win));
  badPauseLocationKey.typing.pause_location_counts = { made_up_key: 1 };
  assert.ok(validateEmotionEvent(badPauseLocationKey).some((e) => e.includes('pause_location_counts')));

  const badRatio = JSON.parse(JSON.stringify(win));
  badRatio.typing.leading_edge_revision_ratio = 1.5;
  assert.ok(validateEmotionEvent(badRatio).some((e) => e.includes('leading_edge_revision_ratio')));

  const badDistance = JSON.parse(JSON.stringify(win));
  badDistance.typing.revision_locations[0].distance = -5;
  assert.ok(validateEmotionEvent(badDistance).some((e) => e.includes('revision_locations[0].distance')));

  const badEditTimestamps = JSON.parse(JSON.stringify(win));
  badEditTimestamps.typing.edit_timestamps_ms = new Array(5001).fill(1);
  assert.ok(validateEmotionEvent(badEditTimestamps).some((e) => e.includes('edit_timestamps_ms')));

  const badWordsPerMin = JSON.parse(JSON.stringify(win));
  badWordsPerMin.typing.words_per_min = -1;
  assert.ok(validateEmotionEvent(badWordsPerMin).some((e) => e.includes('words_per_min')));
}

// ==================== statistical-defect regressions (adversarial review) ====================

// ---------- GG. REGRESSION (finding 4): editing a pre-existing draft must not count
//              the draft as this episode's production ----------
// Adding ONE character to a 100-character existing draft used to report
// product_ratio 101, chars_per_min 101, and a measured-zero
// chars_per_min_active. Every produced/committed comparison and every rate is
// now episode-scoped against baseline_graphemes/baseline_words.
{
  const events = [];
  const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
  agg.start({ timestamp: 0 });
  agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 100, currentGraphemes: 101, caretOffset: 101, previousWords: 20, currentWords: 20 });
  const win = agg.finalize({ timestamp: 60000, reason: 'submitted' });
  const t = win.typing;

  assert.equal(t.baseline_graphemes, 100, 'the document length the episode found');
  assert.equal(t.baseline_words, 20);
  assert.equal(t.committed_graphemes, 101, 'final DOCUMENT length — unchanged meaning');
  assert.equal(t.produced_graphemes, 1, 'this episode typed exactly one grapheme');
  assert.equal(t.product_ratio, 1, 'max(0, produced 1 - deleted 0) / produced 1 — bounded in [0, 1], NOT 101');
  assert.equal(t.chars_per_min, 1, 'net episode production (101 - 100 = 1 grapheme) over one minute — NOT 101');
  assert.equal(t.chars_per_min_active, null, 'one edit -> zero measurable inter-edit intervals -> UNMEASURABLE, not 0');
  assert.equal(t.production_rate_per_active_min, null, 'same unmeasurable active denominator');
  assert.equal(t.words_per_min, 0, 'net words (20 - 20 = 0) over a real minute — a measured 0, NOT 20');
  assert.equal(t.words_per_min_active, null);
  assert.equal(t.revision_ratio, 0, '0 deleted / 1 inserted — a real, measured 0');
  assert.deepEqual(events.map((e) => e.state), ['start', 'insert', 'pause', 'submit'], 'event stream unchanged by the baseline fix');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- HH. Episode that NET-DELETES pre-existing text: every ratio/rate stays
//              bounded and interpretable ----------
{
  const agg = new TypingAggregator({ now: () => 0 });
  agg.start({ timestamp: 0 });
  // Found 100 graphemes; deleted 30 of them, then typed 10 new ones.
  agg.record({ timestamp: 100, inputType: 'deleteContentBackward', previousGraphemes: 100, currentGraphemes: 70 });
  agg.record({ timestamp: 200, inputType: 'insertText', previousGraphemes: 70, currentGraphemes: 80 });
  const win = agg.finalize({ timestamp: 60000, reason: 'submitted' });
  const t = win.typing;

  assert.equal(t.baseline_graphemes, 100);
  assert.equal(t.committed_graphemes, 80);
  assert.equal(t.inserted_graphemes, 10);
  assert.equal(t.deleted_graphemes, 30);
  assert.equal(t.product_ratio, 0, 'max(0, 10 - 30) / 10 = 0 — floored, never negative, never > 1');
  assert.equal(t.chars_per_min, 0, 'net production is negative (-20) -> rate floors at 0; the deletions live in deleted_graphemes');
  assert.equal(t.chars_per_min_active, 0, 'active time exists (100 ms) but net production floors at 0');
  assert.equal(t.revision_ratio, 3, '30 deleted / 10 inserted — unbounded above by design, still well-defined');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- II. REGRESSION (finding 5): adaptive figures must cover the WHOLE episode,
//              not the maxIntervals-truncated prefix ----------
// With maxIntervals: 1 only the first interval is exported, but the adaptive
// threshold and adaptive_* figures are derived from ALL intervals.
// Hand-computed: intervals [100, 5000, 100]; median 100 -> threshold 300;
// bursts = 1 (initial) + 1 (the 5000 ms gap >= 300) = 2; adaptive active
// time = 100 + 100 = 200 (the two sub-threshold intervals).
{
  const agg = new TypingAggregator({ now: () => 0, pauseThresholdMode: 'adaptive', maxIntervals: 1 });
  agg.start({ timestamp: 0 });
  for (const [ts, prev, cur] of [[100, 0, 1], [200, 1, 2], [5200, 2, 3], [5300, 3, 4]]) {
    agg.record({ timestamp: ts, inputType: 'insertText', previousGraphemes: prev, currentGraphemes: cur });
  }
  const win = agg.finalize({ timestamp: 5400, reason: 'submitted' });

  assert.deepEqual(win.typing.inter_event_intervals_ms, [100], 'exported series is still capped (transport bound)');
  assert.equal(win.quality.intervals_truncated, true);
  assert.equal(win.quality.thresholds.adaptive_burst_threshold_ms, 300, 'median(100, 5000, 100) = 100, x3 — over ALL intervals');
  assert.equal(win.typing.adaptive_burst_count, 2, '1 initial + the 5000 ms gap — the gap lies PAST the cap and must still count');
  assert.equal(win.typing.adaptive_active_input_ms, 200, 'both 100 ms intervals, including the one past the cap');
  // Fixed-mode figures were already complete past the cap; pin that too.
  assert.equal(win.typing.burst_count, 2, '1 initial + the 5000 ms gap >= fixed 2000 ms');
  assert.equal(win.typing.active_input_ms, 200);
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- JJ. REGRESSION (finding 6): an accepted correction is a revision in BOTH
//              families, with or without a visible selection ----------
// A `correct` used to count into revision_distance_* but NOT close an R-burst,
// and a same-length correction with no selection was misclassified `move`
// (vanishing from correction_count and the distance statistics entirely).
{
  function run(replacedSelection) {
    const events = [];
    const agg = new TypingAggregator({ now: () => 0, onEvent: (e) => events.push(e) });
    agg.start({ timestamp: 0 });
    agg.record({ timestamp: 100, inputType: 'insertText', previousGraphemes: 0, currentGraphemes: 5, caretOffset: 5 });
    // Same-length accepted spellcheck/autocorrect replacement at offset 2.
    agg.record({ timestamp: 200, inputType: 'insertReplacementText', previousGraphemes: 5, currentGraphemes: 5, replacedSelection, caretOffset: 2, selectionLength: 0 });
    const t = agg.finalize({ timestamp: 300, reason: 'submitted' }).typing;
    return { events, t };
  }

  for (const replacedSelection of [true, false]) {
    const { events, t } = run(replacedSelection);
    const label = `replacedSelection: ${replacedSelection}`;
    assert.deepEqual(events.map((e) => e.state), ['start', 'insert', 'correct', 'submit'],
      `${label} — a correction is classified 'correct' regardless of selection visibility, never 'move'`);
    assert.equal(t.correction_count, 1, label);
    assert.equal(t.edit_event_count, 2, `${label} — the correction is an edit even at net-zero graphemes`);
    assert.equal(t.r_burst_count, 1, `${label} — the correction closes the 5-grapheme burst as an R-burst`);
    assert.equal(t.p_burst_count, 0, `${label} — nothing was typed after the correction, so no trailing P-burst`);
    assert.equal(t.r_burst_mean_graphemes, 5, label);
    assert.equal(t.mean_burst_graphemes, 5, label);
    assert.equal(t.revision_distance_mean, 3, `${label} — caret 2 in a 5-grapheme document = 3 back from the end`);
    assert.deepEqual(t.revision_locations.map((entry) => entry.op), ['insert', 'correct'], label);
  }
}

console.log('typing-aggregator.test.js passed');
