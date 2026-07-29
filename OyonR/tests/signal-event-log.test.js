// SignalEventLog is the complete, ordered, per-event log behind every
// modality's discrete state stream (audio_text.md §3.6). These tests cover
// the validation contract, the ring buffer's drop signal, and the two
// TNA-facing accessors (`toLongFormat`, `toSequences`) — in particular that
// `toSequences` orders by `sequence_index`, never wall-clock `timestamp`,
// and never fabricates a transition across a grouping boundary.
import assert from 'node:assert/strict';
import { SignalEventLog } from '../src/logging/SignalEventLog.js';

function makeLog(options = {}) {
  let clock = 1000;
  let monotonic = 0;
  return new SignalEventLog({
    now: () => clock,
    monotonicNow: () => monotonic,
    idFactory: (() => {
      let n = 0;
      return () => `evt_${n++}`;
    })(),
    ...options,
  });
}

// --- sequence_index monotonicity -------------------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  const e0 = log.record({ modality: 'typing', state: 'start' });
  const e1 = log.record({ modality: 'typing', state: 'insert' });
  const e2 = log.record({ modality: 'typing', state: 'insert' });
  assert.equal(e0.sequence_index, 0);
  assert.equal(e1.sequence_index, 1);
  assert.equal(e2.sequence_index, 2);
}

// --- record-before-start throws ---------------------------------------------------
{
  const log = makeLog();
  assert.throws(
    () => log.record({ modality: 'typing', state: 'start' }),
    /before start/,
  );
}

// --- unknown modality throws with a useful message ---------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  assert.throws(
    () => log.record({ modality: 'nonsense', state: 'whatever' }),
    /unknown modality "nonsense"/,
  );
}

// --- unknown state throws with a useful message -------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  assert.throws(
    () => log.record({ modality: 'typing', state: 'not_a_real_state' }),
    /unknown state "not_a_real_state" for modality "typing"/,
  );
}

// --- unknown source throws with a useful message ------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  assert.throws(
    () => log.record({ modality: 'typing', state: 'insert', source: 'robot' }),
    /unknown source "robot"/,
  );
}

// --- state_vocabulary stamped correctly per modality --------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  const typingEvent = log.record({ modality: 'typing', state: 'insert' });
  const interactionEvent = log.record({ modality: 'interaction', state: 'click' });
  const aiEvent = log.record({ modality: 'ai_assist', state: 'suggestion_shown' });
  assert.equal(typingEvent.state_vocabulary, 'typing-states-v1');
  assert.equal(interactionEvent.state_vocabulary, 'interaction-states-v1');
  assert.equal(aiEvent.state_vocabulary, 'ai-assist-states-v1');
}

// --- ring buffer drops oldest, keeps counting sequence_index, reports droppedEvents --
{
  const log = makeLog({ maxEvents: 3 });
  log.start({ capture_id: 'c1', session_id: 's1' });
  for (let i = 0; i < 5; i += 1) {
    log.record({ modality: 'typing', state: 'insert' });
  }
  assert.equal(log.size, 3);
  assert.equal(log.droppedEvents, 2);
  const remaining = log.all();
  // Oldest two (sequence_index 0, 1) were dropped; 2, 3, 4 remain, monotonic.
  assert.deepEqual(remaining.map((e) => e.sequence_index), [2, 3, 4]);
}

// --- onEvent fires for every stored event -------------------------------------------
{
  const seen = [];
  const log = makeLog({ onEvent: (event) => seen.push(event) });
  log.start({ capture_id: 'c1', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start' });
  log.record({ modality: 'typing', state: 'submit' });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].state, 'start');
  assert.equal(seen[1].state, 'submit');
}

// --- drain clears the buffer; all() does not ----------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start' });
  log.record({ modality: 'typing', state: 'insert' });

  const kept = log.all();
  assert.equal(kept.length, 2);
  assert.equal(log.size, 2, 'all() must not clear the buffer');

  const drained = log.drain();
  assert.equal(drained.length, 2);
  assert.equal(log.size, 0, 'drain() must clear the buffer');
  assert.deepEqual(log.all(), []);
}

// --- toLongFormat row shape -----------------------------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start', source: 'user' });
  const rows = log.toLongFormat();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(Object.keys(row).sort(), [
    'actor',
    'modality',
    'monotonic_ms',
    'sequence_index',
    'session_id',
    'source',
    'state',
    'timestamp',
  ]);
  assert.equal(row.session_id, 's1');
  assert.equal(row.actor, 's1');
  assert.equal(row.sequence_index, 0);
  assert.equal(row.state, 'start');
  assert.equal(row.modality, 'typing');
  assert.equal(row.source, 'user');
}

// --- toLongFormat actorKey selects a different stored field --------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'capture-42', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start' });
  const rows = log.toLongFormat({ actorKey: 'capture_id' });
  assert.equal(rows[0].actor, 'capture-42');
}

// --- toSequences orders by sequence_index, not timestamp (shuffled/non-monotonic) ----
{
  // This is the bug the design guards against: a tab suspend can make
  // wall-clock timestamps arrive out of order relative to when events were
  // actually produced. sequence_index is assigned by record() call order and
  // must be what toSequences() trusts, even when timestamps disagree.
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  const shuffledTimestamps = [5000, 1000, 9000, 2000];
  const states = ['start', 'insert', 'delete', 'submit'];
  states.forEach((state, i) => {
    log.record({ modality: 'typing', state, timestamp: shuffledTimestamps[i] });
  });
  const sequences = log.toSequences();
  assert.equal(sequences.length, 1);
  assert.deepEqual(sequences[0], states, 'must follow sequence_index order, not timestamp order');
}

// --- toSequences groups without fabricating cross-group transitions ------------------
// `groupBy` works over any stored per-event field. Use `source` here (a real,
// per-record field — unlike `session_id`, which is fixed for the life of one
// `start()` context) so the events genuinely interleave in raw insertion
// order: user, user, ai, user, user. `paste` is recorded ONLY on the lone ai
// event, so it is a unique marker: if grouping fabricated a transition across
// the ai/user boundary (i.e. treated the events as one pooled chain), `paste`
// would show up adjacent to another state inside a chain. Correct grouping
// isolates it into its own single-state chain instead.
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start', source: 'user' });
  log.record({ modality: 'typing', state: 'insert', source: 'user' });
  log.record({ modality: 'typing', state: 'paste', source: 'ai' });
  log.record({ modality: 'typing', state: 'pause', source: 'user' });
  log.record({ modality: 'typing', state: 'submit', source: 'user' });

  const sequences = log.toSequences({ groupBy: 'source' });
  assert.equal(sequences.length, 2, 'must produce one chain per group, not one pooled chain');

  const pasteChain = sequences.find((seq) => seq.includes('paste'));
  assert.deepEqual(pasteChain, ['paste'], 'the ai-only event must be isolated, not adjacent to any user state');

  const userChain = sequences.find((seq) => seq !== pasteChain);
  assert.deepEqual(
    userChain,
    ['start', 'insert', 'pause', 'submit'],
    'the user chain must skip the interleaved ai event entirely, not just relabel it',
  );
}

// --- modality filtering ---------------------------------------------------------------
{
  const log = makeLog();
  log.start({ capture_id: 'c1', session_id: 's1' });
  log.record({ modality: 'typing', state: 'start' });
  log.record({ modality: 'interaction', state: 'click' });
  log.record({ modality: 'typing', state: 'submit' });
  log.record({ modality: 'interaction', state: 'scroll_down' });

  const typingOnly = log.toSequences({ modality: 'typing' });
  assert.equal(typingOnly.length, 1);
  assert.deepEqual(typingOnly[0], ['start', 'submit']);

  const interactionOnly = log.toSequences({ modality: 'interaction' });
  assert.equal(interactionOnly.length, 1);
  assert.deepEqual(interactionOnly[0], ['click', 'scroll_down']);
}

console.log('signal-event-log.test.js passed');
