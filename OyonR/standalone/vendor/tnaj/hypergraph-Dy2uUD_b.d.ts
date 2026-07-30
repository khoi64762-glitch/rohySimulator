import { M as Matrix, T as TNA } from './types-C4ftN5gs.js';
import { I as SimplicialInput, S as SimplicialComplex } from './pathways-DmWrxueT.js';

/**
 * Markov-chain diagnostic suite — ports of Nestimate's transition_entropy
 * (R/transition_entropy.R) and chain_structure (R/chain_structure.R).
 *
 * - `transitionEntropy` returns the Shannon row entropies, the stationary
 *   distribution, the entropy rate h(P) = Σ πᵢ H(P_{i·}), the redundancy
 *   H(π) − h(P), and their normalised forms.
 * - `chainStructure` returns the qualitative shape of the chain: state
 *   classification (absorbing / recurrent / transient), communicating classes
 *   (SCCs of the support graph), per-recurrent-class period (gcd of return
 *   times), hitting-probability matrix, and absorption analysis (fundamental
 *   matrix N = (I − Q)⁻¹).
 *
 * Both expose a flexible input — Matrix, number[][], or TNA — and follow R's
 * default behaviour of renormalising rows that don't sum to 1 (with a
 * `normalize` toggle to match the R signature). Stationary distributions are
 * obtained via tnaj's existing `eigenDominantLeft` (matches R's
 * `.mpt_stationary`).
 *
 * Verified against Nestimate ≥ 0.5.7.
 */

type DiagnosticsInput = Matrix | number[][] | TNA;
interface TransitionEntropyOptions {
    /** Logarithm base. 2 = bits (default), Math.E = nats, 10 = hartleys. */
    base?: number;
    /** Renormalise rows that don't sum to 1. Default true. */
    normalize?: boolean;
}
interface TransitionEntropy {
    /** Per-state branching entropy H(P_{i·}) = −Σⱼ Pᵢⱼ log Pᵢⱼ. */
    rowEntropy: number[];
    /** rowEntropy[i] / log_b(n). In [0,1]; all zeros when n = 1. */
    rowEntropyNorm: number[];
    /** Stationary distribution π. */
    stationary: number[];
    /** H(π) treated as an i.i.d. distribution. */
    stationaryEntropy: number;
    /** stationaryEntropy / log_b(n). */
    stationaryEntropyNorm: number;
    /** Entropy rate h(P) = Σᵢ πᵢ H(P_{i·}) — the Shannon-McMillan-Breiman per-step uncertainty. */
    entropyRate: number;
    /** entropyRate / log_b(n). */
    entropyRateNorm: number;
    /** H(π) − h(P), the order-1 memory deficit. Zero for an i.i.d. chain. */
    redundancy: number;
    /** Relative redundancy (H(π) − h(P)) / H(π). 0 when H(π) = 0. */
    redundancyNorm: number;
    /** log_b(n). The normalisation ceiling. */
    maxEntropy: number;
    base: number;
    /** State labels aligned with rowEntropy / stationary. */
    states: string[];
}
declare function transitionEntropy(x: DiagnosticsInput, options?: TransitionEntropyOptions): TransitionEntropy;
type StateClassification = 'absorbing' | 'recurrent' | 'transient';
interface ChainStructureOptions {
    /** Renormalise rows that don't sum to 1. Default true. */
    normalize?: boolean;
    /** Tolerance for support-graph edges + reversibility check. Default 1e-10.
     *  Does NOT relax the absorbing test (always sqrt(eps)). */
    tol?: number;
}
interface ChainStructure {
    states: string[];
    /** Per-state classification, aligned with `states`. */
    classification: StateClassification[];
    /** Strongly connected components of the support graph (vertex-name vectors). */
    communicatingClasses: string[][];
    /** Subset of communicatingClasses that are closed (no outgoing edges). */
    recurrentClasses: string[][];
    /** Subset that are open. */
    transientClasses: string[][];
    /** States with P[i,i] = 1 (to sqrt(eps)). */
    absorbingStates: string[];
    /** Per-state period; null for transient states. */
    period: (number | null)[];
    isIrreducible: boolean;
    isAperiodic: boolean;
    isRegular: boolean;
    /** Detailed-balance check vs. stationary; null for non-irreducible chains. */
    isReversible: boolean | null;
    /** n×n matrix, [i,j] = P(ever reach j | start i). Diagonal = return probability. */
    hittingProbabilities: Matrix;
    /** Per-transient-state absorption probabilities (n_transient × n_absorbing), or null. */
    absorptionProbabilities: Matrix | null;
    /** Mean steps to absorption per transient state, or null. */
    meanAbsorptionTime: number[] | null;
    /** Possibly-renormalised transition matrix actually used. */
    P: Matrix;
}
declare function chainStructure(x: DiagnosticsInput, options?: ChainStructureOptions): ChainStructure;
declare function stateDistribution(x: DiagnosticsInput): {
    state: string;
    proportion: number;
}[];

/**
 * Hypergraph suite — ports of Nestimate hypergraph functions.
 *
 *   - buildHypergraph     ← Nestimate::build_hypergraph (R/hypergraph.R:89)
 *   - bipartiteGroups     ← Nestimate::bipartite_groups (R/bipartite_groups.R:75)
 *   - cliqueExpansion     ← Nestimate::clique_expansion (R/clique_expansion.R:63)
 *   - hypergraphMeasures  ← Nestimate::hypergraph_measures (R/hypergraph_measures.R:96)
 *   - hypergraphCentrality ← Nestimate::hypergraph_centrality (R/hypergraph_centrality.R:81)
 *
 * Verified against Nestimate ≥ 0.5.7.
 *
 * The hypergraph object is a binary incidence matrix `B` (n_nodes × n_hyperedges)
 * plus the hyperedge list for convenience. Most measures are direct BLAS ops
 * (BBᵀ for co-degree, BᵀB for pairwise overlap). Centralities reuse the same
 * matrix; the three variants (CEC, Z, H) are power-iteration on the
 * incidence-derived operator.
 */

interface Hypergraph {
    /** List of hyperedges; each hyperedge is the sorted 0-based vertex indices it spans. */
    hyperedges: number[][];
    /** n_nodes × n_hyperedges binary (or weighted, for bipartiteGroups with `weight`) incidence matrix. */
    incidence: Matrix;
    nodes: string[];
    nNodes: number;
    nHyperedges: number;
    /** Counts of hyperedges of each size, indexed by size (size_2, size_3, ...). */
    sizeDistribution: Record<string, number>;
    /** Recorded construction parameters (for traceability). */
    params: Record<string, unknown>;
}
interface BuildHypergraphOptions {
    /** Bernoulli probability that each k-clique with k ≥ 3 becomes a k-hyperedge. Default 1. */
    p?: number;
    /** Enumeration method. Only 'clique' is implemented (matches R 0.5.7). */
    method?: 'clique';
    /** Include the underlying 2-edges as 2-hyperedges. Default true. */
    includePairwise?: boolean;
    /** Maximum hyperedge size. Default 3. */
    maxSize?: number;
    /** Edge weight cutoff used to binarise the adjacency. Default 0. */
    threshold?: number;
    /** Seed for the Bernoulli sampling when 0 < p < 1. Default 42 (reproducible). */
    seed?: number;
    /** Optional node labels (used when input is a raw matrix). */
    labels?: string[];
}
declare function buildHypergraph(net: SimplicialInput | SimplicialComplex, options?: BuildHypergraphOptions): Hypergraph;
interface BipartiteGroupsOptions {
    /** Optional column index/name in `data` for per-(player, group) weights. */
    weight?: string;
}
/** Tiny long-format row shape — a record with `player` and `group` (and
 *  optional weight) field names matching the option-passed keys. */
type BipartiteRow = Record<string, string | number | null | undefined>;
declare function bipartiteGroups(data: BipartiteRow[], player: string, group: string, options?: BipartiteGroupsOptions): Hypergraph;
interface CliqueExpansionOptions {
    /** Use raw incidence values (default). When false, binarise first. */
    weighted?: boolean;
}
interface CliqueExpansionResult {
    /** n × n symmetric weight matrix W[i, j] = Σ_e B[i, e] · B[j, e] (with W[i, i] = 0). */
    weights: Matrix;
    nodes: string[];
    /** Construction trace. */
    params: Record<string, unknown>;
}
declare function cliqueExpansion(hg: Hypergraph, options?: CliqueExpansionOptions): CliqueExpansionResult;
interface HypergraphMeasures {
    hyperdegree: number[];
    nodeStrength: number[];
    maxEdgeSize: number[];
    coDegree: Matrix;
    edgeSizes: number[];
    edgePairwiseOverlap: Matrix;
    overlapCoefficient: Matrix;
    jaccard: Matrix;
    density: number;
    avgEdgeSize: number;
    sizeDistribution: Record<string, number>;
    intersectionProfile: Record<string, number>;
    pairwiseParticipation: number;
    nNodes: number;
    nHyperedges: number;
}
declare function hypergraphMeasures(hg: Hypergraph): HypergraphMeasures;
type HypergraphCentralityType = 'clique' | 'Z' | 'H';
interface HypergraphCentralityOptions {
    /** Which variants to compute. Default ['clique', 'Z', 'H']. */
    type?: HypergraphCentralityType[];
    /** Max iterations. Default 1000. */
    maxIter?: number;
    /** Convergence tolerance on L1 change. Default 1e-8. */
    tol?: number;
    /** L2-normalise each centrality vector. Default true. */
    normalize?: boolean;
}
type HypergraphCentralityResult = Partial<Record<HypergraphCentralityType, number[]>>;
declare function hypergraphCentrality(hg: Hypergraph, options?: HypergraphCentralityOptions): HypergraphCentralityResult;

export { type BipartiteGroupsOptions as B, type ChainStructure as C, type DiagnosticsInput as D, type Hypergraph as H, type StateClassification as S, type TransitionEntropy as T, type BipartiteRow as a, type BuildHypergraphOptions as b, type ChainStructureOptions as c, type HypergraphCentralityOptions as d, type HypergraphCentralityResult as e, type HypergraphCentralityType as f, type HypergraphMeasures as g, bipartiteGroups as h, buildHypergraph as i, chainStructure as j, cliqueExpansion as k, hypergraphCentrality as l, hypergraphMeasures as m, type CliqueExpansionOptions as n, type CliqueExpansionResult as o, type TransitionEntropyOptions as p, stateDistribution as s, transitionEntropy as t };
