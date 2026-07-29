/*
 * Hand-written declarations for chartMath.js so TypeScript components can
 * import the shared chart primitives (the app tsconfig has no allowJs; the
 * existing consumer, EdgeBundling.jsx, is untyped). Keep in sync with the
 * implementation.
 */

export declare const CARM_PALETTE: string[];

export declare function getColor(index: number): string;

export declare function monotonePath(points: Array<{ x: number; y: number }>): string;

export declare function stackSeries(
  series: Array<{ label: string; x: number[]; y: number[] }>,
  xs: number[],
): Array<Array<{ x: number; y0: number; y1: number }>>;

export interface LinearScale {
  (v: number): number;
  domain: [number, number];
  range: [number, number];
  ticks(count?: number): number[];
}

export declare function linearScale(
  domain: [number, number],
  range: [number, number],
): LinearScale;

export declare function clusterLayout(
  nodes: Array<{ id: string; parent: string; label?: string; group?: string }>,
  maxRadius?: number,
): {
  leaves: Array<{ id: string; angleDeg: number; radius: number }>;
  byId: Map<string, unknown>;
};

export declare function lcaPath(byId: Map<string, unknown>, aId: string, bId: string): string[];

export declare function bundlePath(
  pathNodes: Array<{ angleDeg: number; radius: number }>,
  beta: number,
): string;

export declare function lehmerJitter(seed: number): () => number;

export declare function hexLuminance(hex: string): number;

export declare const WEEKDAY_LABELS: string[];

export declare function bucketDayHour(
  events: Array<{ ts: number; student: string; state: string }>,
  options?: { timeMode?: string },
): {
  grid: unknown[][][];
  maxTotalCell: number;
  maxStudent: number;
  xLabels: string[];
  yLabels: string[];
};

export declare function dominantState(states: Record<string, number>): string;
