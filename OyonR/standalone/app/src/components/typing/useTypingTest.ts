import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  IndexedDbOyonStore,
  SignalEventLog,
  TypingAggregator,
  createTypingComposerAdapter,
} from 'oyon';
import type {
  TypingComposerAdapter,
  TypingRecordEvent,
  TypingWindow,
} from 'oyon';
import type { IdbStoreRuntime } from '@/lib/idbTransport';
import { STORED_EVENTS_QUERY_KEY } from '@/lib/storedEvents';
import { STORED_TYPING_WINDOWS_QUERY_KEY } from '@/lib/storedTypingWindows';
import { createSignalEventBatcher, type SignalEventBatcher } from './signalEventPersistence';

/*
 * useTypingTest — wires ONE textarea to the real typing pipeline:
 *
 *   createTypingComposerAdapter → TypingAggregator → SignalEventLog
 *     → createSignalEventBatcher → IndexedDB `oyon-app`/`signal_events`
 *
 * Ported from the working vanilla harness at examples/typing/index.html.
 *
 * Live metrics use the harness's REPLAY approach: every input handed to the
 * live aggregator is also recorded, and on each event the recording is
 * replayed into a THROWAWAY probe aggregator whose finalize() produces the
 * metrics — the live episode is never finalized early. Cloning the live
 * aggregator does not work (its state is not all plain fields); replay is
 * correct by construction. O(n²) over an episode — fine for a test tool.
 *
 * Teardown contract: `teardown()` abandons any in-flight episode (so the
 * abandon event is logged), disposes the adapter (listener add/remove
 * symmetry is asserted by the adapter's own tests), and flushes + disposes
 * the persistence batcher. The modal calls it on close/unmount.
 */

export interface TypingTestCounts {
  /** Inputs the adapter handed to the live aggregator (edits + selection reports). */
  inputEvents: number;
  /** State events the SignalEventLog accepted (includes start/pause/submit/abandon). */
  loggedStates: number;
  /** Rows already written to IndexedDB. */
  persisted: number;
  /** Rows queued but not yet flushed. */
  pendingWrites: number;
  /** Rows lost to a failed IDB batch (reported, never re-queued). */
  failedWrites: number;
}

export type TypingTestStatus = 'idle' | 'recording' | 'submitted' | 'abandoned';

const ZERO_COUNTS: TypingTestCounts = {
  inputEvents: 0,
  loggedStates: 0,
  persisted: 0,
  pendingWrites: 0,
  failedWrites: 0,
};

function makeCaptureId(): string {
  return `typing-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useTypingTest({ sessionId }: { sessionId?: string | null } = {}) {
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<TypingTestStatus>('idle');
  const [live, setLive] = useState<{ typing: TypingWindow['typing']; quality: unknown } | null>(null);
  const [finalWindow, setFinalWindow] = useState<TypingWindow | null>(null);
  const [counts, setCounts] = useState<TypingTestCounts>(ZERO_COUNTS);
  const [modes, setModes] = useState<{ grapheme: string; word: string } | null>(null);
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  const adapterRef = useRef<TypingComposerAdapter | null>(null);
  const persistRef = useRef<SignalEventBatcher | null>(null);
  const logRef = useRef<SignalEventLog | null>(null);
  const storeRef = useRef<IdbStoreRuntime | null>(null);
  const recordedRef = useRef<TypingRecordEvent[]>([]);
  const episodeStartRef = useRef(0);
  const tearingDownRef = useRef(false);
  // Identity for the CURRENT episode, readable from teardown (which runs
  // outside React state updates).
  const captureIdRef = useRef<string | null>(null);
  const episodeSessionIdRef = useRef<string | null>(null);
  // Session id captured per-episode so a mid-test runtime change never
  // re-runs the wiring effect; read at begin() time only.
  const sessionIdRef = useRef<string | null | undefined>(sessionId);
  sessionIdRef.current = sessionId;

  const refreshCounts = useCallback(() => {
    const persist = persistRef.current;
    setCounts({
      inputEvents: recordedRef.current.length,
      loggedStates: logRef.current?.size ?? 0,
      persisted: persist?.writtenCount ?? 0,
      pendingWrites: persist?.pendingCount ?? 0,
      failedWrites: persist?.failedCount ?? 0,
    });
  }, []);

  /** Replay the recording into a throwaway aggregator; the live episode stays untouched. */
  const recomputeLive = useCallback(() => {
    const recorded = recordedRef.current;
    if (recorded.length === 0) {
      setLive(null);
      return;
    }
    try {
      const probe = new TypingAggregator();
      probe.start({ timestamp: episodeStartRef.current, targetKind: 'chat_composer', targetId: 'probe' });
      recorded.forEach((event) => probe.record(event));
      const lastTimestamp = recorded[recorded.length - 1].timestamp;
      const probeWindow = probe.finalize({ timestamp: lastTimestamp, reason: 'submitted' });
      setLive(probeWindow ? { typing: probeWindow.typing, quality: probeWindow.quality } : null);
    } catch (error) {
      // A probe failure must never break the live episode — surface it and move on.
      console.warn('[typing-test] live metric replay failed', error);
    }
  }, []);

  /**
   * Persist the finalized episode WINDOW to `signal_windows` (keyPath
   * `window_id`), so the episode shows up on the /analyze/typing dashboard —
   * which reads windows, not the per-event stream. Fire-and-forget; a
   * failure is logged and surfaced but never blocks teardown.
   */
  const persistWindow = useCallback(
    (window: TypingWindow) => {
      const store = storeRef.current;
      if (!store) return;
      const windowId = `win_${captureIdRef.current ?? makeCaptureId()}`;
      const row = {
        ...window,
        window_id: windowId,
        capture_id: captureIdRef.current,
        session_id: episodeSessionIdRef.current,
      };
      void store
        .bulkAdd('signal_windows', [row])
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: STORED_TYPING_WINDOWS_QUERY_KEY });
        })
        .catch((error: unknown) => {
          console.error('[typing-test] episode window persistence failed', error);
          setPersistError(error instanceof Error ? error.message : String(error));
        });
    },
    [queryClient],
  );

  const handleWindow = useCallback(
    (window: TypingWindow) => {
      persistWindow(window);
      if (tearingDownRef.current) return;
      setFinalWindow(window);
      setStatus(window.typing.abandoned ? 'abandoned' : 'submitted');
    },
    [persistWindow],
  );

  /** Start a fresh episode against `element`. Any prior episode must be torn down first. */
  const begin = useCallback(
    (element: HTMLTextAreaElement) => {
      const id = makeCaptureId();
      captureIdRef.current = id;
      episodeSessionIdRef.current = sessionIdRef.current ?? id;
      // Same database the rest of the app reads ('oyon-app'), so this episode
      // shows up on the /analyze screens under the Typing channel.
      storeRef.current ??= new IndexedDbOyonStore({ dbName: 'oyon-app' }) as unknown as IdbStoreRuntime;
      const persist = createSignalEventBatcher({
        store: storeRef.current,
        batchSize: 20,
        onError: (error) => {
          console.error('[typing-test] signal event persistence failed', error);
          setPersistError(error instanceof Error ? error.message : String(error));
          refreshCounts();
        },
      });
      const log = new SignalEventLog({ onEvent: persist.write });
      log.start({ capture_id: id, session_id: episodeSessionIdRef.current });

      const aggregator = new TypingAggregator({
        onEvent: (event) => {
          log.record({
            modality: event.modality,
            state: event.state,
            source: event.source,
            timestamp: event.timestamp,
            monotonic_ms: event.monotonic_ms,
            detail: (event.detail ?? null) as Record<string, unknown> | null,
          });
        },
      });
      // Instrument record() (harness pattern): every input is recorded for
      // the replay probe before reaching the live aggregator.
      const realRecord = aggregator.record.bind(aggregator);
      aggregator.record = (event: TypingRecordEvent) => {
        recordedRef.current.push({ ...event });
        realRecord(event);
        recomputeLive();
        refreshCounts();
      };

      recordedRef.current = [];
      episodeStartRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();

      const adapter = createTypingComposerAdapter({
        element,
        aggregator,
        targetKind: 'chat_composer',
        targetId: 'live-typing-test',
        onWindow: handleWindow,
      });
      adapter.start();

      adapterRef.current = adapter;
      persistRef.current = persist;
      logRef.current = log;
      setCaptureId(id);
      setModes({ grapheme: adapter.graphemeMode, word: adapter.wordMode });
      setStatus('recording');
      setFinalWindow(null);
      setLive(null);
      setPersistError(null);
      setCounts(ZERO_COUNTS);
    },
    [handleWindow, recomputeLive, refreshCounts],
  );

  const flushAndNotify = useCallback(() => {
    const persist = persistRef.current;
    if (!persist) return;
    void persist.flush().then(() => {
      refreshCounts();
      void queryClient.invalidateQueries({ queryKey: STORED_EVENTS_QUERY_KEY });
    });
  }, [queryClient, refreshCounts]);

  const submit = useCallback(() => {
    adapterRef.current?.submit(); // finalizes + detaches listeners; onWindow fires
    flushAndNotify();
  }, [flushAndNotify]);

  const abandon = useCallback(() => {
    adapterRef.current?.abandon();
    flushAndNotify();
  }, [flushAndNotify]);

  /** Abandon any in-flight episode, dispose the adapter, flush + dispose persistence. */
  const teardown = useCallback(() => {
    const adapter = adapterRef.current;
    adapterRef.current = null;
    if (adapter) {
      // Suppress setState from the abandon-driven onWindow: teardown runs on
      // unmount, where the state no longer exists to update.
      tearingDownRef.current = true;
      try {
        if (adapter.active) adapter.abandon(); // logs the abandon event, detaches listeners
        adapter.dispose(); // idempotent; safe after abandon()
      } finally {
        tearingDownRef.current = false;
      }
    }
    logRef.current = null;
    const persist = persistRef.current;
    persistRef.current = null;
    if (persist) {
      void persist.dispose().then(() => {
        void queryClient.invalidateQueries({ queryKey: STORED_EVENTS_QUERY_KEY });
      });
    }
  }, [queryClient]);

  /** Tear down the current episode and immediately start a fresh one. */
  const reset = useCallback(
    (element: HTMLTextAreaElement) => {
      teardown();
      element.value = '';
      begin(element);
    },
    [begin, teardown],
  );

  return {
    status,
    live,
    finalWindow,
    counts,
    modes,
    captureId,
    persistError,
    begin,
    submit,
    abandon,
    reset,
    teardown,
  };
}
