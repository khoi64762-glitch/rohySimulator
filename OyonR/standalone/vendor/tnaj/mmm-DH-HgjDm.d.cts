import { h as SequenceData, i as TNAData, c as ClusterResult, M as Matrix, T as TNA, C as CentralityMeasure, G as GroupTNA } from './types-C4ftN5gs.cjs';
import { P as PAdjustMethod } from './pAdjust-DGekUM6t.cjs';
import { W as WtnaOptions } from './bootstrap-FLE9gIyi.cjs';
import { S as SeededRNG } from './rng-CY-fA99P.cjs';

/**
 * Sequence clustering functions.
 * Port of R TNA clustering with full distance metric and linkage method support.
 */

/**
 * Unified clustering function. Auto-detects input type:
 * - TNAData (has .sequenceData) → string distance metrics
 * - number[][] → numeric distance metrics (euclidean/manhattan)
 * - SequenceData (string[][]) → string distance metrics
 */
declare function clusterData(data: SequenceData | TNAData | number[][], k: number, options?: {
    dissimilarity?: string;
    method?: string;
    naSyms?: string[];
    weighted?: boolean;
    lambda?: number;
}): ClusterResult;
/**
 * Compute dendrogram data from a pre-computed distance matrix.
 * Returns merge history, heights, and leaf order without cluster assignments.
 * @param dist - Square distance matrix.
 * @param method - Linkage method (average, complete, single, ward.D, ward.D2, mcquitty, median, centroid).
 * @returns Merge history (R hclust$merge convention), heights, and leaf order.
 */
declare function computeDendrogram(dist: Matrix, method?: string): {
    merge: number[][];
    heights: number[];
    order: number[];
};
/** Result type for representative sequences. */
interface RepresentativeResult {
    index: number;
    sequence: (string | null)[];
    distance: number;
    cluster?: number;
}
/**
 * Find representative sequences from the dataset.
 *
 * @param data - Sequence dataset
 * @param options - Configuration
 * @returns Array of representative sequences with their indices and distances
 */
declare function findRepresentatives(data: SequenceData, options?: {
    dissimilarity?: string;
    n?: number;
    k?: number;
    criterion?: 'medoid' | 'frequency';
    naSyms?: string[];
}): RepresentativeResult[];
/** @deprecated Use clusterData() instead. */
declare function clusterSequences(data: SequenceData | TNAData, k: number, options?: {
    dissimilarity?: 'hamming' | 'lv' | 'osa' | 'dl' | 'lcs' | 'qgram' | 'cosine' | 'jaccard' | 'jw';
    method?: string;
    naSyms?: string[];
    weighted?: boolean;
    lambda?: number;
}): ClusterResult;

/**
 * Permutation test for comparing two TNA models.
 * Port of Desktop analysis/permutation.ts.
 * Uses tnaj's computeTransitions3D / computeWeightsFrom3D for exact R equivalence.
 */

interface EdgeStat {
    from: string;
    to: string;
    diffTrue: number;
    effectSize: number;
    pValue: number;
}
interface PermutationResult {
    edgeStats: EdgeStat[];
    diffTrue: Float64Array;
    diffSig: Float64Array;
    pValues: Float64Array;
    labels: string[];
    nStates: number;
    level: number;
}
interface PermutationOptions {
    iter?: number;
    adjust?: PAdjustMethod;
    level?: number;
    seed?: number;
    paired?: boolean;
}
/**
 * Permutation test comparing two TNA models.
 * Both models must have sequence data (model.data) and identical labels.
 */
declare function permutationTest(x: TNA, y: TNA, options?: PermutationOptions): PermutationResult;
/** Input for WTNA permutation test. */
interface PermutationWtnaInput {
    records: Record<string, string | number>[];
    codes: string[];
    wtnaOpts: WtnaOptions;
    modelType: string;
    scaling: string | null | '';
}
/**
 * Permutation test for WTNA models.
 * Pools windowed groups from both inputs, randomly partitions,
 * rebuilds WTNA matrices per iteration, compares weight differences.
 */
declare function permutationTestWtna(inputX: PermutationWtnaInput, inputY: PermutationWtnaInput, modelX: TNA, modelY: TNA, options?: PermutationOptions): PermutationResult;

/**
 * Centrality stability estimation via case-dropping bootstrap.
 * Port of Desktop analysis/stability.ts.
 *
 * Also includes edge-level and network-level stability (Phase 5).
 */

interface StabilitySummaryRow {
    measure: string;
    dropProp: number;
    meanCor: number;
    sdCor: number;
    propAbove: number;
}
interface StabilityResult {
    csCoefficients: Record<string, number>;
    meanCorrelations: Record<string, number[]>;
    dropProps: number[];
    threshold: number;
    certainty: number;
    /**
     * Raw iter × nProp correlation matrix per measure. Nestimate-parity extension
     * (mirrors `net_stability$correlations`). Includes dropped (zero-variance)
     * measures as all-NaN matrices so the result object stays shape-stable.
     */
    correlations: Record<string, number[][]>;
    /**
     * Per (measure, dropProp) summary: mean, sd, propAbove. Mirrors
     * Nestimate's `summary.net_stability` frame.
     */
    summary: StabilitySummaryRow[];
    /** Correlation method used (mirrors R's `$method`). */
    method: 'pearson' | 'spearman' | 'kendall';
}
interface StabilityOptions {
    measures?: CentralityMeasure[];
    iter?: number;
    dropProps?: number[];
    threshold?: number;
    certainty?: number;
    seed?: number;
    corrMethod?: 'pearson' | 'spearman' | 'kendall';
    /**
     * When false (default), zero the diagonal of the weight matrix before
     * centrality computation. Matches Nestimate's `loops = FALSE` default.
     */
    loops?: boolean;
    /**
     * Optional deterministic replay: indices[propIdx][iterIdx] = keep-sample
     * indices (0-based). When provided, skips RNG sampling. Used by R-parity
     * verify harness (see design spec §5.4).
     */
    replayIndices?: Record<number, number[][]>;
}
/**
 * Estimate centrality stability using case-dropping bootstrap.
 *
 * Additive Nestimate-parity extensions (see design spec §4.4):
 *   - `corrMethod: 'kendall'` in addition to 'pearson' / 'spearman'.
 *   - `loops: false` (default) zeros the diagonal before centrality computation
 *     — matches `Nestimate::.compute_centralities`'s `loops = FALSE` path.
 *   - Result returns raw `correlations` matrices (iter × nProp per measure)
 *     and a `summary` frame (mean / sd / propAbove per measure × dropProp).
 *   - Dropped (zero-variance) measures stay in `cs`/`correlations` with
 *     0 / NaN respectively, so downstream code can iterate a stable key set.
 *   - Optional `replayIndices` enables deterministic R-parity — when provided,
 *     RNG sampling is bypassed for that (propIdx, iterIdx) coordinate.
 */
declare function estimateCS(model: TNA, options?: StabilityOptions): StabilityResult;
/** Input for WTNA centrality stability. */
interface StabilityWtnaInput {
    records: Record<string, string | number>[];
    codes: string[];
    wtnaOpts: WtnaOptions;
    modelType: string;
    scaling: string | null | '';
}
/**
 * Centrality stability for WTNA models via case-dropping bootstrap.
 */
declare function estimateCsWtna(input: StabilityWtnaInput, originalModel: TNA, options?: StabilityOptions): StabilityResult;
interface EdgeStabilityResult {
    /** Correlation per (dropProp): mean correlation of flattened edge weight vectors. */
    meanCorrelations: number[];
    /** CS coefficient for edge stability. */
    csCoefficient: number;
    dropProps: number[];
    threshold: number;
    certainty: number;
}
interface CasedropReliabilityMetricMatrix {
    /** iter × nProp (NaN where dropped). */
    mean_abs_dev: number[][];
    median_abs_dev: number[][];
    correlation: number[][];
    max_abs_dev: number[][];
}
interface CasedropReliabilitySummaryRow {
    metric: 'mean_abs_dev' | 'median_abs_dev' | 'correlation' | 'max_abs_dev';
    dropProp: number;
    mean: number;
    sd: number;
    median: number;
    mad: number;
    q025: number;
    q975: number;
}
interface CasedropReliabilityOptions {
    iter?: number;
    dropProps?: number[];
    threshold?: number;
    certainty?: number;
    /** Default 'spearman' (matches Nestimate::casedrop_reliability). */
    method?: 'spearman' | 'pearson' | 'kendall';
    /** Default false. Excludes diagonal from the edge vector. */
    includeDiag?: boolean;
    seed?: number;
    /** Optional per-dropProp, per-iter keep-sample indices for R-parity replay. */
    replayIndices?: Record<number, number[][]>;
}
interface CasedropReliabilityResult {
    cs: number;
    summary: CasedropReliabilitySummaryRow[];
    metrics: CasedropReliabilityMetricMatrix;
    correlations: number[][];
    dropProps: number[];
    threshold: number;
    certainty: number;
    iter: number;
    method: 'spearman' | 'pearson' | 'kendall';
    includeDiag: boolean;
    nCases: number;
    nEdges: number;
}
/**
 * Nestimate-parity case-dropping edge-weight stability.
 *
 * Returns four model-level metrics per iter × dropProp and a
 * summary frame (mean, sd, median, mad, q025, q975) per metric per drop.
 */
declare function casedropReliability(model: TNA, options?: CasedropReliabilityOptions): CasedropReliabilityResult;
/**
 * Legacy edge-stability helper — kept for backward compatibility with
 * existing Desktop callers. Now a thin projection over `casedropReliability`.
 *
 * @deprecated Use `casedropReliability` for the full Nestimate-parity result.
 */
declare function estimateEdgeStability(model: TNA, options?: StabilityOptions): EdgeStabilityResult;
interface NetworkStabilityResult {
    /** Mean density correlation across drop proportions. */
    densityCorrelations: number[];
    /** Mean weight correlation across drop proportions. */
    meanWeightCorrelations: number[];
    /** CS coefficient for density stability. */
    densityCS: number;
    /** CS coefficient for mean weight stability. */
    meanWeightCS: number;
    dropProps: number[];
    threshold: number;
    certainty: number;
}
/**
 * Estimate network-level stability using case-dropping bootstrap.
 * Tracks global metrics (density, mean weight) across subsamples.
 */
declare function estimateNetworkStability(model: TNA, options?: StabilityOptions): NetworkStabilityResult;

/**
 * Reliability analysis: split-half comparison of TNA weight matrices.
 * Port of Desktop analysis/reliability.ts.
 *
 * All 22 metrics match R's implementation exactly. Key behaviour notes:
 *  - All vector-level metrics operate on the FULL n×n weight matrix
 *    (including diagonal), flattened column-major (same as R as.vector()).
 *  - Rank Agreement uses matrix row-differences, matching R's diff(matrix).
 *  - RV coefficient uses column-centred tcrossprod formula.
 *  - Distance correlation matches R's biased estimator (can be negative).
 */

interface MetricDef {
    key: string;
    label: string;
    category: 'Deviations' | 'Correlations' | 'Dissimilarities' | 'Similarities' | 'Pattern';
}
declare const RELIABILITY_METRICS: MetricDef[];
interface ReliabilityMetricSummary {
    metric: string;
    category: string;
    mean: number;
    sd: number;
    median: number;
    min: number;
    max: number;
    q25: number;
    q75: number;
}
interface ReliabilityResult {
    iterations: Record<string, number[]>;
    summary: ReliabilityMetricSummary[];
    iter: number;
    split: number;
    modelType: string;
}
/**
 * Compare two TNA weight matrices using all 22 metrics.
 * Matches R's tna:::compare_ output exactly.
 */
declare function compareWeightMatrices(a: TNA, b: TNA): Record<string, number>;
/**
 * Perform split-half reliability analysis.
 *
 * Repeatedly splits the sequence data into two halves, builds a model on
 * each half, and compares the resulting weight matrices using 22 metrics
 * that exactly match R's tna:::compare_ output.
 */
type ReliabilityScale = 'none' | 'minmax' | 'standardize' | 'proportion';
interface NetworkReliabilityOptions {
    iter?: number;
    /** Fraction assigned to half A (default 0.5). 0 < split < 1. */
    split?: number;
    /** Cross-method scaling applied per iteration to each half matrix. */
    scale?: ReliabilityScale;
    seed?: number;
    /**
     * Optional per-iteration replay. Shape: number[iter][n_half_A]. When
     * provided, RNG sampling is skipped and these indices are used verbatim.
     * Only applies to the transition fast path; supplying replayIndices for a
     * model whose shape doesn't match will throw.
     *
     * Multi-model call: replayIndices map keyed by model name.
     */
    replayIndices?: number[][] | Record<string, number[][]>;
}
interface NetworkReliabilityIterations {
    mean_dev: number[];
    median_dev: number[];
    cor: number[];
    max_dev: number[];
}
interface NetworkReliabilitySummaryRow {
    model: string;
    metric: 'mean_dev' | 'median_dev' | 'cor' | 'max_dev';
    mean: number;
    sd: number;
}
interface NetworkReliabilityResult {
    iterations: Record<string, NetworkReliabilityIterations>;
    summary: NetworkReliabilitySummaryRow[];
    models: string[];
    iter: number;
    split: number;
    scale: ReliabilityScale;
}
/**
 * Nestimate-parity split-half reliability across one or more TNA models.
 *
 * Mirrors Nestimate::network_reliability (R/reliability.R) with the
 * transition-model fast path (same semantics as
 * `.reliability_transition`). Returns 4 metrics per iteration — superset
 * of these is already available via `reliabilityAnalysis` (22 metrics).
 *
 * For R-parity under deterministic index replay, pass `replayIndices`.
 */
declare function networkReliability(models: TNA | TNA[] | Record<string, TNA>, options?: NetworkReliabilityOptions): NetworkReliabilityResult;
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

/**
 * Markov-chain analysis — port of Nestimate::passage_time,
 * Nestimate::markov_stability, and Nestimate::markov_order_test
 * (Nestimate/R/markov.R + Nestimate/R/markov_order.R, 0.4.4).
 *
 * `passageTime` / `markovStability` are deterministic (pure linear algebra).
 * `markovOrderTest` is stochastic (within-w permutation LRT) and supports
 * replay-based index replay for cross-language parity.
 *
 * R reference identities preserved:
 *   - Row normalisation with warning when |rowSums - 1| > 1e-6 (threshold
 *     matches `.mpt_normalize_rows`).
 *   - Zero-row detection throws with a matching error message.
 *   - Kemeny-Snell fundamental matrix:  Z = (I − P + 1·πᵀ)^{-1},
 *     M[i,j] = (Z[j,j] − Z[i,j]) / π[j], diag(M) = 1/π.
 *   - Stationary distribution computed from (I − Pᵀ + J/n)·π = 1/n
 *     (see linalg.ts); equivalent to R's eigenvector extraction.
 *   - Sojourn time = Inf when persistence ≥ 1 − ε (double eps).
 *   - Data-frame columns in stability exactly match R's:
 *       state, persistence, stationary_prob, return_time, sojourn_time,
 *       avg_time_to_others, avg_time_from_others.
 *   - `markov_order_test` port:
 *       - Exact within-w permutation LRT; G² = 2·Σ N log(N/E), context-wise.
 *       - Layer DoF = Σ_rows max(nonzero − 1, 0) (Nestimate convention).
 *       - Log-likelihood: order-0 for step 1, order=min(step-1, k) afterwards,
 *         \x01-separated kgram keys.
 *       - Sequential selection: optimalOrder = last k in a contiguous run of
 *         rejections from k=1 (stop at first non-rejection).
 *       - AIC = 2·cumDof − 2·loglik, BIC = log(sum seq_lens)·cumDof − 2·loglik.
 *       - max_order capped to longest-1 with a console warning (R uses
 *         `message()`).
 *
 * Important: these functions intentionally do NOT round (unlike R's print
 * helpers which truncate to 2–4 decimals). Parity tests compare raw values.
 */

/** Input accepted by passageTime / markovStability. */
type MarkovInput = TNA | Matrix | number[][];
interface PassageTimeOptions {
    /** Restrict output to this subset of states. Default: all. */
    states?: string[];
    /** Auto-normalise rows if they don't sum to 1. Default true. */
    normalize?: boolean;
}
interface PassageTimeResult {
    /** n × n MFPT matrix (row i → column j). Diagonal = 1/π_i. */
    matrix: Matrix;
    /** Stationary distribution π aligned with `states`. */
    stationary: Float64Array;
    /**
     * Self-loop probabilities P_ii aligned with `states`. Added so that
     * `markovStability` can read them even after `states` filtering (R's
     * `passage_time` output doesn't expose `persistence`; we do, and also
     * re-derive it in `markovStability` to match R's exact pathway).
     */
    persistence: Float64Array;
    /** State labels aligned with `matrix` / `stationary`. */
    states: string[];
}
interface MarkovStabilityRow {
    state: string;
    persistence: number;
    stationaryProb: number;
    returnTime: number;
    sojournTime: number;
    avgTimeToOthers: number;
    avgTimeFromOthers: number;
}
interface MarkovStabilityResult {
    /** One row per state, in state order. */
    stability: MarkovStabilityRow[];
    /** Underlying passage-time object (matches R's `$mpt`). */
    mpt: PassageTimeResult;
}
/**
 * Mean First Passage Times (Kemeny-Snell).
 *
 * Element M[i,j] is the expected number of steps to travel from state i to
 * state j for the first time. Diagonal equals 1/π_i (mean recurrence time).
 *
 * Mirrors Nestimate::passage_time (R/markov.R).
 */
declare function passageTime(x: MarkovInput, options?: PassageTimeOptions): PassageTimeResult;
/**
 * Per-state Markov stability metrics.
 *
 * Mirrors Nestimate::markov_stability (R/markov.R) — every column in the
 * `stability` list matches the R data frame field-for-field.
 */
declare function markovStability(x: MarkovInput, options?: {
    normalize?: boolean;
}): MarkovStabilityResult;
/** Input accepted by `markovOrderTest` — trajectories, tnaj SequenceData, or TNA. */
type MarkovOrderInput = string[][] | SequenceData | TNA;
/** One row of the order-test table. */
interface MarkovOrderTestRow {
    order: number;
    loglik: number;
    AIC: number;
    BIC: number;
    /** df for LRT between order and order-1 (NaN for order 0). */
    df: number;
    /** G² statistic (NaN for order 0). */
    g2: number;
    /** Permutation p-value (NaN when df=0 or when no tuples). */
    pPermutation: number;
    /** Asymptotic χ² p-value. */
    pAsymptotic: number;
    /** `pPermutation < alpha` (false for order 0 or NaN). */
    significant: boolean;
}
/** Serialised replay shape for permutation indices.
 *
 * `permIndices[k-1]` is the replay block for order `k` (k in [1..maxOrder]).
 * Each block is `perm[p]` where `perm[p]` is a flat `number[]` of length
 * `tuples.length` — the **full** s-index vector after shuffle. For every
 * w-context, the successor positions inside that context are permuted;
 * singletons are left untouched. The flat layout lets JS replay by writing
 * `s[t] = s_orig[permFlat[t]]` per permutation (all JS needs is an index
 * mapping from the original position to the shuffled position — the x/w
 * columns never change).
 *
 * We use the **flat successor index vector** (length = nTuples) rather than
 * per-context block indices because it is: (a) the most compact JSON form R
 * can emit from inside a per-context shuffle loop, (b) trivially replayable
 * in JS with zero reconstruction overhead, and (c) robust to context
 * ordering differences between R and JS (the mapping is absolute).
 *
 * If `permIndices[k-1]` is missing or empty for any k, that order's
 * permutation is executed with the local RNG (seeded by `opts.seed`).
 */
interface MarkovOrderReplay {
    permIndices?: number[][][];
}
interface MarkovOrderOptions {
    /** Highest Markov order to test. Default 3. */
    maxOrder?: number;
    /** Within-w permutations per order. Default 500. */
    nPerm?: number;
    /** Significance level for sequential order selection. Default 0.05. */
    alpha?: number;
    /** Optional RNG seed (deterministic local permutation without replay). */
    seed?: number;
    /** Replay block — if present, each order's permutation stream is
     *  replaced by the supplied successor-index vectors. Guarantees bitwise
     *  agreement with external fixtures. */
    replay?: MarkovOrderReplay;
}
interface MarkovOrderResult {
    optimalOrder: number;
    bicOrder: number;
    aicOrder: number;
    /** One row per order, 0..maxOrder. */
    testTable: MarkovOrderTestRow[];
    /** Per-order empirical null G² distribution; `permutationNull[k-1]` is
     *  a `number[]` of length nPerm (or shorter if df=0). */
    permutationNull: number[][];
    /** Log-likelihood per order (length = maxOrder+1, order 0 first). */
    logliks: number[];
    /** Layer DoF per order (length = maxOrder+1, order 0 first). */
    layerDofs: number[];
    /** Fitted transition matrices (length = maxOrder+1); entry 0 is the
     *  order-0 marginal, stored as a 1×nStates Matrix for type uniformity.
     *  Entries 1..maxOrder are the kgram → kgram row-stochastic matrices. */
    transitionMatrices: Matrix[];
    /** Per-order kgram node labels (in the order used by each transition
     *  matrix). `transitionNodes[0]` = state labels from the marginal. */
    transitionNodes: string[][];
    /** Marginal state labels. */
    states: string[];
    /** Marginal probabilities aligned with `states`. */
    marginal: Float64Array;
    nSequences: number;
    nObservations: number;
    /** Per-order tuple count (length maxOrder). */
    nTuples: number[];
    nPerm: number;
    alpha: number;
    maxOrder: number;
}
/** Strip nulls/undefined and coerce an input into string[][]. */
declare function extractTrajectories(data: MarkovOrderInput): string[][];
interface KgramCounts {
    nodes: string[];
    nodeCounts: Map<string, number>;
    edges: {
        from: string;
        to: string;
        weight: number;
    }[];
}
/** Port of `.mogen_count_kgrams`. */
declare function kgramCounts(trajectories: string[][], k: number): KgramCounts;
declare function transitionMatrixFromKgrams(nodes: string[], edges: {
    from: string;
    to: string;
    weight: number;
}[]): Matrix;
/** Port of `.mogen_layer_dof`: per row, max(nonzero−1, 0); sum across rows. */
declare function layerDof(mat: Matrix): number;
/** Port of `.mogen_marginal`: names(table(unlist(...))) / sum. */
declare function marginalDistribution(trajectories: string[][]): {
    states: string[];
    probs: Float64Array;
};
/**
 * Port of `.mogen_log_likelihood`. `transMats[0]` is the order-0 marginal
 * (as a 1×nStates Matrix with column names = `transitionNodes[0]`), and
 * `transMats[k]` is the order-k kgram transition matrix.
 */
declare function logLikelihood(trajectories: string[][], k: number, transMats: Matrix[], transNodes: string[][]): number;
interface Tuples {
    x: string[];
    w: string[];
    s: string[];
    /** Context → sorted list of tuple indices for that w. */
    byContext: Map<string, number[]>;
}
/** Port of `.mot_extract_tuples`. */
declare function extractTuples(trajectories: string[][], k: number): Tuples;
/** Port of `.mot_g2`. Aggregates G² across all w-contexts. */
declare function g2Statistic(tuples: Tuples): {
    stat: number;
    df: number;
};
/**
 * Within-w permutation null. If `replayFlatIndices` is supplied, each entry
 * `replayFlatIndices[p]` is a length-nTuples integer vector; we set
 * `s[t] = s_orig[replayFlatIndices[p][t]]` for that permutation (the x/w
 * columns never change). If absent, use the RNG to shuffle s within each
 * context (singletons skipped, matching R's `if (length(idx) > 1L)` check).
 */
declare function withinWPermutation(tuples: Tuples, nPerm: number, rng: SeededRNG, replayFlatIndices?: number[][]): number[];
/** pchisq(q, df, lower.tail=FALSE) — matches R. */
declare function pchisqUpper(q: number, df: number): number;
declare function markovOrderTest(data: MarkovOrderInput, options?: MarkovOrderOptions): MarkovOrderResult;

/**
 * mmm — Mixture Markov Model clustering (basic deterministic EM).
 *
 * Pure-TypeScript, zero-dependency port of R `Nestimate:::.mmm_em` +
 * `.mmm_quality` (and `build_mmm`'s information criteria). This is the
 * canonical tnaj home of `MMMResult`; `tnaw` provides a WASM-accelerated
 * implementation with the *same* result shape, and `tnajw` dispatches
 * between them. The Rust kernel (`WASMengine/rust/src/kernels/mmm.rs`)
 * mirrors this file line-for-line — keep them in lock-step.
 *
 * **Different validation contract from the deterministic 1e-10-vs-R
 * analyses.** Mixture-cluster labels are identifiable only up to
 * permutation and EM converges to a *local* optimum, so equivalence is
 * "ARI=1 + loglik", never element-wise on raw cluster ids. The "basic
 * deterministic" qualifier — fixed seed, single start, no random restarts
 * — is what makes a *given* fit bit-reproducible run-to-run. Reference is
 * `Nestimate:::.mmm_em` (a deterministic R MMM with injectable init), NOT
 * stochastic `seqHMM`.
 *
 * Why it exists alongside `clusterData`: distance-based clustering needs a
 * dense O(n²) distance matrix; MMM is O(N·K), linear in N, so it clusters
 * 100k+ sequences where the O(n²) path is infeasible.
 *
 * ## Parity decisions (must match the Rust kernel — see its header)
 *
 * 1. **Counts == `Nestimate:::.precompute_per_sequence_wide`
 *    (`method="relative"`).** Per sequence, count *consecutive position
 *    pairs* `(x[t], x[t+1])` and increment `(from,to)` **only if both
 *    endpoints are non-NA**. This is deliberately NOT NA-compaction
 *    (`A,NA,B → A,B`); Nestimate breaks the pair (`A,NA,B → ∅`). Raw
 *    integer counts. Pair index `from*S + to` (0-based) ==
 *    `(from-1)*n_states + to` in R.
 * 2. **Initial state == `match(raw_data[i, col1], states)`** — the *first
 *    position only*, no scan-forward. NA there is "uninformative": it
 *    contributes 0 to the M-step initial-count, but the E-step adds the
 *    state-0 row of `log_init` (R's `init_state_safe = 1`).
 * 3. **EM mirrors `.mmm_em`**: log-space E-step, log-sum-exp, log-zero
 *    epsilon `1e-300` (== R's deparsed `9.99999999999999e-301`).
 * 4. **Single start.** Optional caller `initPosterior` (N×K row-major)
 *    consumed verbatim (the R-cross-check hook); else a seeded
 *    `SeededRNG` draw `post[i][m]=rng.random()` row-normalized.
 * 5. **Hard assignment = argmax_m post, lowest index wins ties**
 *    (R `max.col(ties.method="first")`).
 */

interface MmmOptions {
    /** Number of mixture components K (≥2). Required. */
    k: number;
    /** Max EM iterations. Default 200 (R `build_mmm`). */
    maxIter?: number;
    /** Convergence tolerance on |Δloglik|. Default 1e-8. */
    tol?: number;
    /** Laplace smoothing (R `smooth`). Default 0.01 (R `build_mmm`). */
    alpha?: number;
    /** Seed for the deterministic init. Default 42. Ignored when
     *  `initPosterior` is supplied. */
    seed?: number;
    /**
     * COVARIATES on cluster membership — n x p, WITHOUT an intercept column (one is added).
     *
     * With these, the mixing weights stop being a single vector and become a multinomial logit
     * on the case: pi_i = softmax([1, X_i] · B). Membership is then MODELLED rather than
     * described after the fact, which is the whole point — the post-hoc route (cluster, then
     * ANOVA the covariates against the hard labels) discards classification uncertainty and
     * reports p-values that are too confident.
     */
    covariates?: number[][];
    /** Column names for `covariates`, length p. Reported with the coefficients. */
    covariateNames?: string[];
    /** The reference cluster, 1-indexed (its coefficients are fixed at 0). Default 1. */
    refCluster?: number;
    /** Number of independent EM starts (default 1). EM finds a *local*
     *  optimum, so on multimodal data more starts can find a better one.
     *  Uses the deterministic seed sequence `seed, seed+1, …,
     *  seed+nStarts-1` and returns the highest-logLik fit (ties → lowest
     *  seed), so the *whole* multi-start result stays reproducible.
     *  Inspect {@link MMMResult.restartLogLiks} to see whether the extra
     *  starts actually found anything. Forced to 1 when `initPosterior`
     *  is supplied (an explicit init is a single explicit start). */
    nStarts?: number;
    /** Optional N×K row-major starting responsibilities, consumed verbatim
     *  (the R-cross-check hook: feed both engines the same init so a
     *  0-restart EM lands in the same basin). */
    initPosterior?: Float64Array | number[];
}
/** Cluster-quality block — port of Nestimate `.mmm_quality`. */
interface MmmQuality {
    /** Average Posterior Probability per cluster (length k). `NaN` for an
     *  empty hard-assignment cluster (R `NA_real_`). */
    avepp: Float64Array;
    /** Overall AvePP — mean over sequences of the max posterior. */
    aveppOverall: number;
    /** Normalized entropy ∈ [0,1]: 0 = perfect separation, 1 = random. */
    entropy: number;
    /** 1 − entropy. */
    relativeEntropy: number;
    /** Fraction of sequences whose max posterior < 0.5. */
    classificationError: number;
    /** ICL classification entropy: −Σ log(posterior[i, assignment_i] + ε). */
    classEntropy: number;
}
/** Canonical Mixture-Markov-Model result. `transition[m]` is a
 *  row-stochastic S×S `Matrix` for cluster m (row = "from", col = "to"). */
interface MMMResult {
    k: number;
    /** 1-indexed hard assignment per sequence (ties → lowest index). */
    assignments: number[];
    /** Posterior responsibilities, n rows × k. */
    responsibilities: number[][];
    /** Mixing weights, length k. */
    pi: Float64Array;
    /** Initial-state distribution per cluster (k arrays, each length S). */
    delta: Float64Array[];
    /** Transition matrix per cluster (k × S×S, row-stochastic). */
    transition: Matrix[];
    logLik: number;
    /** Free parameters: k·S·(S−1) transitions + k·(S−1) initials + the mixing block —
     *  (k−1) without covariates, (k−1)·(p+1) with them. Reported rather than left implicit in
     *  AIC/BIC, because a fit report that shows AIC without saying what it penalised is asking
     *  the reader to take the penalty on trust. */
    df: number;
    aic: number;
    bic: number;
    /** Integrated Completed Likelihood = BIC + 2·classEntropy. */
    icl: number;
    /** Cluster-quality metrics (Nestimate `.mmm_quality`). */
    quality: MmmQuality;
    iterations: number;
    converged: boolean;
    /** EM starts performed (1 if `initPosterior` was supplied, else
     *  `nStarts`). The returned fit is the best of these. */
    nStarts: number;
    /** Per-restart converged logLik, in seed order (`seed..seed+nStarts`).
     *  `Math.max(...restartLogLiks) === logLik`. If every entry is the
     *  same value, the extra starts found nothing — one start sufficed and
     *  you can prove it; a wide spread means restarts mattered. */
    restartLogLiks: Float64Array;
    /** State vocabulary (sorted unique non-NA tokens — R `build_mmm`). */
    labels: string[];
    /** Number of input sequences (== assignments.length). */
    nSequences: number;
    /** Covariate model on cluster membership — present only when `covariates` was supplied. */
    covariateModel?: CovariateModel;
}
/** The multinomial logit on cluster membership: who ends up where, and how sure we are. */
interface CovariateModel {
    /** ['(Intercept)', ...covariateNames] */
    terms: string[];
    /** The reference cluster, 1-indexed. Its coefficients are 0 by definition. */
    refCluster: number;
    /** The non-reference clusters, 1-indexed, in coefficient-row order. */
    clusters: number[];
    /** coefficients[m][j] — log-odds of cluster `clusters[m]` vs the reference, per unit of term j. */
    coefficients: number[][];
    /** exp(coefficients) — the odds-ratio reading. */
    oddsRatios: number[][];
    /** Standard errors by LOUIS' identity (observed = complete - missing information), so
     *  classification uncertainty is IN them. See multinom.ts. NaN where the information
     *  matrix is not invertible (a covariate that separates the clusters perfectly). */
    se: number[][];
    /** Wald z = coefficient / se, and its two-sided p. */
    z: number[][];
    pValues: number[][];
    /** Per-sequence prior cluster probabilities softmax([1,X_i]·B), n x k. */
    priors: number[][];
    /** False when the information matrix could not be inverted — SEs are NaN and the
     *  coefficients should be read as "separation", not as estimates. */
    seOk: boolean;
}
type MmmInput = string[][] | SequenceData | TNA;
/**
 * Fit a Mixture Markov Model by single-start deterministic EM.
 *
 * @param data Sequence rows (wide format — positions are NOT compacted; an
 *   interior NA breaks a transition pair, matching R), or a `TNA` with
 *   `.data` (its `.labels` are reused as the state set, like R
 *   `build_mmm` on a tna object).
 * @param options See {@link MmmOptions}. `k` is required.
 */
/**
 * Validate resolved MMM hyper-parameters, mirroring R `build_mmm`'s
 * `stopifnot` block (finite/positive/whole guards) so invalid input fails
 * loud at the API boundary instead of silently degrading (e.g. `tol<=0`
 * never converges; `maxIter<1` yields a −Inf "fit"; `alpha<0` takes the
 * log of a negative). Exported so tnaj and tnaw enforce the *same*
 * contract — `tnajw` may dispatch to either, so the errors must match.
 */
declare function validateMmmOptions(o: {
    k: number;
    maxIter: number;
    tol: number;
    alpha: number;
    seed: number;
    nStarts: number;
}): void;
declare function mmm(data: MmmInput, options: MmmOptions): MMMResult;
/** MMM clustering metadata carried on the `GroupTNA` returned by
 *  {@link clusterMmm}. Mirrors R `net_mmm_clustering`: everything the
 *  {@link MMMResult} has except the per-cluster networks (those are the
 *  `models`). Lets downstream tnaj group tooling recover the soft
 *  assignment, fit, and quality without re-running EM. */
interface MmmClustering {
    k: number;
    /** 1-indexed hard assignment per sequence (ties → lowest index). */
    assignments: number[];
    /** Posterior responsibilities, n rows × k. */
    responsibilities: number[][];
    /** Mixing weights, length k. */
    mixing: Float64Array;
    /** Cluster-quality metrics (Nestimate `.mmm_quality`). */
    quality: MmmQuality;
    logLik: number;
    /** Free parameters (see MMMResult.df). */
    df: number;
    aic: number;
    bic: number;
    icl: number;
    iterations: number;
    converged: boolean;
    nStarts: number;
    /** The membership logit, when covariates were supplied. Carried through clusterMmm so a
     *  caller that clusters through the GroupTNA wrapper can still report WHO ends up where —
     *  otherwise the whole point of fitting with covariates is lost at the wrapper boundary. */
    covariateModel?: CovariateModel;
    restartLogLiks: Float64Array;
    labels: string[];
    nSequences: number;
    /** The full N-row sequence frame used for estimation, aligned to
     *  `assignments` (so a caller can recover both for sequence plots). */
    data: SequenceData;
}
/** A {@link GroupTNA} (one TNA per mixture component) plus the MMM
 *  clustering metadata. The extra `clustering` field is additive — the
 *  object is still a structurally valid `GroupTNA`, so it flows through
 *  every tnaj group consumer (group plots, `compareModels`, etc.). */
interface MmmGroupTNA extends GroupTNA {
    clustering: MmmClustering;
}
/**
 * Cluster sequences with a Mixture Markov Model and return a
 * {@link GroupTNA} — one TNA per component, the EM-estimated transition
 * matrix as its `weights` and the EM initial distribution as its `inits`,
 * carrying the rows assigned to that component in `data`. This is the
 * model-based counterpart to distance-based `clusterData`, and the tnaj
 * analogue of R `Nestimate::cluster_mmm` (which returns a
 * `netobject_group` + `attr(,"clustering")`).
 *
 * For the raw fit (responsibilities, ICs, quality) without the per-cluster
 * networks, call {@link mmm} directly — this wraps it and additionally
 * exposes the same numbers on `.clustering`.
 *
 * @example
 * const grp = clusterMmm(seqs, { k: 3 });
 * grp.models['Cluster 1'].weights;        // component-1 transition TNA
 * grp.clustering.assignments;             // hard labels (1..k)
 * grp.clustering.quality.aveppOverall;    // fit quality
 */
declare function clusterMmm(data: MmmInput, options: MmmOptions): MmmGroupTNA;
interface MmmAssignParams {
    /** Mixing weights (MMMResult.pi / MmmClustering.mixing). */
    pi: ArrayLike<number>;
    /** Initial-state distribution per cluster (MMMResult.delta). */
    delta: ArrayLike<number>[];
    /** Row-stochastic S×S transition matrix per cluster (MMMResult.transition). */
    transition: Matrix[];
    /** State vocabulary the mixture was fitted on (MMMResult.labels). */
    labels: string[];
}
interface MmmAssignResult {
    /** 1-indexed hard assignment per sequence (ties → lowest index). */
    assignments: number[];
    /** Max posterior per sequence (softmax over the k component log-scores). */
    avepp: Float64Array;
    /** Mean of `avepp`. */
    aveppOverall: number;
    /** Per-cluster sequence counts, length k. */
    counts: number[];
    nSequences: number;
}
/**
 * Assign every sequence to its maximum-posterior mixture component.
 *
 * @param data  Sequences (same shapes `mmm`/`clusterMmm` accept).
 * @param params  Fitted mixture parameters — pass the fields straight off an
 *   `MMMResult`, or reassemble from a `clusterMmm` result (`clustering.mixing`,
 *   the models' `inits`/`weights`, `clustering.labels`).
 */
declare function mmmAssign(data: MmmInput, params: MmmAssignParams): MmmAssignResult;

export { extractTuples as $, type PermutationResult as A, type PermutationWtnaInput as B, type CasedropReliabilityMetricMatrix as C, type ReliabilityMetricSummary as D, type EdgeStabilityResult as E, type ReliabilityResult as F, type ReliabilityScale as G, type RepresentativeResult as H, type StabilityResult as I, type StabilitySummaryRow as J, type StabilityWtnaInput as K, casedropReliability as L, type MMMResult as M, type NetworkReliabilityIterations as N, estimateCS as O, type PassageTimeOptions as P, clusterData as Q, RELIABILITY_METRICS as R, type StabilityOptions as S, clusterMmm as T, clusterSequences as U, compareWeightMatrices as V, computeDendrogram as W, estimateCsWtna as X, estimateEdgeStability as Y, estimateNetworkStability as Z, extractTrajectories as _, type CasedropReliabilityOptions as a, findRepresentatives as a0, g2Statistic as a1, kgramCounts as a2, layerDof as a3, logLikelihood as a4, marginalDistribution as a5, markovOrderTest as a6, markovStability as a7, mmm as a8, mmmAssign as a9, reliabilityAnalysis as aa, networkReliability as ab, passageTime as ac, pchisqUpper as ad, permutationTest as ae, permutationTestWtna as af, transitionMatrixFromKgrams as ag, validateMmmOptions as ah, withinWPermutation as ai, type CasedropReliabilityResult as b, type CasedropReliabilitySummaryRow as c, type EdgeStat as d, type MarkovInput as e, type MarkovOrderInput as f, type MarkovOrderOptions as g, type MarkovOrderReplay as h, type MarkovOrderResult as i, type MarkovOrderTestRow as j, type MarkovStabilityResult as k, type MarkovStabilityRow as l, type MetricDef as m, type MmmAssignParams as n, type MmmAssignResult as o, type MmmClustering as p, type MmmGroupTNA as q, type MmmInput as r, type MmmOptions as s, type MmmQuality as t, type NetworkReliabilityOptions as u, type NetworkReliabilityResult as v, type NetworkReliabilitySummaryRow as w, type NetworkStabilityResult as x, type PassageTimeResult as y, type PermutationOptions as z };
