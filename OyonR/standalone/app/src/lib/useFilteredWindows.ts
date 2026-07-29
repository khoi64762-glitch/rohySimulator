import { useMemo } from 'react';
import type { EmotionWindow } from 'oyon';
import { useEnrichedWindows } from './useEnrichedWindows';
import { useFilterStore } from './filterStore';
import { useSessionContext } from './sessionContext';
import { useBridge } from './hostBridge';
import { filterWindows } from './filterWindows';

/*
 * useFilteredWindows — what every scoped dashboard consumes.
 *
 * Composition order matters: windows are enriched FIRST (dynamics are
 * window-to-window derivatives and must be computed over the true timeline),
 * then filtered. Filtering before enrichment would fabricate velocity jumps
 * across filter gaps.
 *
 * Returns both the full enriched array (`allWindows` — the FilterBar derives
 * its session/user options from it) and the scoped `filtered` array.
 */

export interface FilteredWindows {
  /**
   * Enriched windows visible to this surface. Standalone receives the full
   * store for retrospective filters; embedded surfaces receive only the
   * active session so host UI cannot discover another session indirectly.
   */
  allWindows: EmotionWindow[];
  /** Enriched and scope/session/user-filtered — what dashboards render. */
  filtered: EmotionWindow[];
  isLoading: boolean;
  /** The live capture session id (null when capture never started). */
  currentSessionId: string | null;
  /** Embedded analytics are privacy-locked to currentSessionId. */
  sessionLocked: boolean;
}

export function useFilteredWindows(): FilteredWindows {
  const { enriched, isLoading } = useEnrichedWindows();
  const scope = useFilterStore((s) => s.scope);
  const sessionIds = useFilterStore((s) => s.sessionIds);
  const userIds = useFilterStore((s) => s.userIds);
  const liveSessionId = useSessionContext((s) => s.sessionId);
  const embedded = useBridge((s) => s.embedded);
  const chromeMode = useBridge((s) => s.chromeMode);
  const pinnedSessionId = useBridge((s) => s.sessionIdOverride);

  // Embedded analytics are a current-session surface, never an implicit
  // tenant/browser-history browser. A viewer's explicit session-id wins over a
  // sibling capture marker. A real-runtime embed does the reverse: its actual
  // live session wins over an attribute changed mid-capture (session-id applies
  // at the next start). With neither, current filtering honestly yields []
  // instead of falling back to another session.
  const currentSessionId = chromeMode === 'none'
    ? pinnedSessionId ?? liveSessionId
    : liveSessionId ?? pinnedSessionId;
  const effectiveScope = embedded ? 'current' : scope;
  const effectiveSessionIds = embedded ? null : sessionIds;
  const effectiveUserIds = embedded ? null : userIds;

  const filtered = useMemo(
    () =>
      filterWindows(enriched, {
        scope: effectiveScope,
        currentSessionId,
        sessionIds: effectiveSessionIds,
        userIds: effectiveUserIds,
      }),
    [enriched, effectiveScope, currentSessionId, effectiveSessionIds, effectiveUserIds],
  );

  // Do not expose aggregate counts/session choices from the backing store to an
  // embedded surface. Every embedded consumer sees one session-shaped dataset.
  const allWindows = embedded ? filtered : enriched;

  return {
    allWindows,
    filtered,
    isLoading,
    currentSessionId,
    sessionLocked: embedded,
  };
}
