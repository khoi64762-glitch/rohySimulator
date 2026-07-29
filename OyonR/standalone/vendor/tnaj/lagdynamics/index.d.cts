import { h as SequenceData } from '../types-C4ftN5gs.cjs';

type LSAInput = SequenceData | Array<string | number | null | undefined> | Array<Array<string | number | null | undefined>> | Array<Record<string, unknown>> | number[][] | LSAData;
type LSAEngineName = 'classical' | 'two_cell' | 'bidirectional' | 'parallel_dominance' | 'nonparallel_dominance' | string;
type LSAAlternative = 'two.sided' | 'greater' | 'less';
type Matrix = number[][];
interface LSAData {
    events: number[] | null;
    seqId: number[] | null;
    labels: string[];
    nStates: number;
    nSequences: number;
    nEvents: number;
    transitionsPerSequence: number[];
    source: 'events' | 'transitions';
    observedInput: Matrix | null;
    sequences: number[][] | null;
}
interface LSATransitionRow {
    from: string;
    to: string;
    lag: number;
    count: number;
    rowTotal: number;
    colTotal: number;
    nTransitions: number;
}
interface LSATransitions {
    observed: Matrix;
    rowTotals: number[];
    colTotals: number[];
    nTransitions: number;
    lag: number;
    labels: string[];
    edges: LSATransitionRow[];
}
interface LSATest {
    statistic: number;
    df: number;
    p: number;
}
interface LSAEngineResult {
    observed: Matrix;
    expected: Matrix;
    probability: Matrix;
    adjustedResiduals: Matrix;
    pValues: Matrix;
    yulesQ: Matrix;
    kappa: Matrix;
    kappaZ: Matrix;
    kappaP: Matrix;
    likelihoodRatio: LSATest | null;
    ipf: Omit<LSAIPFResult, 'fit'> | null;
    extra: Record<string, Matrix | number | number[]>;
}
interface LSAEngineContext {
    transitions: LSATransitions;
    structuralZeros: Matrix | null;
    alternative: LSAAlternative;
    nEvents: number | null;
    eventTotals: number[] | null;
    params: Record<string, unknown>;
}
type LSAEngine = (context: LSAEngineContext) => LSAEngineResult;
interface LSAEngineEntry {
    name: string;
    fn: LSAEngine;
    description: string;
    requires: string[];
}
interface LSAOptions {
    lag?: number;
    engine?: LSAEngineName;
    alternative?: LSAAlternative;
    alpha?: number;
    loops?: boolean;
    structuralZeros?: Matrix | null;
    labels?: string[];
    group?: Array<string | number> | string | null;
    actor?: string;
    action?: string;
    time?: string;
    order?: string;
    session?: string;
    timeThreshold?: number;
    unixTimeUnit?: 'seconds' | 'milliseconds' | 'microseconds';
    params?: Record<string, unknown>;
}
interface LSAEdge {
    from: string;
    to: string;
    fromId: number;
    toId: number;
    lag: number;
    count: number;
    expected: number;
    prob: number;
    probCol: number;
    adjRes: number;
    p: number;
    yulesQ: number;
    kappa: number;
    kappaZ: number;
    kappaP: number;
    lift: number;
    sign: 'over' | 'under' | 'expected';
    significant: boolean;
    weight: number;
    [key: string]: string | number | boolean;
}
interface LSANode {
    id: number;
    label: string;
    name: string;
    outgoing: number;
    incoming: number;
}
interface LSAFit {
    kind: 'lsa';
    observed: Matrix;
    expected: Matrix;
    probability: Matrix;
    probabilityColumn: Matrix;
    adjustedResiduals: Matrix;
    pValues: Matrix;
    yulesQ: Matrix;
    kappa: Matrix;
    kappaZ: Matrix;
    kappaP: Matrix;
    likelihoodRatio: LSATest | null;
    pearsonChiSquare: LSATest | null;
    weights: Matrix;
    nodes: LSANode[];
    edges: LSAEdge[];
    directed: boolean;
    method: string;
    initialProbabilities: number[] | null;
    data: LSAData;
    params: Required<Pick<LSAOptions, 'lag' | 'engine' | 'alternative' | 'alpha' | 'loops'>> & {
        structuralZeros: Matrix | null;
        params: Record<string, unknown>;
    };
    meta: {
        source: string;
        ipf: Omit<LSAIPFResult, 'fit'> | null;
        nEventsUsed: number | null;
        extra: Record<string, Matrix | number | number[]>;
    };
}
interface LSAGroup {
    kind: 'lsa_group';
    groups: Record<string, LSAFit>;
    levels: string[];
    groupSizes: number[];
    labels: string[];
    engine: string;
}
interface LSAIPFOptions {
    structure?: Matrix | null;
    tolerance?: number;
    maxIterations?: number;
}
interface LSAIPFResult {
    fit: Matrix;
    iterations: number;
    converged: boolean;
    maxMarginDifference: number;
}
interface TransitionFilterOptions {
    significant?: boolean;
    direction?: 'any' | 'over' | 'under';
    minCount?: number;
    alpha?: number;
    sort?: 'none' | 'strength' | 'count' | 'prob';
}
interface LSAProfileRow {
    lag: number;
    from: string;
    to: string;
    count: number;
    prob: number;
    adjRes: number;
    p: number;
    significant: boolean;
}
interface LSALags {
    kind: 'lsa_lags';
    lags: number[];
    fits: LSAFit[];
}
interface LSABootstrapOptions {
    iterations?: number;
    level?: 'auto' | 'sequence' | 'event';
    blockLength?: number;
    confidenceLevel?: number;
    indices?: number[][];
    seed?: number;
}
interface LSABootstrapEdge {
    from: string;
    to: string;
    observed: number;
    countMean: number;
    countSE: number;
    countCILow: number;
    countCIHigh: number;
    adjResObserved: number;
    adjResMean: number;
    adjResSE: number;
    adjResCILow: number;
    adjResCIHigh: number;
    adjResPBootstrap: number;
    adjResStable: boolean;
    probObserved: number;
    probMean: number;
    probCILow: number;
    probCIHigh: number;
    yulesQObserved: number;
    yulesQMean: number;
    yulesQCILow: number;
    yulesQCIHigh: number;
}
interface LSABootstrapResult {
    kind: 'lsa_bootstrap';
    edges: LSABootstrapEdge[];
    bootObserved: Matrix;
    bootAdjustedResiduals: Matrix;
    bootProbability: Matrix;
    bootYulesQ: Matrix;
    iterations: number;
    level: 'sequence' | 'event';
    confidenceLevel: number;
    indicesUsed: number[][];
    fit: LSAFit;
}
interface LSACertaintyOptions {
    prior?: number;
    confidenceLevel?: number;
    inference?: 'stability' | 'threshold';
    consistencyRange?: [number, number];
    edgeThreshold?: number;
}
interface LSACertaintyEdge {
    from: string;
    to: string;
    observed: number;
    probObserved: number;
    probMean: number;
    probSE: number;
    probCILow: number;
    probCIHigh: number;
    pValue: number;
    stable: boolean;
    adjResObserved: number;
    adjResStable: boolean;
}
interface LSACertaintyResult {
    kind: 'lsa_certainty';
    edges: LSACertaintyEdge[];
    prior: number;
    confidenceLevel: number;
    inference: string;
    fit: LSAFit;
}
interface LSAPermutationOptions {
    iterations?: number;
    withinSequence?: boolean;
    shuffles?: number[][];
    seed?: number;
}
interface LSAPermutationEdge {
    from: string;
    to: string;
    observedCount: number;
    observedAdjRes: number;
    pPermutation: number;
    significant: boolean;
}
interface LSAPermutationResult {
    kind: 'lsa_permutation';
    edges: LSAPermutationEdge[];
    permutationAdjustedResiduals: Matrix;
    iterations: number;
    withinSequence: boolean;
    fit: LSAFit;
}
interface LSAStabilityOptions {
    iterations?: number;
    proportion?: number;
    minStable?: number;
    seed?: number;
    subsamples?: number[][];
}
interface LSAStabilityEdge {
    from: string;
    to: string;
    observedSignificant: boolean;
    stability: number;
    stable: boolean;
}
interface LSAStabilityResult {
    kind: 'lsa_stability';
    edges: LSAStabilityEdge[];
    stabilityMatrix: boolean[][];
    iterations: number;
    proportion: number;
    minStable: number;
    fit: LSAFit;
}
interface LSAReliabilityOptions {
    iterations?: number;
    weights?: 'prob' | 'count' | 'adj_res';
    method?: 'pearson' | 'spearman';
    seed?: number;
    splits?: number[][];
}
interface LSAReliabilityResult {
    kind: 'lsa_reliability';
    correlations: number[];
    mean: number;
    sd: number;
    ciLow: number;
    ciHigh: number;
    iterations: number;
    weights: string;
    method: string;
    nSequences: number;
    fit: LSAFit;
}
type LSACompareMeasure = 'prob' | 'adj_res' | 'log_or' | 'yules_q' | 'count' | 'lift';
interface LSACompareOptions {
    iterations?: number;
    measure?: LSACompareMeasure;
    adjust?: 'none' | 'bonferroni' | 'holm' | 'BH' | 'BY';
    minCount?: number;
    seed?: number;
}
interface LSAComparisonEdge {
    from: string;
    to: string;
    valueA: number;
    valueB: number;
    diff: number;
    p: number;
    pAdjusted: number;
    significant: boolean;
    [key: string]: string | number | boolean;
}
interface LSAComparison {
    kind: 'lsa_comparison';
    edges: LSAComparisonEdge[];
    fits: [LSAFit, LSAFit];
    groups: [string, string];
    iterations: number;
    measure: string;
}
interface LSAPairwiseComparison {
    kind: 'lsa_comparison_pairwise';
    comparisons: Record<string, LSAComparison>;
    edges: Array<LSAComparisonEdge & {
        groupA: string;
        groupB: string;
    }>;
}
interface LSABayesCompareOptions {
    prior?: number;
    draws?: number;
    confidenceLevel?: number;
    meanThreshold?: number;
    boundThreshold?: number;
    adjust?: 'none' | 'bonferroni' | 'holm' | 'BH' | 'BY';
    seed?: number;
}
interface LSABayesComparison extends Omit<LSAComparison, 'kind' | 'iterations' | 'measure'> {
    kind: 'lsa_bayes';
    draws: number;
    prior: number;
}
interface LSABayesPairwiseComparison {
    kind: 'lsa_bayes_pairwise';
    comparisons: Record<string, LSABayesComparison>;
    edges: Array<LSAComparisonEdge & {
        groupA: string;
        groupB: string;
    }>;
    draws: number;
    prior: number;
}
interface TransferEntropyOptions {
    lag?: number;
    history?: number;
    test?: 'surrogate' | 'none';
    iterations?: number;
    normalize?: boolean;
    seed?: number;
    xLabel?: string;
    yLabel?: string;
}
interface TransferEntropyRow {
    from: string;
    to: string;
    te: number;
    teEffective?: number;
    teNormalized?: number;
    p?: number;
    n: number;
}
interface LSAPlotOptions {
    width?: number;
    height?: number;
    title?: string;
    subtitle?: string;
    colors?: string[];
    background?: string;
    significant?: boolean;
}
interface LSATNA {
    weights: Matrix;
    inits: number[];
    labels: string[];
    data: number[][];
    type: string;
}

declare function lsaData(input: LSAInput, labels?: string[] | null): LSAData;
declare function lsaDataFromMatrix(observed: Matrix, labels?: string[] | null): LSAData;
declare function lsaDataFromSequences(raw: unknown[][], labels?: string[] | null): LSAData;
declare function lsaTransitions(input: LSAInput | LSAData, lag?: number): LSATransitions;
interface LongEventRow {
    [key: string]: unknown;
}
interface PrepareLongOptions {
    actor?: string;
    action: string;
    time?: string;
    order?: string;
    session?: string;
    group?: string;
    timeThreshold?: number;
    unixTimeUnit?: 'seconds' | 'milliseconds' | 'microseconds';
}
declare function prepareLong(rows: LongEventRow[], options: PrepareLongOptions): {
    sequences: string[][];
    groups?: string[];
};

declare function lsaIPF(observed: Matrix, options?: LSAIPFOptions): LSAIPFResult;
declare function registerLSAEngine(name: string, fn: LSAEngine, description: string, requires?: string[]): string;
declare function getLSAEngine(name: string): LSAEngineEntry;
declare function listLSAEngines(): Array<Omit<LSAEngineEntry, 'fn'>>;
declare function unregisterLSAEngine(name: string): void;

declare function lsa(input: LSAInput, options?: LSAOptions): LSAFit | LSAGroup;
declare const lsaClassical: (data: LSAInput, options?: LSAOptions) => LSAFit | LSAGroup;
declare const lsaTwoCell: (data: LSAInput, options?: LSAOptions) => LSAFit | LSAGroup;
declare const lsaBidirectional: (data: LSAInput, options?: LSAOptions) => LSAFit | LSAGroup;
declare const lsaParallelDominance: (data: LSAInput, options?: LSAOptions) => LSAFit | LSAGroup;
declare const lsaNonparallelDominance: (data: LSAInput, options?: LSAOptions) => LSAFit | LSAGroup;
declare function transitions(x: LSAFit | LSAGroup | LSALags | {
    edges: Array<Record<string, unknown>>;
}, options?: TransitionFilterOptions): Array<Record<string, unknown>>;
declare function nodes(x: LSAFit | LSAGroup): Array<Record<string, unknown>>;
declare function tests(x: LSAFit | LSAGroup): Array<Record<string, unknown>>;
declare function transitionProbabilities(x: LSAFit | LSAGroup): Matrix | Record<string, Matrix>;
declare function initial(x: LSAFit | LSAGroup): Array<Record<string, unknown>>;
declare function lsaLags(data: LSAInput, lags?: number[], options?: LSAOptions): LSALags;
declare function lagProfile(input: LSAInput | LSALags, from: string, to: string, lags?: number[], options?: LSAOptions): LSAProfileRow[];
declare function lsaToTNA(x: LSAFit | LSAGroup, weights?: 'prob' | 'count' | 'adj_res' | 'lift'): LSATNA | Record<string, LSATNA>;

declare function bootstrapLSA(fit: LSAFit, options?: LSABootstrapOptions): LSABootstrapResult;
declare function certaintyLSA(fit: LSAFit | LSAGroup, options?: LSACertaintyOptions): LSACertaintyResult | Record<string, LSACertaintyResult>;
declare function permuteLSA(fit: LSAFit, options?: LSAPermutationOptions): LSAPermutationResult;
declare function stabilityLSA(fit: LSAFit, options?: LSAStabilityOptions): LSAStabilityResult;
declare function reliabilityLSA(fit: LSAFit | LSAGroup, options?: LSAReliabilityOptions): LSAReliabilityResult | Record<string, LSAReliabilityResult>;

declare function compareLSA(x: LSAFit | LSAGroup, y?: LSAFit, options?: LSACompareOptions): LSAComparison | LSAPairwiseComparison;
declare function bayesCompareLSA(x: LSAFit | LSAGroup, y?: LSAFit, options?: LSABayesCompareOptions): LSABayesComparison | LSABayesPairwiseComparison;

type Value = string | number | null | undefined;
type SequenceInput = Value[] | Value[][];
declare function transferEntropy(x: SequenceInput, y?: SequenceInput | null, options?: TransferEntropyOptions): TransferEntropyRow[];

interface HeatmapOptions extends LSAPlotOptions {
    which?: 'residuals' | 'prob' | 'count' | 'expected';
}
/** Exact browser counterpart of lagdynamics' ggplot heatmap contract. */
declare function plotLSAHeatmap(fit: LSAFit, options?: HeatmapOptions): string;
interface TransitionPlotOptions extends LSAPlotOptions {
    weights?: 'residuals' | 'tna' | 'relative' | 'count' | 'prob' | 'lift' | 'yules_q';
    top?: number;
    decimals?: number;
    edgeLabels?: boolean;
    edgeCutoff?: number;
    nodeFill?: string;
    /** Minimum rendered edge width in SVG units. Default 0.55. */
    edgeWidthMin?: number;
    /** Maximum rendered edge width in SVG units. Default 2.8. */
    edgeWidthMax?: number;
    /** Arrowhead scale relative to the edge width. Default 1. */
    arrowScale?: number;
}
/** TNA/cograph-style transition network, adapted to a self-contained SVG. */
declare function plotTransitions(fit: LSAFit, options?: TransitionPlotOptions): string;
interface ChordOptions extends LSAPlotOptions {
    compare?: LSAFit;
    widthMetric?: 'count' | 'prob';
    colorMetric?: 'residuals' | 'lift' | 'prob' | 'count';
    selfLoops?: boolean;
    alpha?: number;
}
/** cograph plot_chord geometry: flow-sized ring segments and weighted ribbons. */
declare function plotChords(fit: LSAFit, options?: ChordOptions): string;
interface PolarOptions extends LSAPlotOptions {
    style?: 'rose' | 'wedge';
    fill?: 'residuals' | 'prob' | 'lift';
    size?: 'count' | 'prob';
    labels?: 'all' | 'auto' | 'none';
    minShow?: number;
    labelSize?: number;
}
/** Direct SVG port of lagdynamics' rose/wedge polar sunburst. */
declare function plotPolar(fit: LSAFit, options?: PolarOptions): string;
interface ForestOptions extends LSAPlotOptions {
    metric?: 'residuals' | 'count' | 'prob' | 'yules_q';
    top?: number;
    showNonsignificant?: boolean;
    labelSize?: number;
}
/** Radial bootstrap/certainty forest, matching lagdynamics' bootstrap circles. */
declare function plotForest(result: LSABootstrapResult | LSACertaintyResult, options?: ForestOptions): string;
interface ComparisonPlotOptions extends LSAPlotOptions {
    style?: 'barrel' | 'heatmap';
    top?: number;
    value?: 'prob' | 'count';
    rank?: 'frequency' | 'effect';
}
/** Canonical lagdynamics back-to-back comparison barrel. */
declare function plotComparison(result: LSAComparison | LSAPairwiseComparison | LSABayesComparison | LSABayesPairwiseComparison, options?: ComparisonPlotOptions): string | Record<string, string>;
declare function plotLSA(input: LSAFit | LSAGroup, type?: 'heatmap' | 'network' | 'chord' | 'sunburst', options?: LSAPlotOptions): string | Record<string, string>;

export { type ChordOptions, type ComparisonPlotOptions, type ForestOptions, type HeatmapOptions, type LSAAlternative, type LSABayesCompareOptions, type LSABayesComparison, type LSABayesPairwiseComparison, type LSABootstrapEdge, type LSABootstrapOptions, type LSABootstrapResult, type LSACertaintyEdge, type LSACertaintyOptions, type LSACertaintyResult, type LSACompareMeasure, type LSACompareOptions, type LSAComparison, type LSAComparisonEdge, type LSAData, type LSAEdge, type LSAEngine, type LSAEngineContext, type LSAEngineEntry, type LSAEngineName, type LSAEngineResult, type LSAFit, type LSAGroup, type LSAIPFOptions, type LSAIPFResult, type LSAInput, type LSALags, type LSANode, type LSAOptions, type LSAPairwiseComparison, type LSAPermutationEdge, type LSAPermutationOptions, type LSAPermutationResult, type LSAPlotOptions, type LSAProfileRow, type LSAReliabilityOptions, type LSAReliabilityResult, type LSAStabilityEdge, type LSAStabilityOptions, type LSAStabilityResult, type LSATNA, type LSATest, type LSATransitionRow, type LSATransitions, type LongEventRow, type Matrix, type PolarOptions, type PrepareLongOptions, type TransferEntropyOptions, type TransferEntropyRow, type TransitionFilterOptions, type TransitionPlotOptions, bayesCompareLSA, bayesCompareLSA as bayes_compare_lsa, bootstrapLSA, bootstrapLSA as bootstrap_lsa, certaintyLSA, certaintyLSA as certainty_lsa, compareLSA, compareLSA as compare_lsa, getLSAEngine, getLSAEngine as get_lsa_engine, initial, lagProfile, lagProfile as lag_profile, listLSAEngines, listLSAEngines as list_lsa_engines, lsa, lsaBidirectional, lsaClassical, lsaData, lsaDataFromMatrix, lsaDataFromSequences, lsaIPF, lsaLags, lsaNonparallelDominance, lsaParallelDominance, lsaToTNA, lsaTransitions, lsaTwoCell, lsaBidirectional as lsa_bidirectional, lsaClassical as lsa_classical, lsaData as lsa_data, lsaIPF as lsa_ipf, lsaLags as lsa_lags, lsaNonparallelDominance as lsa_nonparallel_dominance, lsaParallelDominance as lsa_parallel_dominance, lsaToTNA as lsa_to_tna, lsaTransitions as lsa_transitions, lsaTwoCell as lsa_two_cell, nodes, permuteLSA, permuteLSA as permute_lsa, plotChords, plotComparison, plotForest, plotLSA, plotLSAHeatmap, plotPolar, plotTransitions, plotChords as plot_chords, plotForest as plot_forest, plotPolar as plot_polar, plotTransitions as plot_transitions, prepareLong, registerLSAEngine, registerLSAEngine as register_lsa_engine, reliabilityLSA, reliabilityLSA as reliability_lsa, stabilityLSA, stabilityLSA as stability_lsa, tests, transferEntropy, transferEntropy as transfer_entropy, transitionProbabilities, transitionProbabilities as transition_probabilities, transitions, unregisterLSAEngine, unregisterLSAEngine as unregister_lsa_engine };
