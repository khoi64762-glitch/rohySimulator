/*
 * Hand-written declarations for typingChartMath.js (plain JS so the node
 * test chain can import it — same pattern as timelineSlots / filterWindows).
 * Keep in sync with the implementation.
 */

export interface CompressedBreak {
  realStart: number;
  realEnd: number;
  gapMs: number;
  compStart: number;
  compEnd: number;
}

export interface CompressedTimeAxis {
  spanMs: number;
  breaks: CompressedBreak[];
  toCompressed: (t: number) => number;
}

export declare function compressTimeAxis(
  times: number[],
  options?: { maxGapMs?: number; breakSpanMs?: number },
): CompressedTimeAxis;

export interface PauseSpan {
  startT: number;
  endT: number;
  gapMs: number;
}

export declare function findPauses(times: number[], thresholdMs: number): PauseSpan[];

export interface FrontierPoint {
  t: number;
  frontier: number;
}

export declare function computeFrontier(
  entries: Array<{ offset?: number; distance?: number; t: number }>,
): FrontierPoint[];

export interface ProductionSeries {
  points: Array<{ t: number; committed: number }>;
  missing: 'revision_locations' | 'offset' | 'distance' | null;
}

export declare function productionSeries(
  entries: Array<{ offset?: number; distance?: number; t: number }>,
): ProductionSeries;

export declare function logBinIndex(
  intervalMs: number,
  options?: { binsPerDecade?: number; minMs?: number },
): number;

export interface LogHistogramBin {
  lo: number;
  hi: number;
  count: number;
}

export declare function buildLogHistogram(
  intervals: number[],
  options?: { binsPerDecade?: number; minMs?: number },
): { bins: LogHistogramBin[]; total: number };

export interface BurstSegment {
  kind: 'p' | 'r';
  closedBy: 'pause' | 'revision' | 'end';
  startT: number;
  endT: number;
  edits: number;
}

export declare function reconstructBursts(
  ops: string[],
  times: number[],
  thresholdMs: number,
): { segments: BurstSegment[]; pCount: number; rCount: number };

export declare function axisTimeTicks(
  axis: Pick<CompressedTimeAxis, 'breaks' | 'toCompressed'>,
  startT: number,
  endT: number,
  count?: number,
): Array<{ realMs: number; comp: number }>;

export declare function formatDurationShort(ms: number): string;
