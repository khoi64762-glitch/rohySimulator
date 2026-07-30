// Ambient types for the vendored tnaj bundle (standalone/vendor/tnaj), aliased
// as `legacy-tnaj`. Loosely typed — only the surface the higher-order plots use.
declare module 'legacy-tnaj' {
  export function tna(sequences: (string | null)[][], options?: unknown): { labels: string[]; [k: string]: unknown };
  export interface LSAFit {
    kind: 'lsa';
    [key: string]: unknown;
  }
  export interface LSAGroup {
    kind: 'lsa_group';
    [key: string]: unknown;
  }
  export function lsa(
    sequences: (string | null)[][],
    options?: { lag?: number; engine?: string; alpha?: number; loops?: boolean },
  ): LSAFit | LSAGroup;
  export function plotLSAPolar(
    fit: LSAFit,
    options?: {
      style?: 'rose' | 'wedge';
      fill?: 'residuals' | 'prob' | 'lift';
      size?: 'count' | 'prob';
      labels?: 'all' | 'auto' | 'none';
      minShow?: number;
      significant?: boolean;
      width?: number;
      height?: number;
      title?: string;
      subtitle?: string;
      background?: string;
    },
  ): string;
  export function contextTree(sequences: (string | null)[][], options?: { maxDepth?: number; minCount?: number }): unknown;
  export function commonPathways(
    tree: unknown,
    options?: { top?: number; depth?: number; minCount?: number },
  ): Array<{ pathway: string; depth: number; count: number; likelyNext?: string; nextProbability?: number }>;
  export function plotTree(tree: unknown, options?: { style?: string; maxNodes?: number }): string;
  export interface HypaScore {
    path: string; from: string; to: string;
    observed: number; expected: number; ratio: number;
    pAdjustedUnder: number; pAdjustedOver: number;
    anomaly: 'over' | 'under' | 'normal';
  }
  export function buildHypa(
    sequences: (string | null)[][],
    options?: { k?: number; alpha?: number; minCount?: number; pAdjustMethod?: string },
  ): { k: number; alpha: number; pAdjust: string; scores: HypaScore[] };
}
