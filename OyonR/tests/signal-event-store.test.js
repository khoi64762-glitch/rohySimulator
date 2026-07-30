import assert from 'node:assert/strict';
import { createSignalEventPersistence, readSignalEvents } from '../src/storage/SignalEventStore.js';

/**
 * signal-event-store.test.js — the batched IndexedDB persistence bridge.
 *
 * The store is faked with a recording `bulkAdd` whose completion the test
 * controls by hand (a "gate"), so the dispose()/flush() interleavings that
 * matter — most importantly the finding-8 race where an event written WHILE
 * dispose() awaits its flush used to be silently stranded — are exercised
 * deterministically, no real IndexedDB involved.
 */

function makeGatedStore() {
  const batches = [];
  const gates = [];
  return {
    batches,
    /** Release the oldest still-blocked bulkAdd. */
    release() { gates.shift()?.(); },
    store: {
      async bulkAdd(_name, batch) {
        batches.push(batch.map((row) => row.id));
        await new Promise((resolve) => { gates.push(resolve); });
      },
      async getAll() { return []; },
    },
  };
}

/** A store that persists instantly — for the non-race coverage. */
function makeInstantStore() {
  const rows = [];
  return {
    rows,
    store: {
      async bulkAdd(_name, batch) { rows.push(...batch); },
      async getAll() { return rows; },
    },
  };
}

// ─── A — batching: writes below batchSize wait for the timer, at batchSize
// they flush immediately ──
{
  const { rows, store } = makeInstantStore();
  const timers = [];
  const persistence = createSignalEventPersistence({
    store,
    batchSize: 3,
    setTimerFn: (fn) => { timers.push(fn); return timers.length; },
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'a' });
  persistence.write({ id: 'b' });
  assert.equal(persistence.pendingCount, 2, 'below batchSize nothing flushes yet');
  assert.equal(rows.length, 0);
  persistence.write({ id: 'c' }); // hits batchSize → immediate flush
  await Promise.resolve();
  assert.equal(persistence.pendingCount, 0);
  assert.equal(rows.length, 3);
  assert.equal(persistence.writtenCount, 3);
  await persistence.dispose();
}

// ─── B — a failed batch is surfaced through onError with the batch, not
// re-queued, and counted as failed ──
{
  const failures = [];
  const persistence = createSignalEventPersistence({
    store: { async bulkAdd() { throw new Error('quota'); }, async getAll() { return []; } },
    batchSize: 1,
    onError: (error, batch) => failures.push({ message: error.message, ids: batch.map((row) => row.id) }),
    setTimerFn: () => 1,
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'x' });
  await Promise.resolve();
  assert.deepEqual(failures, [{ message: 'quota', ids: ['x'] }]);
  assert.equal(persistence.failedCount, 1);
  assert.equal(persistence.pendingCount, 0, 'a failed batch is NOT re-queued');
  await persistence.dispose();
}

// ─── C — regression (finding 8 probe): an event written while dispose()
// awaits its flush must still be persisted, not stranded forever ──
{
  const gated = makeGatedStore();
  const persistence = createSignalEventPersistence({
    store: gated.store,
    batchSize: 99,
    setTimerFn: () => 1,
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'A' });
  const disposing = persistence.dispose();
  await Promise.resolve(); // dispose is now awaiting bulkAdd(['A'])
  persistence.write({ id: 'B' }); // the terminal event of the session
  assert.equal(persistence.pendingCount, 1, 'B is queued while the A-flush is in flight');
  gated.release(); // A's bulkAdd completes…
  await new Promise((resolve) => setImmediate(resolve)); // …the drain loop reaches B's flush…
  gated.release(); // …and dispose() flushes AGAIN for B
  await disposing;
  assert.deepEqual(gated.batches, [['A'], ['B']],
    'the event written during dispose()\'s flush must reach the store');
  assert.equal(persistence.pendingCount, 0, 'nothing left stranded after dispose()');
  assert.equal(persistence.writtenCount, 2);
}

// ─── D — write() AFTER dispose() completes is a reported loss, never a
// silent drop ──
{
  const { store } = makeInstantStore();
  const losses = [];
  const persistence = createSignalEventPersistence({
    store,
    onError: (error, batch) => losses.push({ message: error.message, ids: batch.map((row) => row.id) }),
    setTimerFn: () => 1,
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'ok' });
  await persistence.dispose();
  persistence.write({ id: 'late' });
  assert.equal(losses.length, 1, 'a post-dispose write must be surfaced through onError');
  assert.match(losses[0].message, /after dispose/);
  assert.deepEqual(losses[0].ids, ['late']);
  assert.equal(persistence.failedCount, 1);
  assert.equal(persistence.pendingCount, 0);
}

// ─── E — dispose() is idempotent and race-safe: every caller awaits the
// same drain ──
{
  const gated = makeGatedStore();
  const persistence = createSignalEventPersistence({
    store: gated.store,
    setTimerFn: () => 1,
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'A' });
  const d1 = persistence.dispose();
  const d2 = persistence.dispose();
  assert.equal(d1, d2, 'concurrent dispose() calls share one completion');
  gated.release();
  await Promise.all([d1, d2]);
  assert.deepEqual(gated.batches, [['A']], 'the batch is written exactly once');
}

// ─── F — readSignalEvents filters and orders by sequence_index ──
{
  const { store } = makeInstantStore();
  const persistence = createSignalEventPersistence({
    store,
    batchSize: 1,
    setTimerFn: () => 1,
    clearTimerFn: () => {},
  });
  persistence.write({ id: 'w2', session_id: 's1', modality: 'voice', sequence_index: 2 });
  persistence.write({ id: 'w1', session_id: 's1', modality: 'voice', sequence_index: 1 });
  persistence.write({ id: 'other', session_id: 's2', modality: 'typing', sequence_index: 3 });
  await persistence.dispose();
  const rows = await readSignalEvents(store, { session_id: 's1', modality: 'voice' });
  assert.deepEqual(rows.map((row) => row.id), ['w1', 'w2']);
}

console.log('signal-event-store.test.js passed');
