/**
 * Matrix class wrapping Float64Array with row-major layout.
 * Designed for small matrices (typically 9x9 to ~30x30) used in TNA.
 */
declare class Matrix {
    readonly data: Float64Array;
    readonly rows: number;
    readonly cols: number;
    constructor(rows: number, cols: number, data?: Float64Array | number[]);
    /** Create from a 2D array. */
    static from2D(arr: number[][]): Matrix;
    /** Create an identity matrix. */
    static eye(n: number): Matrix;
    /** Create a matrix filled with a value. */
    static fill(rows: number, cols: number, value: number): Matrix;
    /** Create a zero matrix. */
    static zeros(rows: number, cols: number): Matrix;
    /** Get element at (i, j). */
    get(i: number, j: number): number;
    /** Set element at (i, j). */
    set(i: number, j: number, value: number): void;
    /** Deep copy. */
    clone(): Matrix;
    /** Convert to 2D array. */
    to2D(): number[][];
    /** Transpose. */
    transpose(): Matrix;
    /** Matrix multiply: this @ other. */
    matmul(other: Matrix): Matrix;
    /** Element-wise addition. */
    add(other: Matrix): Matrix;
    /** Element-wise subtraction. */
    sub(other: Matrix): Matrix;
    /** Element-wise multiplication. */
    mul(other: Matrix): Matrix;
    /** Scalar multiply. */
    scale(s: number): Matrix;
    /** Element-wise apply. */
    map(fn: (value: number, i: number, j: number) => number): Matrix;
    /** Sum of all elements. */
    sum(): number;
    /** Row sums as array. */
    rowSums(): Float64Array;
    /** Column sums as array. */
    colSums(): Float64Array;
    /** Get diagonal as array. */
    diag(): Float64Array;
    /** Set diagonal values. */
    setDiag(value: number): Matrix;
    /** Fill diagonal with values from array. */
    setDiagFrom(values: Float64Array | number[]): Matrix;
    /** Create a diagonal matrix from a vector. */
    static diag(values: Float64Array | number[]): Matrix;
    /** Max element. */
    max(): number;
    /** Min element. */
    min(): number;
    /** Count elements matching a predicate. */
    count(predicate: (v: number) => boolean): number;
    /** Check if any element satisfies predicate. */
    any(predicate: (v: number) => boolean): boolean;
    /** Flatten to array in column-major order (matching R's as.vector). */
    flattenColMajor(): Float64Array;
    /** Flatten to array in row-major order. */
    flatten(): Float64Array;
    /** Get a row as array. */
    row(i: number): Float64Array;
    /** Get a column as array. */
    col(j: number): Float64Array;
    /** Extract a sub-matrix given row and column indices. */
    subMatrix(rowIndices: number[], colIndices: number[]): Matrix;
    /** Quantile of all elements. */
    quantile(p: number): number;
    /** Is square? */
    get isSquare(): boolean;
    /** Mean of non-zero elements. */
    meanNonZero(): number;
    /** Invert matrix using Gauss-Jordan elimination. */
    inverse(): Matrix;
    /** Outer product of two vectors. */
    static outer(a: Float64Array | number[], b: Float64Array | number[]): Matrix;
}
/** Row normalize a matrix (each row sums to 1). */
declare function rowNormalize(mat: Matrix): Matrix;
/** Min-max normalization to [0, 1]. */
declare function minmaxScale(mat: Matrix): Matrix;
/** Divide by maximum value. */
declare function maxScale(mat: Matrix): Matrix;
/** Convert to ranks (1-based, average ties). Matches R's rank(x, ties.method="average"). */
declare function rankScale(mat: Matrix): Matrix;
/** Apply one or more scaling methods to a matrix. */
declare function applyScaling(mat: Matrix, scaling: string | string[] | null | undefined): {
    weights: Matrix;
    applied: string[];
};
/** Compute mean of a Float64Array. */
declare function arrayMean(arr: Float64Array): number;
/** Compute standard deviation of a Float64Array (ddof=1). */
declare function arrayStd(arr: Float64Array, ddof?: number): number;
/** Pearson correlation between two Float64Arrays. */
declare function pearsonCorr(a: Float64Array, b: Float64Array): number;
/** Quantile of a Float64Array. */
declare function arrayQuantile(arr: Float64Array, p: number): number;

/**
 * Core type definitions for TNA.
 */

/** A sequence is a row of string tokens (states), possibly with null for missing. */
type Sequence = (string | null)[];
/** A sequence dataset: array of sequences. */
type SequenceData = Sequence[];
/**
 * TNA model type identifiers.
 * - 'relative': Row-normalized transition probabilities
 * - 'frequency': Raw transition counts
 * - 'co-occurrence': Bidirectional co-occurrence
 * - 'reverse': Reverse order transitions
 * - 'n-gram': Higher-order n-gram transitions
 * - 'gap': Non-adjacent transitions weighted by gap
 * - 'window': Sliding window transitions
 * - 'attention': Exponential decay weighted
 * - 'betweenness': Edge betweenness weights
 * - 'matrix': Direct matrix input
 */
type ModelType = 'relative' | 'frequency' | 'co-occurrence' | 'reverse' | 'n-gram' | 'gap' | 'window' | 'attention' | 'betweenness' | 'matrix';
/** Parameters for specific model types. */
interface TransitionParams {
    /** Order for n-gram transitions. Default 2. */
    n?: number;
    /** Max gap for gap model. Default 5. */
    maxGap?: number;
    /** Decay factor for gap model. Default 0.5. */
    decay?: number;
    /** Window size for window model. Default 3. */
    size?: number;
    /**
     * Decay parameter for the attention model: `weight = exp(-beta * distance)`.
     * Default 1, which matches R `tna::atna`'s default.
     *
     * R parameterises the SAME kernel by its reciprocal — `exp(-|i-j| / lambda)`, with
     * `lambda` defaulting to 1 — so **beta = 1 / lambda**. The two are easy to conflate
     * because "beta" reads like a decay rate; beta = 0.1 is NOT a mild decay, it is
     * lambda = 10, reaching ten times further down the sequence.
     */
    beta?: number;
    /** Whether to use windowed co-occurrence (from importOnehot). */
    windowed?: boolean;
    /** Window size for windowed co-occurrence. */
    windowSize?: number;
    /** Window span (number of columns per row) for windowed co-occurrence. */
    windowSpan?: number;
}
/** Options for building a TNA model. */
interface BuildModelOptions {
    type?: ModelType;
    scaling?: string | string[] | null;
    labels?: string[];
    beginState?: string;
    endState?: string;
    params?: TransitionParams;
}
/** TNA model. */
interface TNA {
    /** Adjacency/transition matrix (n_states x n_states). */
    weights: Matrix;
    /** Initial state probabilities (n_states). */
    inits: Float64Array;
    /** State labels. */
    labels: string[];
    /** Original sequence data (if built from sequences). */
    data: SequenceData | null;
    /** Model type. */
    type: ModelType;
    /** Scaling methods applied. */
    scaling: string[];
    /** Transition parameters (e.g. beta for attention model). */
    params?: TransitionParams;
    /**
     * HTNA (Heterogeneous TNA): actor-group tag per node, parallel to `labels`.
     * Populated by `htna()` factory; undefined for plain TNA models.
     * When present, downstream HTNA analyses/renderers use this to partition
     * the network without splitting it structurally.
     */
    partition?: string[];
    /**
     * HTNA: canonical actor-group ordering (e.g. ['Human', 'AI']).
     * Drives consistent color/shape/layout assignment across renderers.
     * Defaults to first-occurrence order of `partition` when not given explicitly.
     */
    actorLevels?: string[];
}
/** GroupTNA: mapping from group name to TNA model. */
interface GroupTNA {
    models: Record<string, TNA>;
}
/** Centrality measure names. */
type CentralityMeasure = 'OutStrength' | 'InStrength' | 'ClosenessIn' | 'ClosenessOut' | 'Closeness' | 'Betweenness' | 'BetweennessRSP' | 'Diffusion' | 'Clustering' | 'PageRank';
/** Centrality result: map from state label to measure values. */
interface CentralityResult {
    labels: string[];
    measures: Record<CentralityMeasure, Float64Array>;
    /** Optional group column for GroupTNA results. */
    groups?: string[];
}
/** Clique detection result. */
interface CliqueResult {
    weights: Matrix[];
    indices: number[][];
    labels: string[][];
    size: number;
    threshold: number;
}
/** Community detection result. */
interface CommunityResult {
    counts: Record<string, number>;
    assignments: Record<string, number[]>;
    labels: string[];
}
/** Community detection method. */
type CommunityMethod = 'fast_greedy' | 'louvain' | 'label_prop' | 'leading_eigen' | 'edge_betweenness' | 'walktrap';
/** Cluster result. */
interface ClusterResult {
    data: SequenceData;
    k: number;
    assignments: number[];
    silhouette: number;
    sizes: number[];
    method: string;
    distance: Matrix;
    dissimilarity: string;
    /** Merge history: merge[i] = [left, right] indices merged at step i.
     *  Negative values = leaf indices (-1 = seq 0, -2 = seq 1, ...).
     *  Positive values = internal node from a previous merge step (1-indexed).
     *  Matches R's hclust$merge convention. */
    merge?: number[][];
    /** Height at each merge step (distance between merged clusters). */
    heights?: number[];
    /** Leaf order: sequence indices in dendrogram left-to-right order. */
    order?: number[];
}
/** Prepared data container (analogous to Python TNAData). */
interface TNAData {
    sequenceData: SequenceData;
    labels: string[];
    statistics: {
        nSessions: number;
        nUniqueActions: number;
        uniqueActions: string[];
        maxSequenceLength: number;
        meanSequenceLength: number;
    };
}
/** Compare sequences result row. */
interface CompareRow {
    pattern: string;
    frequencies: Record<string, number>;
    proportions: Record<string, number>;
    /**
     * Standardized ADJUSTED residual per group — R's `chisq.test()$stdres`, i.e. how
     * over/under-represented this pattern is in each group relative to the group's share
     * of all pattern occurrences. Approximately N(0,1) under independence, so |z| > 1.96
     * flags a cell that departs from chance at p < .05.
     *
     * Computed on the COMPLETE pattern x group table, before `minFreq` drops rows — so it
     * agrees with `proportions` and `pValue` (also pre-filter), and raising `minFreq` does
     * not silently rescale the z of the patterns that survive.
     */
    residuals: Record<string, number>;
    effectSize?: number;
    pValue?: number;
}

export { type BuildModelOptions as B, type CentralityMeasure as C, type GroupTNA as G, Matrix as M, type Sequence as S, type TNA as T, type CentralityResult as a, type CliqueResult as b, type ClusterResult as c, type CommunityMethod as d, type CommunityResult as e, type CompareRow as f, type ModelType as g, type SequenceData as h, type TNAData as i, type TransitionParams as j, applyScaling as k, arrayMean as l, arrayQuantile as m, arrayStd as n, maxScale as o, minmaxScale as p, pearsonCorr as q, rankScale as r, rowNormalize as s };
