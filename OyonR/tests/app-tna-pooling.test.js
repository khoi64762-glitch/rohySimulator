// Per-session TNA pooling (standalone/app/src/lib/tnaPooling.js):
// aggregating DISTINCT sessions must not fabricate a transition between one
// session's last state and the next session's first state.

import assert from 'node:assert/strict';
import {
  buildSessionSequences,
  buildEventSequences,
  pooledTransitionCounts,
} from '../standalone/app/src/lib/tnaPooling.js';

const w = (session, emotion, end) => ({
  session_id: session,
  dominant_emotion: emotion,
  window_end: end,
});

// Session A ends in 'sad'; session B begins with 'happy'. A mega-sequence
// would count a phantom sad→happy transition; per-session chains must not.
const WINDOWS = [
  w('A', 'neutral', '2026-06-11T10:00:10Z'),
  w('A', 'happy', '2026-06-11T10:00:20Z'),
  w('A', 'sad', '2026-06-11T10:00:30Z'),
  w('B', 'happy', '2026-06-11T11:00:10Z'),
  w('B', 'happy', '2026-06-11T11:00:20Z'),
  w('B', 'sad', '2026-06-11T11:00:30Z'),
];

// ─── chains are per-session and time-ordered ──────────────────────────────
const sequences = buildSessionSequences(WINDOWS);
assert.equal(sequences.length, 2);
assert.deepEqual(sequences[0], ['neutral', 'happy', 'sad']);
assert.deepEqual(sequences[1], ['happy', 'happy', 'sad']);

// Out-of-order input is sorted within each session.
const shuffled = buildSessionSequences([WINDOWS[2], WINDOWS[5], WINDOWS[0], WINDOWS[3], WINDOWS[1], WINDOWS[4]]);
assert.deepEqual(shuffled.find((s) => s[0] === 'neutral'), ['neutral', 'happy', 'sad']);

// ─── pooled counts: no cross-session phantom ──────────────────────────────
const counts = pooledTransitionCounts(sequences);
assert.equal(counts.get('sad→happy'), undefined, 'phantom cross-session transition!');
assert.equal(counts.get('neutral→happy'), 1);
assert.equal(counts.get('happy→sad'), 2); // once per session, pooled
assert.equal(counts.get('happy→happy'), 1);
// Total transitions = (3-1) + (3-1) = 4, not 5 (mega-sequence would give 5).
let total = 0;
for (const n of counts.values()) total += n;
assert.equal(total, 4);

// ─── normalization mirrors dashboard.js ───────────────────────────────────
const norm = buildSessionSequences([w('X', 'Very Happy', '2026-06-11T10:00:00Z'), w('X', null, '2026-06-11T10:00:10Z')]);
assert.deepEqual(norm, [['very-happy', 'insufficient']]);

// ─── single window / empty input ──────────────────────────────────────────
assert.deepEqual(buildSessionSequences([]), []);
assert.deepEqual(buildSessionSequences([w('only', 'happy', '2026-06-11T10:00:00Z')]), [['happy']]);
assert.equal(pooledTransitionCounts([['happy']]).size, 0);

// ─── buildEventSequences: signal-event log → per-channel chains ──────────
// (standalone/app/src/lib/tnaPooling.js buildEventSequences, wired into
// routes/analyze/sequence.tsx and components/patterns/PatternsPanel.tsx)

const e = (session, capture, modality, state, seq) => ({
  session_id: session,
  capture_id: capture,
  modality,
  state,
  sequence_index: seq,
});

// Two captures inside ONE session. `sequence_index` restarts at 0 for each
// capture (SignalEventLog.start() resets it), so grouping by session alone
// would sort capture2's low indices into capture1's chain and fabricate a
// transition between two unrelated captures. Grouping by session+capture_id
// must keep them as TWO separate chains, never one joined chain.
const captureEvents = [
  e('S', 'cap1', 'typing', 'insert', 0),
  e('S', 'cap1', 'typing', 'pause', 1),
  e('S', 'cap1', 'typing', 'submit', 2),
  e('S', 'cap2', 'typing', 'insert', 0),
  e('S', 'cap2', 'typing', 'delete', 1),
];
const captureSeqs = buildEventSequences(captureEvents, 'typing');
assert.equal(captureSeqs.length, 2, 'two captures in one session must produce TWO chains');
assert.deepEqual(captureSeqs.find((s) => s.length === 3), ['insert', 'pause', 'submit']);
assert.deepEqual(captureSeqs.find((s) => s.length === 2), ['insert', 'delete']);
// A mega-sequence bug would produce one 5-long chain instead of 3+2.
assert.ok(captureSeqs.every((s) => s.length < 5), 'captures must not be joined end-to-end');

// ─── buildEventSequences: modality filtering ──────────────────────────────
const mixedEvents = [
  e('S2', 'capA', 'typing', 'insert', 0),
  e('S2', 'capA', 'discourse', 'question', 1),
  e('S2', 'capA', 'typing', 'delete', 2),
  e('S2', 'capA', 'discourse', 'statement', 3),
];
const typingOnly = buildEventSequences(mixedEvents, 'typing');
assert.equal(typingOnly.length, 1);
assert.deepEqual(typingOnly[0], ['insert', 'delete']);

const discourseOnly = buildEventSequences(mixedEvents, 'discourse');
assert.equal(discourseOnly.length, 1);
assert.deepEqual(discourseOnly[0], ['question', 'statement']);

// ─── buildEventSequences: interleaved all-channel ordering ────────────────
// modality === null (the 'all channels' selection) interleaves every
// modality on one timeline, ordered by sequence_index — never grouped by
// modality first.
const allChannels = buildEventSequences(mixedEvents, null);
assert.equal(allChannels.length, 1);
assert.deepEqual(
  allChannels[0],
  ['insert', 'question', 'delete', 'statement'],
  'all-channel chain must be ordered by sequence_index, interleaving modalities',
);

// Out-of-order input still sorts by sequence_index within the group.
const shuffledMixed = [mixedEvents[3], mixedEvents[0], mixedEvents[2], mixedEvents[1]];
assert.deepEqual(buildEventSequences(shuffledMixed, null)[0], ['insert', 'question', 'delete', 'statement']);

// ─── empty input ────────────────────────────────────────────────────────────
assert.deepEqual(buildEventSequences([]), []);
assert.deepEqual(buildEventSequences([], 'typing'), []);

console.log('app-tna-pooling.test.js — all cases passed');
