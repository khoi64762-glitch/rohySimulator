import type { EmotionWindow } from 'oyon';

export declare const MAX_EXPLICIT_EMPTY_SLOTS: number;
export declare const FALLBACK_CADENCE_MS: number;

export type TimelineSlot =
  | { kind: 'bar'; window: EmotionWindow }
  | { kind: 'empty' }
  | { kind: 'break'; ms: number };

export declare function buildSlots(windows: EmotionWindow[]): {
  slots: TimelineSlot[];
  /** How many distinct dropouts were detected (empties + breaks). */
  gaps: number;
  /** Expected spacing — median window DURATION (falling back to the median
   *  inter-window delta). Null when timestamps were unusable. */
  cadenceMs: number | null;
};

export declare function formatGap(ms: number): string;
