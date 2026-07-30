import type { EmotionWindow } from 'oyon';

export type AttentionState = 'focused' | 'shifting' | 'away' | 'available' | 'unmeasured';

export const ATTENTION_STATE_META: Readonly<Record<AttentionState, {
  label: string;
  color: string;
}>>;

export interface AttentionAnalytics {
  windows: EmotionWindow[];
  series: {
    focus: Array<number | null>;
    onScreen: Array<number | null>;
    gazeValid: Array<number | null>;
    fixations: Array<number | null>;
    medianFixationMs: Array<number | null>;
    scanpath: Array<number | null>;
    respiration: Array<number | null>;
    respirationConfidence: Array<number | null>;
    rgbAgreement: Array<number | null>;
  };
  states: AttentionState[];
  stateCounts: Record<AttentionState, number>;
  stateDurationsMs: Record<AttentionState, number>;
  measuredAttentionWindows: number;
  meanFocus: number | null;
  meanOnScreen: number | null;
  meanGazeValid: number | null;
  totalFixations: number;
  totalTransitions: number;
  focusedRuns: number;
  longestFocusedRunMs: number;
  recoveries: number;
  topAoiDwell: Array<{ label: string; value: number }>;
  topAoiTransitions: Array<{ label: string; value: number }>;
  respiration: {
    values: number[];
    readableWindows: number;
    mean: number | null;
    min: number | null;
    max: number | null;
    meanConfidence: number | null;
    meanRgbAgreement: number | null;
    overlapWindows: number;
    focusCorrelation: number | null;
  };
}

export function buildAttentionAnalytics(windows: EmotionWindow[]): AttentionAnalytics;
