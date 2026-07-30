import type { IdbStoreRuntime } from '@/lib/idbTransport';

/*
 * Batched writer for `signal_events` rows into the app's IndexedDB database.
 *
 * This is a TypeScript mirror of the library's
 * `createSignalEventPersistence` (src/storage/SignalEventStore.js) with the
 * same semantics: batch writes (a keystroke-rate stream must not open one
 * IDB transaction per character), flush on a size threshold or a trailing
 * timer, and NEVER re-queue a failed batch (a batch that failed once — quota,
 * closing tab — will usually fail again; a reported loss beats an unbounded
 * retry buffer).
 *
 * Why a mirror and not an import: `SignalEventStore.js` is not exported from
 * the `oyon` main entry nor from any subpath the app's aliases resolve
 * (`oyon/signal-events` maps to `SignalEventLog` only). Reported upstream as
 * a packaging gap; delete this file and import the real one once it is
 * exported.
 */

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_FLUSH_MS = 2000;
const STORE_NAME = 'signal_events';

export interface SignalEventBatcher {
  /** Queue one event row (the shape `SignalEventLog` emits via `onEvent`). */
  write(event: unknown): void;
  /** Write everything queued now; resolves to the number of rows written. */
  flush(): Promise<number>;
  /** Final flush, then reject all further writes. Safe to call twice. */
  dispose(): Promise<void>;
  readonly pendingCount: number;
  readonly writtenCount: number;
  readonly failedCount: number;
}

export function createSignalEventBatcher(options: {
  store: IdbStoreRuntime;
  storeName?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  onError?: (error: unknown, batch: unknown[]) => void;
}): SignalEventBatcher {
  const {
    store,
    storeName = STORE_NAME,
    batchSize = DEFAULT_BATCH_SIZE,
    flushIntervalMs = DEFAULT_FLUSH_MS,
    onError,
  } = options;

  let pending: unknown[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let written = 0;
  let failed = 0;

  function scheduleFlush(): void {
    if (timer !== null || disposed) return;
    timer = setTimeout(() => {
      timer = null;
      flush().catch(() => { /* reported via onError */ });
    }, flushIntervalMs);
  }

  async function flush(): Promise<number> {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length === 0) return 0;
    const batch = pending;
    pending = [];
    try {
      await store.bulkAdd(storeName, batch);
      written += batch.length;
      return batch.length;
    } catch (error) {
      failed += batch.length;
      onError?.(error, batch);
      return 0;
    }
  }

  function write(event: unknown): void {
    if (disposed || !event) return;
    pending.push(event);
    if (pending.length >= batchSize) {
      flush().catch(() => { /* reported via onError */ });
    } else {
      scheduleFlush();
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    await flush();
    disposed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
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
