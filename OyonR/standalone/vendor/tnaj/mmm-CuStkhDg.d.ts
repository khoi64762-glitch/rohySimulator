import { T as TNA, C as CentralityMeasure, a as CentralityResult, h as SequenceData, i as TNAData, c as ClusterResult, M as Matrix } from './types-C4ftN5gs.js';
import { a as BootstrapOptions, b as BootstrapResult } from './bootstrap-DcP2CBLQ.js';
import { z as PermutationOptions, A as PermutationResult, S as StabilityOptions, I as StabilityResult, f as MarkovOrderInput, g as MarkovOrderOptions, i as MarkovOrderResult, e as MarkovInput, k as MarkovStabilityResult, P as PassageTimeOptions, y as PassageTimeResult, a as CasedropReliabilityOptions, b as CasedropReliabilityResult, F as ReliabilityResult, H as RepresentativeResult, r as MmmInput, s as MmmOptions, M as MMMResult } from './mmm-Bh8r28dS.js';

declare function bootstrapTna(model: TNA, options?: BootstrapOptions): BootstrapResult;

declare function centralities(model: TNA, options?: {
    loops?: boolean;
    normalize?: boolean;
    measures?: CentralityMeasure[];
}): CentralityResult;

declare function permutationTest(x: TNA, y: TNA, options?: PermutationOptions): PermutationResult;

declare function estimateCS(model: TNA, options?: StabilityOptions): StabilityResult;

/**
 * compareWeightMatrices — WASM-backed. 22 reliability metrics on two
 * weight matrices. Same Record<string, number> shape as tnaj.
 *
 * reliabilityAnalysis (split-half pipeline) is not yet WASM-ported — it
 * iteratively splits sequences, builds models, and calls
 * compareWeightMatrices per iteration. The inner loop is JS but the
 * per-call comparison goes through the WASM kernel here.
 */

declare function compareWeightMatrices(a: TNA, b: TNA): Record<string, number>;

declare function passageTime(x: MarkovInput, options?: PassageTimeOptions): PassageTimeResult;
declare function markovStability(x: MarkovInput, options?: {
    normalize?: boolean;
}): MarkovStabilityResult;
declare function markovOrderTest(data: MarkovOrderInput, options?: MarkovOrderOptions): MarkovOrderResult;

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

type ClusterOptions = {
    dissimilarity?: string;
    method?: string;
    naSyms?: string[];
    weighted?: boolean;
    lambda?: number;
};
/**
 * Unified clustering function. Auto-detects input type:
 * - TNAData (has .sequenceData) → string distance metrics
 * - number[][] → numeric distance metrics (euclidean/manhattan)
 * - SequenceData (string[][]) → string distance metrics
 */
declare function clusterData(data: SequenceData | TNAData | number[][], k: number, options?: ClusterOptions): ClusterResult;
/** @deprecated Use clusterData() instead. */
declare function clusterSequences(data: SequenceData | TNAData, k: number, options?: ClusterOptions): ClusterResult;
/**
 * Compute dendrogram data from a pre-computed distance matrix.
 * Returns merge history, heights, and leaf order (no cluster assignments).
 */
declare function computeDendrogram(dist: Matrix, method?: string): {
    merge: number[][];
    heights: number[];
    order: number[];
};
/**
 * Find representative sequences from the dataset (medoid or frequency
 * criterion). Distances/PAM run in WASM; selection logic mirrors tnaj.
 */
declare function findRepresentatives(data: SequenceData, options?: {
    dissimilarity?: string;
    n?: number;
    k?: number;
    criterion?: 'medoid' | 'frequency';
    naSyms?: string[];
}): RepresentativeResult[];

/**
 * Fit a Mixture Markov Model. `data` is either sequence rows
 * (`(string|null)[][]`, wide format — positions are NOT compacted, an
 * interior NA breaks a transition pair, matching R) or a `TNA` with `.data`.
 */
declare function mmm(data: MmmInput, options: MmmOptions): MMMResult;

export { centralities as a, bootstrapTna as b, casedropReliability as c, clusterData as d, clusterSequences as e, compareWeightMatrices as f, computeDendrogram as g, estimateCS as h, findRepresentatives as i, markovStability as j, mmm as k, permutationTest as l, markovOrderTest as m, passageTime as p, reliabilityAnalysis as r };
