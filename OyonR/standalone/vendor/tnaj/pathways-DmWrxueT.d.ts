import { C as CentralityMeasure, T as TNA, G as GroupTNA, a as CentralityResult, b as CliqueResult, d as CommunityMethod, e as CommunityResult, f as CompareRow, h as SequenceData, M as Matrix } from './types-C4ftN5gs.js';
import { P as PAdjustMethod } from './pAdjust-DGekUM6t.js';

declare const AVAILABLE_MEASURES: CentralityMeasure[];
/**
 * Compute centrality measures for a TNA model.
 */
declare function centralities(model: TNA | GroupTNA, options?: {
    loops?: boolean;
    normalize?: boolean;
    measures?: CentralityMeasure[];
}): CentralityResult;
/**
 * Compute edge betweenness centrality and return as a new TNA model.
 */
declare function betweennessNetwork(model: TNA | GroupTNA): TNA | Record<string, TNA>;

/**
 * Pruning functions for TNA models.
 * Port of Python tna/prune.py + disparity filter (Serrano et al. 2009).
 */

interface PruneOptions {
    /** Pruning method. Default `'threshold'`, as in R `tna::prune`. */
    method?: 'threshold' | 'lowest' | 'disparity';
    /** Minimum edge weight for the `threshold` method (default 0.1). Edges with
     *  `0 < weight <= threshold` are candidates for removal. */
    threshold?: number;
    /** For the `lowest` method: the PROPORTION of non-zero edges to cut (default 0.05).
     *  The cut-off is `quantile(positive weights, lowest)` — R's `prune(lowest = )`. */
    lowest?: number;
    /**
     * Significance level for the disparity filter. Default 0.5, matching R
     * `tna::prune(method = "disparity", level = )`.
     *
     * R spells this parameter `level`; it is accepted as an alias below so an R script
     * ports across unchanged. (It was `alpha`, default 0.05, until 2026-07-13 — a caller
     * passing R's `level` was silently ignored and got 0.05.)
     */
    alpha?: number;
    /** Alias for `alpha` — R's spelling. */
    level?: number;
}
/**
 * Prune edges from a TNA model — R `tna::prune`.
 *
 * Accepts either a bare threshold number (backward compatible) or an options object.
 * Three methods, all matching R:
 *   `threshold` (default) — cut edges with `0 < weight <= threshold` (default 0.1)
 *   `lowest`              — cut the lowest `lowest` proportion of non-zero edges,
 *                           i.e. below `quantile(positive weights, lowest)` (default 0.05)
 *   `disparity`           — Serrano et al. 2009 backbone at significance `level` (default 0.5)
 *
 * `threshold` and `lowest` remove edges ONE AT A TIME and keep any edge whose removal
 * would disconnect the graph (R's `is_weakly_connected` guard) — so they differ only in
 * how the cut-off is computed.
 *
 * An unknown method THROWS. It used to fall through to threshold-pruning at the default
 * 0.1, so `{method: 'lowest'}` — which R has and tnaj did not — silently returned a
 * plausible, wrong model instead of erroring. A confidently-returned wrong number is worse
 * than a crash.
 */
declare function prune(model: TNA | GroupTNA, thresholdOrOptions?: number | PruneOptions): TNA | Record<string, TNA>;
/**
 * Disparity filter backbone extraction (Serrano et al. 2009).
 * Matches R tna::prune(method="disparity") which uses both out-degree and
 * in-degree p-values, taking pmin. Self-loops are always removed.
 */
declare function pruneDisparity(model: TNA, alpha?: number): TNA;

/**
 * Find directed cliques in a TNA model.
 * A directed clique of size k is a set of k nodes where every pair
 * has edges in BOTH directions above the threshold.
 */
declare function cliques(model: TNA | GroupTNA, options?: {
    size?: number;
    threshold?: number;
}): CliqueResult | Record<string, CliqueResult>;

declare const AVAILABLE_METHODS: CommunityMethod[];
/**
 * Detect communities in a TNA model.
 */
declare function communities(model: TNA | GroupTNA, options?: {
    methods?: CommunityMethod | CommunityMethod[];
}): CommunityResult | Record<string, CommunityResult>;

/**
 * Compare sequential patterns across groups + model comparison.
 * Port of Python tna/compare.py
 */

/**
 * Standardized ADJUSTED residuals of a contingency table — R's `chisq.test()$stdres`.
 *
 *     z[i][j] = (o - e) / sqrt( e * (1 - rowSum[i]/N) * (1 - colSum[j]/N) ),  e = r*c/N
 *
 * NOT the Pearson residual `(o - e) / sqrt(e)`, which ignores the marginals and is
 * therefore systematically too small — it is not N(0,1) under independence, so the
 * "|z| > 1.96 means p < .05" reading that every heatmap legend makes is simply wrong
 * for it. Nestimate reports `stdres` (R/cluster_data.R) and so do we; one definition,
 * one home, so no caller has to reinvent it (two of them did, differently).
 *
 * A degenerate cell (an empty row or an empty column — nothing to be surprised by)
 * yields 0 rather than NaN, so the value is always safe to sort and colour by.
 *
 * Worth knowing: for a TWO-column table the columns are exact mirrors,
 * z[i][0] === -z[i][1] — the numerators negate and the denominators coincide. That is
 * what makes a two-group pyramid symmetric, and it is a fact about the table, not a
 * drawing convention.
 */
declare function stdResiduals(counts: number[][]): number[][];
/**
 * Compare subsequence patterns across groups.
 *
 * To compare a single PAIR out of K > 2 groups, hand this a GroupTNA holding just those
 * two models. Every number then describes that pair alone: the marginals, the residuals
 * and the permutation null are all recomputed without the other groups, which is what a
 * pairwise question actually asks. Passing all K and reading two columns would instead
 * answer "each group vs the pooled rest" — a different question wearing the same clothes.
 */
declare function compareSequences(x: GroupTNA, options?: {
    sub?: number[];
    minFreq?: number;
    test?: boolean;
    iter?: number;
    adjust?: 'bonferroni' | 'holm' | 'fdr' | 'BH' | 'none';
    seed?: number;
}): CompareRow[];
/**
 * Compare two TNA models using 22 reliability metrics.
 * Wraps compareWeightMatrices as a first-class export.
 */
declare function compareModels(a: TNA, b: TNA): Record<string, number>;

/**
 * Simulate sequence data from a TNA model via Markov chain.
 */

interface SimulateOptions {
    /** Number of sequences to generate (default 50). */
    n?: number;
    /** Sequence length: fixed number or [min, max] range (default 20). */
    seqLength?: number | [number, number];
    /** Random seed (default 42). */
    seed?: number;
}
/**
 * Simulate sequences by walking the Markov chain defined by the model.
 * Initial states are sampled from model.inits; transitions use model.weights rows.
 */
declare function simulate(model: TNA, options?: SimulateOptions): SequenceData;

/**
 * Directly-Follows Graph (DFG) — process map computation.
 *
 * Builds a process-mining-style DFG from a TNA model or its sequence data.
 * Three metric modes: absolute counts, relative proportions, case-based fractions.
 */

/** Metric mode for process map labels. */
type DFGMetric = 'absolute' | 'relative' | 'case';
/** A node in the directly-follows graph. */
interface DFGNode {
    /** Activity/state label. */
    id: string;
    /** Node role: regular activity, synthetic start, or synthetic end. */
    type: 'activity' | 'start' | 'end';
    /** Total occurrences across all sequences. */
    absoluteFreq: number;
    /** absoluteFreq / sum of all absoluteFreqs. */
    relativeFreq: number;
    /** Fraction of sequences (cases) containing this state. */
    caseFreq: number;
}
/** A directed edge in the DFG. */
interface DFGEdge {
    from: string;
    to: string;
    /** Raw directly-follows count. */
    absoluteCount: number;
    /** absoluteCount / sum of all edge counts. */
    relativeCount: number;
    /** Fraction of cases containing this directly-follows pair. */
    caseCount: number;
}
/** Complete DFG result. */
interface DFGResult {
    nodes: DFGNode[];
    edges: DFGEdge[];
    /** Number of input sequences (cases). */
    totalSequences: number;
    /** Total directly-follows transitions counted. */
    totalTransitions: number;
}
/** Options for buildDFG. */
interface DFGOptions {
    /** Label to identify the synthetic start state (if present in sequences). */
    startLabel?: string;
    /** Label to identify the synthetic end state (if present in sequences). */
    endLabel?: string;
}
/**
 * Build a directly-follows graph from a TNA model.
 *
 * Uses `model.data` (the original sequences) when available for accurate
 * per-case metrics. Falls back to the weight matrix for transition counts
 * when sequences are not stored (e.g., matrix-input models).
 *
 * For GroupTNA, returns a record of per-group DFG results.
 */
declare function buildDFG(model: TNA | GroupTNA, options?: DFGOptions): DFGResult | Record<string, DFGResult>;
/**
 * Build a DFG directly from sequence data (without needing a TNA model).
 * Useful when you have raw sequences but haven't built a model yet.
 */
declare function buildDFGFromSequences(sequences: SequenceData, labels?: string[], startLabel?: string, endLabel?: string): DFGResult;

/**
 * Multi-Order Generative Model (MOGen) — port of Nestimate::build_mogen,
 * mogen_transitions, path_counts, state_frequencies (R/mogen.R, 0.5.1).
 *
 * Implements multi-order De Bruijn graph models for sequential data
 * (Scholtes 2017; Gote & Scholtes 2023).
 *
 * At order k, nodes are k-tuples of states from trajectories and edges
 * connect consecutive (overlapping by k-1) k-tuples. The model builds
 * order-0 (marginal) up to order-K layers, computes log-likelihood,
 * AIC, BIC at each order, and selects the optimal Markov order via the
 * chosen information criterion (AIC, BIC, or sequential LRT).
 */

type MogenInput = string[][] | SequenceData | TNA;
type MogenCriterion = 'aic' | 'bic' | 'lrt';
interface MogenOptions {
    maxOrder?: number;
    criterion?: MogenCriterion;
    lrtAlpha?: number;
}
interface MogenResult {
    optimalOrder: number;
    criterion: MogenCriterion;
    orders: number[];
    aic: number[];
    bic: number[];
    logLikelihood: number[];
    dof: number[];
    layerDof: number[];
    /** transitionMatrices[0] is a 1×nStates Matrix of the order-0 marginal,
     *  transitionMatrices[k] (k ≥ 1) is the order-k k-gram transition matrix. */
    transitionMatrices: Matrix[];
    /** countMatrices[k] (k ≥ 1) is the raw k-gram count matrix at order k.
     *  Index 0 is unused (we keep alignment with transitionMatrices). */
    countMatrices: Matrix[];
    /** Per-order node labels (k-grams as HON_SEP-joined strings).
     *  transitionNodes[0] = first-order state labels (the marginal columns). */
    transitionNodes: string[][];
    states: string[];
    nPaths: number;
    nObservations: number;
}
interface MogenTransitionRow {
    path: string;
    count: number;
    probability: number;
    from: string;
    to: string;
}
interface PathCountRow {
    path: string;
    count: number;
    proportion: number;
}
interface StateFrequencyRow {
    state: string;
    count: number;
    proportion: number;
}
declare function buildMogen(data: MogenInput, options?: MogenOptions): MogenResult;
declare function mogenTransitions(mg: MogenResult, options?: {
    order?: number;
    minCount?: number;
}): MogenTransitionRow[];
declare function pathCounts(data: MogenInput, k?: number, top?: number): PathCountRow[];
declare function stateFrequencies(data: MogenInput): StateFrequencyRow[];

/**
 * Higher-Order Network (HON) — port of Nestimate::build_hon (R/hon.R, 0.5.1).
 *
 * Implements both BuildHON (Xu, Wickramarathne & Chawla 2016) and BuildHON+
 * (Saebi et al. 2020) algorithms. The latter is the default — it lazily
 * builds higher-order observations and applies a MaxDivergence pre-check
 * to prune branches that cannot possibly exceed the KLD threshold.
 *
 * Algorithm:
 *   1. Parse trajectories (strip nulls, optional collapse_repeats).
 *   2. Build observation counts and probability distributions per source key.
 *   3. Recursively extend each first-order source. Extension is justified
 *      iff KL-divergence between the extended distribution and the current
 *      valid distribution exceeds an adaptive threshold = order/log2(1+N).
 *   4. Build the network from accepted rules. Rewire edges so higher-order
 *      nodes are properly connected (.hon_rewire and .hon_rewire_tails).
 *   5. Emit an adjacency matrix in arrow notation plus the edge list.
 */

type HonInput = string[][] | SequenceData | TNA;
type HonMethod = 'hon+' | 'hon';
interface HonOptions {
    /** Maximum HON order (default 5). */
    maxOrder?: number;
    /** Minimum count for a transition to be retained (default 1). */
    minFreq?: number;
    /** Collapse adjacent duplicate states within each trajectory (default false). */
    collapseRepeats?: boolean;
    /** Algorithm: "hon+" (default, parameter-free with MaxDivergence pruning)
     *  or "hon" (original BuildHON with eager observation building). */
    method?: HonMethod;
}
interface HonEdgeRow {
    /** Full state path in arrow notation (e.g. "A -> B -> C"). */
    path: string;
    /** Source context in arrow notation. */
    from: string;
    /** Predicted next state. */
    to: string;
    /** Raw observation count. */
    count: number;
    /** Transition probability. */
    probability: number;
    /** Order (length) of the source tuple. */
    fromOrder: number;
    /** Order (length) of the target tuple, after rewiring. */
    toOrder: number;
}
interface HonResult {
    /** Adjacency matrix (rows = from, cols = to), arrow-notation labels. */
    matrix: Matrix;
    nodes: string[];
    edges: HonEdgeRow[];
    nNodes: number;
    nEdges: number;
    firstOrderStates: string[];
    maxOrderRequested: number;
    maxOrderObserved: number;
    minFreq: number;
    nTrajectories: number;
    directed: true;
    method: HonMethod;
}
declare function buildHon(data: HonInput, options?: HonOptions): HonResult;

/**
 * HYPA — port of Nestimate::build_hypa (R/hypa.R, 0.5.1).
 *
 * Detects path anomalies in sequential data via a multi-hypergeometric
 * null model on the k-th order De Bruijn graph (LaRock et al. 2020).
 * For each edge (v, w) with observed weight f, computes:
 *   p_under = P(X <= f), p_over = P(X >= f)
 * where X ~ Hypergeometric(N, K, n) with
 *   N = round(sum(Xi)), K = round(Xi[v,w]), n = sum(adj),
 *   Xi[v,w] = out_strength[v] * in_strength[w].
 *
 * Anomalies are classified using BH-adjusted p-values against `alpha`.
 */

type HypaInput = string[][] | SequenceData | TNA;
interface HypaOptions {
    k?: number;
    alpha?: number;
    minCount?: number;
    pAdjustMethod?: PAdjustMethod | 'none';
}
interface HypaScoreRow {
    path: string;
    from: string;
    to: string;
    observed: number;
    expected: number;
    ratio: number;
    /** Alias for pUnder (matches R's `p_value` column). */
    pValue: number;
    pUnder: number;
    pOver: number;
    pAdjustedUnder: number;
    pAdjustedOver: number;
    anomaly: 'over' | 'under' | 'normal';
}
interface HypaResult {
    scores: HypaScoreRow[];
    /** Adjacency matrix of the De Bruijn graph (rows = from, cols = to). */
    adjacency: Matrix;
    adjacencyLabels: string[];
    /** Propensity matrix Xi[i,j] = out_strength[i] * in_strength[j] for cells with edges. */
    xi: Matrix;
    k: number;
    alpha: number;
    pAdjust: PAdjustMethod | 'none';
    nAnomalous: number;
    nOver: number;
    nUnder: number;
    nEdges: number;
    nodes: string[];
    directed: true;
}
declare function buildHypa(data: HypaInput, options?: HypaOptions): HypaResult;

/**
 * HONEM — port of Nestimate::build_honem (R/honem.R, 0.5.1).
 *
 * Higher-Order Network Embeddings via direct matrix factorization
 * (Saebi et al. 2020). No random walks or skip-gram — uses
 * exponentially-decaying powers of the transition matrix and truncated SVD.
 *
 *   D = row-normalized HON transition matrix
 *   S = (1/Z) * sum_{k=0..L} exp(-k) * D^{k+1},  Z = sum exp(-k)
 *   S = U * diag(sigma) * V^T  (truncated to top `dim` components)
 *   embeddings = U[, 1:dim] * diag(sqrt(sigma[1:dim]))
 *
 * Singular vectors are sign-ambiguous; the equivalence test compares
 * |embedding| element-wise (and singular values exactly), which is the
 * only invariant component of the result.
 */

type HonemInput = HonResult | Matrix;
interface HonemOptions {
    dim?: number;
    maxPower?: number;
}
interface HonemResult {
    embeddings: Matrix;
    nodes: string[];
    singularValues: Float64Array;
    explainedVariance: number;
    dim: number;
    maxPower: number;
    nNodes: number;
}
declare function buildHonem(hon: HonemInput, options?: HonemOptions): HonemResult;

/**
 * Path Dependence — port of Nestimate::path_dependence (R/path_dependence.R, 0.5.1).
 *
 * Diagnoses where a chain's order-1 Markov assumption fails by comparing,
 * for each order-k context, the empirical next-state distribution
 * P(next | full context) against the order-1 prediction P(next | last state).
 * Returns per-context KL, entropy drop, modal-flip flag, plus chain-level
 * count-weighted aggregates.
 *
 * Input is a wide sequence data.frame / matrix in R (rows = trajectories,
 * cols = time steps). In tnaj that maps directly to `SequenceData` —
 * `(string | null)[][]` — so callers pass that without conversion.
 */

type PathDependenceInput = SequenceData | string[][];
interface PathDependenceOptions {
    order?: number;
    minCount?: number;
    base?: number;
}
interface PathDependenceContextRow {
    context: string;
    n: number;
    hOrder1: number;
    hOrderK: number;
    hDrop: number;
    kl: number;
    topO1: string;
    topOk: string;
    flips: boolean;
}
interface PathDependenceResult {
    contexts: PathDependenceContextRow[];
    chain: {
        klWeighted: number;
        hDropWeighted: number;
        nContexts: number;
        nFlips: number;
    };
    order: number;
    base: number;
    minCount: number;
    states: string[];
}
declare function pathDependence(data: PathDependenceInput, options?: PathDependenceOptions): PathDependenceResult;

/**
 * Simplicial complex construction — port of Nestimate::build_simplicial
 * (R/simplicial.R). Supports the canonical type = "clique" construction:
 *
 *   1. Symmetrize the adjacency: w[i,j] = max(|w[i,j]|, |w[j,i]|).
 *   2. Threshold: edge iff w > 0 AND (w >= threshold [inclusive] or
 *      w > threshold [exclusive]).
 *   3. Bron-Kerbosch to enumerate maximal cliques.
 *   4. Expand each maximal clique to all sub-simplices (faces) up to size
 *      maxDim + 1.
 *   5. Ensure every vertex appears as a 0-simplex.
 *
 * Plus `bettiNumbers` (rank computation on the integer boundary matrices via
 * fraction-free Bareiss elimination — bit-equivalent to R's `qr(bmat)$rank`
 * for the {-1,0,1}-valued boundary matrices produced here) and
 * `eulerCharacteristic` (sum of (-1)^k * f_k).
 *
 * Verified against Nestimate::build_simplicial 0.5.4 in
 * verify/per-verb/nestimate-simplicial/.
 */

type SimplicialInput = Matrix | number[][] | TNA;
/** Minimal pathway-source shape — anything with a `path` field of the form
 *  "A -> B -> C" plus a node list. Matches the on-disk shape of tnaj's
 *  HonResult, HypaResult, and MogenTransitionRow[] (with explicit `nodes`). */
interface PathwayLikeInput {
    /** Either pathway rows directly, or an HON-family result that exposes
     *  `edges` (HON), `scores` (HYPA), or `transitions` (MOGen-derived).
     *  Each row must have a `path` field; HYPA rows additionally have
     *  `anomaly` and `ratio` used for filtering and ordering. */
    paths?: {
        path: string;
        ratio?: number;
        anomaly?: 'over' | 'under' | 'normal';
    }[];
    /** First-order state alphabet — the node set of the resulting complex. */
    firstOrderStates?: string[];
    /** MOGen-style state alphabet. */
    states?: string[];
    /** HYPA-style nodes. */
    nodes?: string[];
}
interface SimplicialOptions {
    /** Construction type. "clique" (default) on any matrix/TNA, or "pathway"
     *  for an HON-family input (PathwayLikeInput). */
    type?: 'clique' | 'pathway';
    /** Minimum non-zero absolute edge weight to include an edge. Default 0.
     *  Clique-mode only. */
    threshold?: number;
    /** Maximum simplex dimension (a k-simplex has k+1 nodes). Default 10. */
    maxDim?: number;
    /** Include edges with weight strictly greater than threshold when false;
     *  include weight >= threshold when true. Default true (matches R). */
    inclusive?: boolean;
    /** Optional node labels (used when x is a raw matrix without labels). */
    labels?: string[];
    /** Pathway-mode only: cap on the number of pathways read into the complex.
     *  Applied AFTER ordering/filtering. Default: no cap. */
    maxPathways?: number;
    /** Pathway-mode only, HYPA: which anomaly class to include. Default 'all'
     *  (every non-normal anomaly). */
    anomaly?: 'all' | 'over' | 'under';
}
interface SimplicialComplex {
    /** All simplices as sorted 0-based vertex-index tuples. */
    simplices: number[][];
    /** Node labels (length nNodes). */
    nodes: string[];
    nNodes: number;
    nSimplices: number;
    /** Maximum simplex dimension k where a k-simplex has k+1 vertices. */
    dimension: number;
    /** Counts per dimension, indices 0..dimension. */
    fVector: number[];
    /** Density = nSimplices / sum_{d=0..dim} C(nNodes, d+1). */
    density: number;
    /** Mean simplex dimension. */
    meanDim: number;
    type: 'clique' | 'pathway' | 'vr';
}
declare function buildSimplicial(x: SimplicialInput | PathwayLikeInput, options?: SimplicialOptions): SimplicialComplex;
/** Pathway-mode simplicial complex.
 *
 *  Port of Nestimate::.build_simplicial_pathway (R/simplicial.R:184-274).
 *
 *  Accepts:
 *   - HON-style: `{ edges: [{ path, fromOrder, count }, ...], firstOrderStates }`
 *     — uses higher-order edges only (`fromOrder > 1`), ordered by descending count.
 *   - HYPA-style: `{ scores: [{ path, anomaly, ratio }, ...], nodes }` — filters
 *     by anomaly class, orders by |ratio|.
 *   - MOGen-style derived: `{ transitions: [{ path }, ...], states }` — uses the
 *     already-computed mogen_transitions output.
 *   - Raw: `{ paths: [{ path, ... }], firstOrderStates | states | nodes }` —
 *     bypass auto-detection.
 *
 *  Each `path` is "A -> B -> C" (space-arrow-space). We split on `->`, trim,
 *  dedupe, map to vertex indices, and expand to all faces up to `maxDim+1`.
 *
 *  Vertex order in the resulting complex matches the input node list
 *  (firstOrderStates / states / nodes), so the simplex tuples are
 *  interpretable per-input. */
declare function buildSimplicialPathway(input: PathwayLikeInput | {
    edges?: {
        path: string;
        fromOrder?: number;
        count?: number;
    }[];
    scores?: {
        path: string;
        anomaly?: 'over' | 'under' | 'normal';
        ratio?: number;
    }[];
    transitions?: {
        path: string;
    }[];
    firstOrderStates?: string[];
    states?: string[];
    nodes?: string[];
}, options?: SimplicialOptions): SimplicialComplex;
declare function bettiNumbers(sc: SimplicialComplex): number[];
declare function eulerCharacteristic(sc: SimplicialComplex): number;
interface SimplicialDegreeRow {
    /** 0-based vertex index. */
    index: number;
    /** Node label from sc.nodes. */
    node: string;
    /** Per-dimension counts: byDim[d] is the count of d-simplices containing this node. Length = sc.dimension + 1. */
    byDim: number[];
    /** Sum of byDim[1..]. The d0 self-count is excluded — matches R's `rowSums(mat[, -1L])`. */
    total: number;
}
interface SimplicialDegreeOptions {
    /** Divide each d-count by C(n-1, d). Default false. */
    normalized?: boolean;
}
declare function simplicialDegree(sc: SimplicialComplex, options?: SimplicialDegreeOptions): SimplicialDegreeRow[];
interface QAnalysis {
    /** Component count at each q-level, indexed 0..maxQ. */
    qVector: number[];
    /** Max simplex dimension among maximal simplices in the complex. */
    maxQ: number;
    /** Per-node: max dimension of any simplex containing v. Length = sc.nNodes. */
    structureVector: number[];
}
declare function qAnalysis(sc: SimplicialComplex): QAnalysis;
interface PersistencePair {
    /** Dimension of the topological feature that's born here. */
    dimension: number;
    /** User-facing birth threshold. */
    birth: number;
    /** User-facing death threshold. `Infinity` for essential features in VR mode; 0 in clique mode. */
    death: number;
    /** birth - death (clique, descending) or death - birth (VR, ascending). `Infinity` for VR-mode essential features. */
    persistence: number;
}
interface BettiCurveRow {
    threshold: number;
    dimension: number;
    betti: number;
}
interface PersistentHomologyResult {
    bettiCurve: BettiCurveRow[];
    persistence: PersistencePair[];
    thresholds: number[];
    mode: 'clique' | 'vr';
}
interface PersistentHomologyOptions {
    /** Number of threshold grid points for the Betti curve. Default 20. */
    nSteps?: number;
    /** Max simplex dimension to track. Default 3. */
    maxDim?: number;
    /** 'clique' (default) treats x as similarity matrix. 'vr' treats x as distance matrix. */
    type?: 'clique' | 'vr';
    /** VR-only: maximum distance to include. Default = max finite entry. */
    maxScale?: number;
    /** Optional node labels for raw-matrix inputs. */
    labels?: string[];
}
declare function persistentHomology(x: SimplicialInput, options?: PersistentHomologyOptions): PersistentHomologyResult;
type BottleneckInput = PersistentHomologyResult | PersistencePair[];
interface BottleneckOptions {
    /** Dimensions to compare. Default: union of dimensions in either diagram. */
    dimension?: number[];
    /** Binary-search tolerance. Default sqrt(Number.EPSILON). */
    tol?: number;
}
declare function bottleneckDistance(d1: BottleneckInput, d2: BottleneckInput, options?: BottleneckOptions): Record<string, number>;
interface PersistenceLandscapeOptions {
    /** Highest landscape index to compute. Default 5. */
    kMax?: number;
    /** Dimension to compute the landscape for. Default 1. */
    dimension?: number;
    /** Evaluation grid. Default: 200 evenly-spaced points covering the pair span. */
    tGrid?: number[];
}
interface LandscapeRow {
    k: number;
    t: number;
    value: number;
}
interface PersistenceLandscape {
    landscape: LandscapeRow[];
    dimension: number;
    kMax: number;
    tGrid: number[];
}
declare function persistenceLandscape(ph: PersistentHomologyResult | PersistencePair[], options?: PersistenceLandscapeOptions): PersistenceLandscape;

/**
 * pathways — port of Nestimate::pathways generic dispatcher (R/pathways.R, 0.5.1).
 *
 * Extracts higher-order pathway strings in `"A B -> C"` format from
 * net_hon / net_hypa / net_mogen objects, suitable for downstream
 * simplicial-complex visualisation (cograph::plot_simplicial).
 */

interface PathwaysHonOptions {
    minCount?: number;
    minProb?: number;
    top?: number;
    order?: number;
}
interface PathwaysHypaOptions {
    type?: 'all' | 'over' | 'under';
}
interface PathwaysMogenOptions {
    order?: number;
    minCount?: number;
    minProb?: number;
    top?: number;
}
declare function pathwaysHon(hon: HonResult, options?: PathwaysHonOptions): string[];
declare function pathwaysHypa(hypa: HypaResult, options?: PathwaysHypaOptions): string[];
declare function pathwaysMogen(mogen: MogenResult, options?: PathwaysMogenOptions): string[];

export { cliques as $, AVAILABLE_MEASURES as A, type PathwaysMogenOptions as B, type PersistenceLandscape as C, type DFGEdge as D, type PersistentHomologyResult as E, type PruneOptions as F, type SimplicialDegreeRow as G, type HonEdgeRow as H, type SimplicialInput as I, type SimplicialOptions as J, type SimulateOptions as K, type StateFrequencyRow as L, type MogenCriterion as M, bettiNumbers as N, betweennessNetwork as O, type PathCountRow as P, type QAnalysis as Q, bottleneckDistance as R, type SimplicialComplex as S, buildDFG as T, buildDFGFromSequences as U, buildHon as V, buildHonem as W, buildHypa as X, buildMogen as Y, buildSimplicial as Z, centralities as _, AVAILABLE_METHODS as a, communities as a0, compareModels as a1, compareSequences as a2, eulerCharacteristic as a3, mogenTransitions as a4, pathCounts as a5, pathDependence as a6, pathwaysHon as a7, pathwaysHypa as a8, pathwaysMogen as a9, persistenceLandscape as aa, persistentHomology as ab, prune as ac, pruneDisparity as ad, qAnalysis as ae, simplicialDegree as af, simulate as ag, stateFrequencies as ah, stdResiduals as ai, type BettiCurveRow as aj, type BottleneckInput as ak, type BottleneckOptions as al, type LandscapeRow as am, type PathwayLikeInput as an, type PersistenceLandscapeOptions as ao, type PersistencePair as ap, type PersistentHomologyOptions as aq, type SimplicialDegreeOptions as ar, buildSimplicialPathway as as, type DFGMetric as b, type DFGNode as c, type DFGOptions as d, type DFGResult as e, type HonInput as f, type HonMethod as g, type HonOptions as h, type HonResult as i, type HonemInput as j, type HonemOptions as k, type HonemResult as l, type HypaInput as m, type HypaOptions as n, type HypaResult as o, type HypaScoreRow as p, type MogenInput as q, type MogenOptions as r, type MogenResult as s, type MogenTransitionRow as t, type PathDependenceContextRow as u, type PathDependenceInput as v, type PathDependenceOptions as w, type PathDependenceResult as x, type PathwaysHonOptions as y, type PathwaysHypaOptions as z };
