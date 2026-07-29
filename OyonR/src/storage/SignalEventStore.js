/**
 * Persists the signal event log to IndexedDB.
 *
 * The bridge between `SignalEventLog` (in-memory, ordered) and the
 * `signal_events` store. Writes are BATCHED: a keystroke-rate stream would
 * otherwise open one IndexedDB transaction per character, which is both slow
 * and a reliable way to drop events when a tab is closing.
 *
 * Attach it to any emitter that produces log events:
 *
 *   const store = new IndexedDbOyonStore();
 *   const persist = createSignalEventPersistence({ store });
 *   const log = new SignalEventLog({ onEvent: persist.write });
 *   ...
 *   await persist.flush();   // on submit / teardown
 */

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_MS = 2000;

export function createSignalEventPersistence(options = {}) {
  const {
    store,
    storeName = 'signal_events',
    batchSize = DEFAULT_BATCH_SIZE,
    flushIntervalMs = DEFAULT_FLUSH_MS,
    onError = null,
    setTimerFn = (fn, ms) => setTimeout(fn, ms),
    clearTimerFn = (id) => clearTimeout(id),
  } = options;

  if (!store) throw new Error('createSignalEventPersistence requires a store.');

  let pending = [];
  let timer = null;
  let disposed = false;
  let disposePromise = null;
  let written = 0;
  let failed = 0;

  function scheduleFlush() {
    if (timer !== null || disposed) return;
    timer = setTimerFn(() => {
      timer = null;
      flush().catch(() => { /* reported via onError */ });
    }, flushIntervalMs);
  }

  async function flush() {
    if (timer !== null) { clearTimerFn(timer); timer = null; }
    if (pending.length === 0) return 0;
    const batch = pending;
    pending = [];
    try {
      await store.bulkAdd(storeName, batch);
      written += batch.length;
      return batch.length;
    } catch (error) {
      failed += batch.length;
      // Do NOT re-queue: a batch that failed once (quota, closing tab) will
      // usually fail again, and an unbounded retry buffer is worse than a
      // reported loss. Surface it so the caller can decide.
      onError?.(error, batch);
      return 0;
    }
  }

  function write(event) {
    if (!event) return;
    if (disposed) {
      // Never a silent drop: an event that can no longer be persisted is a
      // reported loss, exactly like a failed batch.
      failed += 1;
      onError?.(new Error('SignalEventPersistence: write() after dispose() — event not persisted'), [event]);
      return;
    }
    pending.push(event);
    if (pending.length >= batchSize) {
      flush().catch(() => { /* reported via onError */ });
    } else {
      scheduleFlush();
    }
  }

  /**
   * Drain-then-close. Flushes REPEATEDLY until the queue is empty: an event
   * written while a flush is awaiting its store transaction (typical for
   * terminal events emitted during teardown) lands in a fresh `pending`
   * array, and a single flush would strand it unwritten forever. `disposed`
   * flips synchronously after the final emptiness check, so every event
   * either rode a flush or arrives after `disposed` and is surfaced through
   * `onError` by write() — no silent-loss window in between. Idempotent:
   * every caller awaits the same completion.
   */
  function dispose() {
    if (!disposePromise) disposePromise = drainAndClose();
    return disposePromise;
  }

  async function drainAndClose() {
    while (pending.length > 0) {
      await flush();
    }
    disposed = true;
    if (timer !== null) { clearTimerFn(timer); timer = null; }
  }

  return {
    write,
    flush,
    dispose,
    get pendingCount() { return pending.length; },
    get writtenCount() { return written; },
    get failedCount() { return failed; },
  };
}

/** Read events back for analysis, newest-last, optionally scoped. */
export async function readSignalEvents(store, options = {}) {
  const rows = await store.getAll(options.storeName || 'signal_events');
  const { session_id: sessionId, capture_id: captureId, modality } = options;
  return rows
    .filter((row) => (sessionId ? row.session_id === sessionId : true))
    .filter((row) => (captureId ? row.capture_id === captureId : true))
    .filter((row) => (modality ? row.modality === modality : true))
    .sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0));
}
