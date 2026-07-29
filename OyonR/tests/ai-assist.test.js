// Tests for the ai_assist modality — the host-fed AI-suggestion cycle
// (audio_text.md §4.10, docs/AI_ASSIST.md). Covers `createAiAssistTracker`
// (per-method state/source, latency measurement, the forbidden-text-field
// throw), `AiAssistAggregator` (hand-computed metrics), the validator, and a
// full round trip through `SignalEventLog` -> `toSequences()`.
import assert from 'node:assert/strict';
import { createAiAssistTracker } from '../src/capture/AiAssistTracker.js';
import { AiAssistAggregator } from '../src/aggregation/AiAssistAggregator.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';
import { OYON_AI_ASSIST_STATES } from '../src/version.js';

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    set: (value) => { t = value; },
    advance: (delta) => { t += delta; },
  };
}

// ---------- A. Each method emits the right state with the right source ----------
{
  const events = [];
  const clock = makeClock();
  const tracker = createAiAssistTracker({
    onEvent: (e) => events.push(e),
    now: clock.now,
    wallClockNow: () => 5000,
  });

  tracker.requested({ suggestion_id: 's1', model: 'gpt-test' });
  tracker.shown({ suggestion_id: 's1', options_shown: 2, model: 'gpt-test' });
  tracker.accepted({ suggestion_id: 's1', chosen_index: 0, accepted_graphemes: 10, model: 'gpt-test' });
  tracker.rejected({ suggestion_id: 's2', chosen_index: null, model: 'gpt-test' });
  tracker.dismissed({ suggestion_id: 's3', model: 'gpt-test' });
  tracker.aiTurnStart({ model: 'gpt-test' });
  tracker.aiTurnEnd({ model: 'gpt-test' });

  assert.equal(events.length, 7);
  const expected = [
    ['suggestion_request', 'ai'],
    ['suggestion_shown', 'ai'],
    ['suggestion_accept', 'user'],
    ['suggestion_reject', 'user'],
    ['suggestion_dismiss', 'user'],
    ['ai_turn_start', 'ai'],
    ['ai_turn_end', 'ai'],
  ];
  events.forEach((event, i) => {
    assert.equal(event.state, expected[i][0], `event ${i} state`);
    assert.equal(event.source, expected[i][1], `event ${i} source (${event.state})`);
    assert.equal(event.modality, 'ai_assist');
    assert.equal(event.timestamp, 5000, 'wallClockNow used for timestamp');
    assert.ok(OYON_AI_ASSIST_STATES.includes(event.state), 'state is in the closed vocabulary');
  });

  // Every recognized state actually got exercised above — a coverage guard
  // against the vocabulary drifting without a matching tracker method.
  assert.deepEqual(
    [...new Set(events.map((e) => e.state))].sort(),
    [...OYON_AI_ASSIST_STATES].sort(),
  );
}

// ---------- B. Latency is measured across request -> shown ----------
{
  const clock = makeClock(0);
  const tracker = createAiAssistTracker({ now: clock.now, wallClockNow: clock.now });

  clock.set(1000);
  tracker.requested({ suggestion_id: 'lat-1' });
  clock.set(1075);
  const shownEvent = tracker.shown({ suggestion_id: 'lat-1' });
  assert.equal(shownEvent.detail.latency_ms, 75, 'latency = shown time - requested time');
}

// ---------- C. shown() with no matching request() -> latency null, not a throw ----------
{
  const tracker = createAiAssistTracker();
  let shownEvent;
  assert.doesNotThrow(() => {
    shownEvent = tracker.shown({ suggestion_id: 'never-requested' });
  });
  assert.equal(shownEvent.detail.latency_ms, null);

  // Same for a shown() with no suggestion_id at all.
  let shownNoId;
  assert.doesNotThrow(() => { shownNoId = tracker.shown({}); });
  assert.equal(shownNoId.detail.latency_ms, null);
}

// ---------- D. A text-bearing descriptor throws, naming the field ----------
{
  const tracker = createAiAssistTracker();
  assert.throws(
    () => tracker.accepted({ suggestion_id: 's1', text: 'the AI wrote this' }),
    /"text"/,
    'must name the offending field',
  );
  assert.throws(() => tracker.shown({ suggestion_id: 's1', content: 'nope' }), /"content"/);
  assert.throws(() => tracker.requested({ suggestion: 'nope' }), /"suggestion"/);
  assert.throws(() => tracker.rejected({ suggestion_id: 's1', body: 'nope' }), /"body"/);
  assert.throws(() => tracker.dismissed({ text: 'nope' }), /"text"/);
  assert.throws(() => tracker.aiTurnStart({ text: 'nope' }), /"text"/);
  assert.throws(() => tracker.aiTurnEnd({ content: 'nope' }), /"content"/);

  // Legitimate fields must still work after a rejected call — the tracker
  // must not be left in some half-broken state by the throw.
  assert.doesNotThrow(() => tracker.accepted({ suggestion_id: 's1', chosen_index: 0, accepted_graphemes: 5 }));
}

// ---------- E. dispose() stops emission; methods become safe no-ops ----------
{
  const events = [];
  const tracker = createAiAssistTracker({ onEvent: (e) => events.push(e) });
  assert.equal(tracker.active, true);
  tracker.requested({ suggestion_id: 's1' });
  assert.equal(events.length, 1);

  tracker.dispose();
  assert.equal(tracker.active, false);
  assert.doesNotThrow(() => tracker.requested({ suggestion_id: 's2' }));
  assert.doesNotThrow(() => tracker.shown({ suggestion_id: 's2' }));
  assert.equal(events.length, 1, 'no further events after dispose()');
  assert.doesNotThrow(() => tracker.dispose(), 'dispose() is idempotent');
}

// ---------- F. AiAssistAggregator: acceptance_rate is null (not 0) when shown_count is 0 ----------
{
  const agg = new AiAssistAggregator({ now: () => 1000 });
  agg.start({ timestamp: 0 });
  agg.record({ modality: 'ai_assist', state: 'suggestion_request', source: 'ai', monotonic_ms: 0, detail: { suggestion_id: 's1', model: null } });
  const win = agg.finalize({ timestamp: 10 });
  assert.equal(win.ai_assist.shown_count, 0);
  assert.equal(win.ai_assist.accept_count, 0);
  assert.equal(win.ai_assist.acceptance_rate, null, 'null, not 0, when nothing was shown');
  assert.equal(win.ai_assist.mean_latency_ms, null);
  assert.equal(win.ai_assist.median_latency_ms, null);
  assert.equal(win.ai_assist.mean_accepted_graphemes, null);
  assert.deepEqual(win.ai_assist.chosen_index_counts, {});
}

// ---------- G. Hand-computed window over a designed tracker+aggregator sequence ----------
//
// requests: s1, s2, s3, s4 (4)
// shown:    s1 @ latency 20, s2 @ latency 40, s3 @ latency 60, plus one
//           unmatched shown() with an unknown id (latency null) -> shown_count = 4
// accept:   s1 (chosen_index 0, 100 graphemes), s2 (chosen_index 0, 50 graphemes),
//           s3 (chosen_index 2, 30 graphemes) -> accept_count = 3
// reject:   s4 (chosen_index null) -> reject_count = 1
// dismiss:  none -> dismiss_count = 0
// ai turns: [500 -> 650] (150ms), [700 -> 900] (200ms) -> ai_turn_count = 2, total = 350ms
{
  const clock = makeClock(0);
  const events = [];
  const tracker = createAiAssistTracker({ onEvent: (e) => events.push(e), now: clock.now, wallClockNow: () => 0 });

  clock.set(0); tracker.requested({ suggestion_id: 's1', model: 'm' });
  clock.set(20); tracker.shown({ suggestion_id: 's1', options_shown: 3, model: 'm' });
  tracker.accepted({ suggestion_id: 's1', chosen_index: 0, accepted_graphemes: 100, model: 'm' });

  clock.set(100); tracker.requested({ suggestion_id: 's2', model: 'm' });
  clock.set(140); tracker.shown({ suggestion_id: 's2', options_shown: 2, model: 'm' }); // latency 40
  tracker.accepted({ suggestion_id: 's2', chosen_index: 0, accepted_graphemes: 50, model: 'm' });

  clock.set(200); tracker.requested({ suggestion_id: 's3', model: 'm' });
  clock.set(260); tracker.shown({ suggestion_id: 's3', options_shown: 4, model: 'm' }); // latency 60
  tracker.accepted({ suggestion_id: 's3', chosen_index: 2, accepted_graphemes: 30, model: 'm' });

  clock.set(300); tracker.requested({ suggestion_id: 's4', model: 'm' });
  tracker.rejected({ suggestion_id: 's4', chosen_index: null, model: 'm' });

  // An unmatched shown() — no requested() call for this id.
  tracker.shown({ suggestion_id: 'ghost', options_shown: 1, model: 'm' });

  const agg = new AiAssistAggregator({ now: () => 999_000 });
  agg.start({ timestamp: 0 });
  for (const event of events) agg.record(event);

  // AI turns, recorded directly (monotonic_ms drives the duration math).
  agg.record({ modality: 'ai_assist', state: 'ai_turn_start', source: 'ai', monotonic_ms: 500, detail: { model: 'm' } });
  agg.record({ modality: 'ai_assist', state: 'ai_turn_end', source: 'ai', monotonic_ms: 650, detail: { model: 'm' } });
  agg.record({ modality: 'ai_assist', state: 'ai_turn_start', source: 'ai', monotonic_ms: 700, detail: { model: 'm' } });
  agg.record({ modality: 'ai_assist', state: 'ai_turn_end', source: 'ai', monotonic_ms: 900, detail: { model: 'm' } });

  const win = agg.finalize({ timestamp: 1000 });

  assert.equal(win.modality, 'ai_assist');
  assert.equal(win.window_kind, 'interval');
  assert.equal(win.feature_profile, 'ai-assist-v1');

  const a = win.ai_assist;
  assert.equal(a.request_count, 4);
  assert.equal(a.shown_count, 4, '3 matched + 1 unmatched (ghost)');
  assert.equal(a.accept_count, 3);
  assert.equal(a.reject_count, 1);
  assert.equal(a.dismiss_count, 0);
  assert.equal(a.acceptance_rate, 3 / 4);
  assert.equal(a.mean_latency_ms, (20 + 40 + 60) / 3, 'mean of the 3 measured latencies (ghost excluded)');
  assert.equal(a.median_latency_ms, 40, 'median of [20, 40, 60]');
  assert.equal(a.accepted_graphemes_total, 100 + 50 + 30);
  assert.equal(a.mean_accepted_graphemes, (100 + 50 + 30) / 3);
  assert.deepEqual(a.chosen_index_counts, { '0': 2, '2': 1 }, 's1+s2 chose index 0, s3 chose index 2');
  assert.equal(a.ai_turn_count, 2);
  assert.equal(a.ai_turn_total_ms, 150 + 200);
  assert.equal(a.ai_authored_graphemes, a.accepted_graphemes_total, 'ai_authored_graphemes mirrors accepted_graphemes_total');

  assert.equal(win.quality.unmatched_shown_count, 1, 'the ghost shown()');
  assert.equal(win.quality.unmatched_turn_end_count, 0);
  assert.equal(win.quality.open_ai_turns_closed_at_finalize, 0, 'both turns closed explicitly');
  assert.equal(win.quality.chosen_index_counts_truncated, false);

  // ---------- H. The finalized window must validate cleanly ----------
  assert.deepEqual(validateEmotionEvent(win, 0), []);
}

// ---------- I. An open AI turn at finalize() closes against the finalize timestamp ----------
{
  const agg = new AiAssistAggregator({ now: () => 1 });
  agg.start({ timestamp: 0 });
  agg.record({ modality: 'ai_assist', state: 'ai_turn_start', source: 'ai', monotonic_ms: 100, detail: { model: null } });
  const win = agg.finalize({ timestamp: 350 });
  assert.equal(win.ai_assist.ai_turn_count, 1);
  assert.equal(win.ai_assist.ai_turn_total_ms, 250, 'closed against the finalize timestamp: 350 - 100');
  assert.equal(win.quality.open_ai_turns_closed_at_finalize, 1);
}

// ---------- J. A stray ai_turn_end (nothing open) is counted, not thrown ----------
{
  const agg = new AiAssistAggregator({ now: () => 1 });
  agg.start({ timestamp: 0 });
  agg.record({ modality: 'ai_assist', state: 'ai_turn_end', source: 'ai', monotonic_ms: 100, detail: { model: null } });
  const win = agg.finalize({ timestamp: 200 });
  assert.equal(win.ai_assist.ai_turn_total_ms, 0);
  assert.equal(win.quality.unmatched_turn_end_count, 1);
}

// ---------- K. record()/finalize() are no-ops when not started ----------
{
  const agg = new AiAssistAggregator();
  assert.equal(agg.active, false);
  assert.doesNotThrow(() => agg.record({ modality: 'ai_assist', state: 'suggestion_request', detail: {} }));
  assert.equal(agg.finalize({ timestamp: 0 }), null);
}

// ---------- L. validateEmotionEvent rejects a text-bearing ai_assist block ----------
{
  const win = {
    modality: 'ai_assist',
    window_kind: 'interval',
    feature_profile: 'ai-assist-v1',
    window_start: new Date(0).toISOString(),
    window_end: new Date(1).toISOString(),
    ai_assist: {
      request_count: 1,
      shown_count: 1,
      accept_count: 1,
      reject_count: 0,
      dismiss_count: 0,
      acceptance_rate: 1,
      mean_latency_ms: 10,
      median_latency_ms: 10,
      accepted_graphemes_total: 5,
      mean_accepted_graphemes: 5,
      ai_turn_count: 0,
      ai_turn_total_ms: 0,
      chosen_index_counts: { 0: 1 },
      ai_authored_graphemes: 5,
      text: 'the suggestion text, which must never appear here',
    },
    quality: {
      unmatched_shown_count: 0,
      unmatched_turn_end_count: 0,
      open_ai_turns_closed_at_finalize: 0,
      chosen_index_counts_truncated: false,
    },
  };
  const errors = validateEmotionEvent(win, 0);
  assert.ok(errors.some((e) => /ai_assist\.text is forbidden/.test(e)), `expected a forbidden-text error, got: ${errors}`);
}

// ---------- M. validateEmotionEvent rejects out-of-range ai_assist fields ----------
{
  const win = {
    modality: 'ai_assist',
    window_kind: 'interval',
    feature_profile: 'ai-assist-v1',
    window_start: new Date(0).toISOString(),
    window_end: new Date(1).toISOString(),
    ai_assist: {
      request_count: -1,
      acceptance_rate: 1.5,
      mean_latency_ms: -10,
      chosen_index_counts: { not_an_index: 1 },
    },
    quality: {},
  };
  const errors = validateEmotionEvent(win, 0);
  assert.ok(errors.some((e) => e.includes('request_count')));
  assert.ok(errors.some((e) => e.includes('acceptance_rate')));
  assert.ok(errors.some((e) => e.includes('mean_latency_ms')));
  assert.ok(errors.some((e) => e.includes('chosen_index_counts')));
}

// ---------- N. Full round trip: tracker -> SignalEventLog -> toSequences({ modality: 'ai_assist' }) ----------
{
  const log = new SignalEventLog({ now: () => 2_000_000, monotonicNow: () => 0 });
  log.start({ capture_id: 'cap-ai', session_id: 'sess-ai' });

  const clock = makeClock(0);
  const tracker = createAiAssistTracker({
    now: clock.now,
    wallClockNow: () => 2_000_000,
    onEvent: (event) => log.record(event),
  });

  const target = { kind: 'chat_composer', id: 'composer-ai-1' };
  tracker.requested({ suggestion_id: 'rt-1', model: 'm' });
  clock.advance(15);
  tracker.shown({ suggestion_id: 'rt-1', options_shown: 1, model: 'm' });
  tracker.accepted({ suggestion_id: 'rt-1', chosen_index: 0, accepted_graphemes: 12, model: 'm' });
  tracker.aiTurnStart({ model: 'm' });
  tracker.aiTurnEnd({ model: 'm' });

  assert.equal(log.size, 5);
  assert.equal(log.droppedEvents, 0);

  const sequences = log.toSequences({ modality: 'ai_assist' });
  assert.equal(sequences.length, 1, 'one grouping key (session_id) -> one chain');
  assert.deepEqual(sequences[0], [
    'suggestion_request',
    'suggestion_shown',
    'suggestion_accept',
    'ai_turn_start',
    'ai_turn_end',
  ]);

  // A mixed-modality log still isolates the ai_assist chain correctly.
  log.record({ modality: 'typing', state: 'start', source: 'user', target });
  log.record({ modality: 'typing', state: 'submit', source: 'user', target });
  const mixedAiOnly = log.toSequences({ modality: 'ai_assist' });
  assert.equal(mixedAiOnly.length, 1);
  assert.deepEqual(mixedAiOnly[0], sequences[0]);

  const typingOnly = log.toSequences({ modality: 'typing' });
  assert.equal(typingOnly.length, 1);
  assert.deepEqual(typingOnly[0], ['start', 'submit']);

  // Every stored ai_assist event carries the right modality/state_vocabulary/source.
  const aiRows = log.all().filter((e) => e.modality === 'ai_assist');
  assert.equal(aiRows.length, 5);
  assert.ok(aiRows.every((e) => e.state_vocabulary === 'ai-assist-states-v1'));
  assert.deepEqual(aiRows.map((e) => e.source), ['ai', 'ai', 'user', 'ai', 'ai']);
}

console.log('ai-assist.test.js passed');
