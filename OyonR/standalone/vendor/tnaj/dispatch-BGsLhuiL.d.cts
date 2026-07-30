import { T as TNA, G as GroupTNA, C as CentralityMeasure, a as CentralityResult, c as ClusterResult, M as Matrix, h as SequenceData } from './types-C4ftN5gs.cjs';
import { a as CasedropReliabilityOptions, b as CasedropReliabilityResult, Q as clusterData$1, U as clusterSequences$1, S as StabilityOptions, I as StabilityResult, a0 as findRepresentatives$1, H as RepresentativeResult, f as MarkovOrderInput, g as MarkovOrderOptions, i as MarkovOrderResult, e as MarkovInput, k as MarkovStabilityResult, r as MmmInput, s as MmmOptions, M as MMMResult, P as PassageTimeOptions, y as PassageTimeResult, z as PermutationOptions, A as PermutationResult, F as ReliabilityResult } from './mmm-DH-HgjDm.cjs';
import { a as BootstrapOptions, b as BootstrapResult } from './bootstrap-FLE9gIyi.cjs';

/**
 * Smart dispatchers for the 10 WASM-overlapping functions.
 *
 * Each function:
 *   1. Checks `isWasmEnabled() && canRoute*(args)`.
 *   2. If both true → routes to the WASM impl in `tnaw`.
 *   3. Otherwise → falls back to tnaj's pure-TS implementation.
 *
 * Use this entry (`tnajw/full`) when you need a true drop-in that
 * silently switches to TS for configs the WASM kernel doesn't cover
 * (e.g. centralities on a GroupTNA, reliabilityAnalysis on ctna/atna).
 */

declare function bootstrapTna(model: TNA, options?: BootstrapOptions): BootstrapResult;
declare function centralities(model: TNA | GroupTNA, options?: {
    loops?: boolean;
    normalize?: boolean;
    measures?: CentralityMeasure[];
}): CentralityResult;
declare function permutationTest(x: TNA, y: TNA, options?: PermutationOptions): PermutationResult;
declare function estimateCS(model: TNA, options?: StabilityOptions): StabilityResult;
declare function compareWeightMatrices(a: TNA, b: TNA): Record<string, number>;
declare function markovOrderTest(data: MarkovOrderInput, options?: MarkovOrderOptions): MarkovOrderResult;
declare function passageTime(x: MarkovInput, options?: PassageTimeOptions): PassageTimeResult;
declare function markovStability(x: MarkovInput, options?: {
    normalize?: boolean;
}): MarkovStabilityResult;
declare function casedropReliability(model: TNA, options?: CasedropReliabilityOptions): CasedropReliabilityResult;
declare function reliabilityAnalysis(sequenceData: SequenceData, modelType: 'tna' | 'ftna' | 'ctna' | 'atna', opts?: {
    iter?: number;
    split?: number;
    atnaBeta?: number;
    seed?: number;
    scaling?: string;
    addStartState?: boolean;
    startStateLabel?: string;
    addEndState?: boolean;
    endStateLabel?: string;
}): ReliabilityResult;
declare function clusterData(data: Parameters<typeof clusterData$1>[0], k: number, options?: Parameters<typeof clusterData$1>[2]): ClusterResult;
declare function clusterSequences(data: Parameters<typeof clusterSequences$1>[0], k: number, options?: Parameters<typeof clusterSequences$1>[2]): ClusterResult;
declare function computeDendrogram(dist: Matrix, method?: string): {
    merge: number[][];
    heights: number[];
    order: number[];
};
declare function findRepresentatives(data: Parameters<typeof findRepresentatives$1>[0], options?: Parameters<typeof findRepresentatives$1>[1]): RepresentativeResult[];
declare function mmm(data: MmmInput, options: MmmOptions): MMMResult;

export { centralities as a, bootstrapTna as b, casedropReliability as c, clusterData as d, clusterSequences as e, compareWeightMatrices as f, computeDendrogram as g, estimateCS as h, findRepresentatives as i, markovStability as j, mmm as k, permutationTest as l, markovOrderTest as m, passageTime as p, reliabilityAnalysis as r };
