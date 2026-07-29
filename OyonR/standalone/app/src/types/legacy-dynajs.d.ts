// Ambient types for the vendored dynajs bundle (standalone/vendor/dynajs),
// aliased `legacy-dynajs`. Only the surface the patterns panel uses.
declare module 'legacy-dynajs' {
  export interface PatternEntry {
    pattern: string;
    length: number;
    frequency: number;
    support: number;
    lift: number;
    proportion: number;
    count?: number;
    pValue?: number;
  }
  export function discoverPatterns(
    data: (string | null | undefined)[][],
    options?: { len?: number[]; minFreq?: number; minSupport?: number; type?: string },
  ): { patterns: PatternEntry[]; [k: string]: unknown };
}
