import { T as TNA, h as SequenceData } from './types-C4ftN5gs.js';
export { B as BuildModelOptions, C as CentralityMeasure, a as CentralityResult, b as CliqueResult, c as ClusterResult, d as CommunityMethod, e as CommunityResult, f as CompareRow, G as GroupTNA, M as Matrix, g as ModelType, S as Sequence, i as TNAData, j as TransitionParams, k as applyScaling, l as arrayMean, m as arrayQuantile, n as arrayStd, o as maxScale, p as minmaxScale, q as pearsonCorr, r as rankScale, s as rowNormalize } from './types-C4ftN5gs.js';
export { A as ACCENT_PALETTE, D as DEFAULT_COLORS, O as OnehotSequenceData, S as SET3_PALETTE, a as atna, b as buildModel, c as colorPalette, d as computeTransitions, e as computeTransitions3D, f as computeWeightsFrom3D, g as computeWeightsFromMatrix, h as createColorMap, i as createGroupTNA, j as createSeqdata, k as createTNA, l as ctna, m as darkenColor, n as eigenDominantLeft, o as ftna, p as groupApply, q as groupAtna, r as groupCtna, s as groupEntries, t as groupFtna, u as groupNames, v as groupTna, w as hexToRgb, x as importOnehot, y as isGroupTNA, z as isHtna, B as lightenColor, C as prepareData, E as renameGroups, F as rgbToHex, G as solveLinear, H as summary, I as tna } from './colors-Bu7NjAVh.js';
export { S as SeededRNG } from './rng-CY-fA99P.js';
export { d as distanceCorr, k as kendallTau, r as rankArray, a as rvCoefficient, s as spearmanCorr, b as spearmanCorrArr } from './correlation-BoV6ZDBJ.js';
export { P as PAdjustMethod, p as pAdjust } from './pAdjust-DGekUM6t.js';
export { A as AVAILABLE_MEASURES, a as AVAILABLE_METHODS, D as DFGEdge, b as DFGMetric, c as DFGNode, d as DFGOptions, e as DFGResult, H as HonEdgeRow, f as HonInput, g as HonMethod, h as HonOptions, i as HonResult, j as HonemInput, k as HonemOptions, l as HonemResult, m as HypaInput, n as HypaOptions, o as HypaResult, p as HypaScoreRow, M as MogenCriterion, q as MogenInput, r as MogenOptions, s as MogenResult, t as MogenTransitionRow, P as PathCountRow, u as PathDependenceContextRow, v as PathDependenceInput, w as PathDependenceOptions, x as PathDependenceResult, y as PathwaysHonOptions, z as PathwaysHypaOptions, B as PathwaysMogenOptions, F as PruneOptions, S as SimplicialComplex, I as SimplicialInput, J as SimplicialOptions, K as SimulateOptions, L as StateFrequencyRow, N as bettiNumbers, O as betweennessNetwork, R as bottleneckDistance, T as buildDFG, U as buildDFGFromSequences, V as buildHon, W as buildHonem, X as buildHypa, Y as buildMogen, Z as buildSimplicial, $ as cliques, a0 as communities, a1 as compareModels, a2 as compareSequences, a3 as eulerCharacteristic, a4 as mogenTransitions, a5 as pathCounts, a6 as pathDependence, a7 as pathwaysHon, a8 as pathwaysHypa, a9 as pathwaysMogen, aa as persistenceLandscape, ab as persistentHomology, ac as prune, ad as pruneDisparity, ae as qAnalysis, af as simplicialDegree, ag as simulate, ah as stateFrequencies, ai as stdResiduals } from './pathways-DmWrxueT.js';
export { C as CasedropReliabilityMetricMatrix, a as CasedropReliabilityOptions, b as CasedropReliabilityResult, c as CasedropReliabilitySummaryRow, E as EdgeStabilityResult, d as EdgeStat, M as MMMResult, e as MarkovInput, f as MarkovOrderInput, g as MarkovOrderOptions, h as MarkovOrderReplay, i as MarkovOrderResult, j as MarkovOrderTestRow, k as MarkovStabilityResult, l as MarkovStabilityRow, m as MetricDef, p as MmmClustering, q as MmmGroupTNA, r as MmmInput, s as MmmOptions, t as MmmQuality, N as NetworkReliabilityIterations, u as NetworkReliabilityOptions, v as NetworkReliabilityResult, w as NetworkReliabilitySummaryRow, x as NetworkStabilityResult, P as PassageTimeOptions, y as PassageTimeResult, z as PermutationOptions, A as PermutationResult, B as PermutationWtnaInput, R as RELIABILITY_METRICS, D as ReliabilityMetricSummary, F as ReliabilityResult, G as ReliabilityScale, H as RepresentativeResult, S as StabilityOptions, I as StabilityResult, J as StabilitySummaryRow, K as StabilityWtnaInput, Q as clusterData, T as clusterMmm, U as clusterSequences, W as computeDendrogram, X as estimateCsWtna, Y as estimateEdgeStability, Z as estimateNetworkStability, a0 as findRepresentatives, a8 as mmm, ab as networkReliability, af as permutationTestWtna, ah as validateMmmOptions } from './mmm-Bh8r28dS.js';
export { B as BootstrapEdge, a as BootstrapOptions, b as BootstrapResult, c as BootstrapWtnaInput, W as WtnaOptions, d as WtnaResult, e as applyIntervalWindowing, f as applyWindowing, h as bootstrapWtna, i as buildWtnaMatrix, j as computeWithinWindow, k as computeWtnaTransitions, r as rowNormalizeWtna, t as toBinaryMatrix } from './bootstrap-DcP2CBLQ.js';
export { h as bipartiteGroups, i as buildHypergraph, j as chainStructure, k as cliqueExpansion, l as hypergraphCentrality, m as hypergraphMeasures, t as transitionEntropy } from './hypergraph-Dy2uUD_b.js';
export { ConvertResult, DiscoverOptions, EdgeListEntry, EdgeListResult, FrequencyResult, IndexResult, IndicesOptions, PatternEntry, PatternResult, PreparedSequenceData, RLEResult, RawPatterns, ReverseEdgeListEntry, ReverseEdgeListResult, chiSqUpperTail, convert, discoverPatterns, entropyProfile, extractLast, meanTimeInState, modalSequence, prepareSequenceData, rle, sequenceFrequencies, sequenceIndices, sequenceStateDistribution, sequenceStateFrequencies, sequenceTransitions } from './sequences/index.js';
export { ExtractMetaPathsOptions, FormatPathsOptions, HTNA_COLOR_PALETTE, HTNA_SHAPE_PALETTE, HtnaLayout, HtnaLongOptions, HtnaOptions, HtnaPlotData, HtnaPlotEdge, HtnaPlotLegendEntry, HtnaPlotNode, HtnaPlotOptions, HtnaShape, LongRow, MCML_COLOR_PALETTE, McmlAggregation, McmlClusters, McmlEdgeColorBy, McmlLayerLike, McmlLike, McmlMatrix, McmlNodeShape, McmlPlotData, McmlPlotEdge, McmlPlotEdgeKind, McmlPlotLegendEntry, McmlPlotNode, McmlPlotOptions, McmlPlotShell, McmlSummaryNode, McmlSummaryPie, McmlTheme, MetaPathRow, NetworkDiff, NetworkDiffEdge, SequencePlotHtnaData, SequencePlotHtnaOptions, bootstrapHtna, diffNetworks, extractMetaPaths, formatPaths, htna, htnaFromLong, htnaPlotData, mcmlPlotData, mcml_plot_data, plotMCML, plot_mcml, sequencePlotHtnaData } from './htna/index.js';

/**
 * Standalone reimplementations of small tnaj helpers that DO NOT import
 * from `tnaj` — keeps tnaj-light's bundle free of the markov.ts module
 * (and therefore free of the pure-TS markovOrderTest / passageTime /
 * markovStability that share that file).
 *
 * Why these specifically:
 *   - `kgramCounts` is used by the carm-tnaW2 notebook's simplicial-pathway
 *     viz cell.
 *   - `extractTrajectories` is the canonical SequenceData → trajectories
 *     converter; the notebook calls it to prepare data for kgramCounts.
 *
 * Both implementations are byte-equivalent to tnaj's. The `HON_SEP`
 * separator and the lex-sort node order match tnaj for downstream
 * compatibility.
 */

interface KgramCounts {
    nodes: string[];
    nodeCounts: Map<string, number>;
    edges: {
        from: string;
        to: string;
        weight: number;
    }[];
}
/**
 * Mirrors tnaj's `extractTrajectories`. Accepts either a TNA model (with
 * .data attached) or a raw SequenceData / string[][]. Strips trailing
 * nulls per row and drops rows shorter than 2.
 */
declare function extractTrajectories(data: TNA | SequenceData | string[][]): string[][];
/**
 * Mirrors tnaj's `kgramCounts`. Counts k-grams across all trajectories
 * and the edges between consecutive k-grams within each trajectory.
 * Nodes are returned lex-sorted, matching tnaj's R-parity contract.
 */
declare function kgramCounts(trajectories: string[][], k: number): KgramCounts;

export { type KgramCounts, SequenceData, TNA, extractTrajectories, kgramCounts };
