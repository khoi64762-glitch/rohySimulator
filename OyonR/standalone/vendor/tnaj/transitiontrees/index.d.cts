import { h as SequenceData, T as TNA, i as TNAData, S as Sequence } from '../types-C4ftN5gs.cjs';

type ContextTreeInput = SequenceData | TNA | TNAData;
type SmoothingMethod = 'floor' | 'laplace' | 'kneser_ney' | 'witten_bell' | 'jelinek_mercer';
type FloorRule = 'interpolate' | 'cap';
type SmoothingSpec = SmoothingMethod | {
    method: 'floor';
    ymin?: number;
    rule?: FloorRule;
} | {
    method: 'laplace';
    alpha?: number;
} | {
    method: 'kneser_ney';
    discount?: number;
} | {
    method: 'witten_bell';
} | {
    method: 'jelinek_mercer';
    lambda?: number;
};
type ResolvedSmoothing = {
    method: 'floor';
    ymin: number;
    rule: FloorRule;
} | {
    method: 'laplace';
    alpha: number;
} | {
    method: 'kneser_ney';
    discount: number;
} | {
    method: 'witten_bell';
} | {
    method: 'jelinek_mercer';
    lambda: number;
};
interface ContextTreeOptions {
    maxDepth?: number;
    minCount?: number;
    smoothing?: SmoothingSpec;
    alphabet?: string[];
    weights?: number[];
}
interface ContextTreeNode {
    depth: number;
    counts: Float64Array;
    probability: Float64Array;
    count: number;
}
interface ContextTreeEdge {
    parent: string;
    child: string;
    symbol: string;
}
type PruningCriterion = 'G2' | 'KL' | 'AIC' | 'BIC';
interface ContextTreePruning {
    criterion: PruningCriterion;
    alpha: number;
    threshold: number;
}
interface ContextTree {
    nodes: Record<string, ContextTreeNode>;
    edges: ContextTreeEdge[];
    alphabet: string[];
    maxDepth: number;
    minCount: number;
    nSequences: number;
    nObservations: number;
    smoothing: ResolvedSmoothing;
    pruned: boolean;
    pruning: ContextTreePruning | null;
    data: SequenceData;
    weights: number[] | null;
    localRoot?: string;
}
interface PathwayRow {
    pathway: string;
    depth: number;
    count: number;
    likelyNext: string;
    nextProbability: number;
    divergence: number;
    changesPrediction: boolean | null;
}
interface TreePathwaysOptions {
    minCount?: number;
    sortBy?: 'count' | 'divergence' | 'depth';
    decreasing?: boolean;
}
interface CommonPathwaysOptions {
    top?: number;
    depth?: number;
    minCount?: number;
}
interface DivergentPathwaysOptions {
    top?: number;
    minCount?: number;
    flipsOnly?: boolean;
}
interface TreeDependenceRow {
    pathway: string;
    depth: number;
    count: number;
    divergence: number;
    entropy: number;
    entropyBefore: number;
    entropyDrop: number;
    likelyNext: string;
    likelyBefore: string;
    changesPrediction: boolean;
}
interface ScorePositionRow {
    sequenceId: number;
    position: number;
    matchedContext: string;
    observed: string;
    predictedProbability: number;
    logLikelihood: number;
}
interface ScoreSequenceRow {
    sequenceId: number;
    nScored: number;
    logLikelihood: number;
    perplexity: number;
}
interface TreeLogLikelihood {
    value: number;
    nObservations: number;
    degreesOfFreedom: number;
}
interface TreeModelFit extends TreeLogLikelihood {
    aic: number;
    bic: number;
    perplexity: number;
}
interface PruneTreeOptions {
    criterion?: PruningCriterion;
    alpha?: number;
    threshold?: number;
}
interface QueryPathwayOptions {
    nextState?: string;
    exact?: boolean;
}
interface PredictTreeOptions {
    type?: 'probability' | 'class';
}
interface GenerateTreeOptions {
    n?: number;
    length?: number;
    start?: string[];
    seed?: number;
}
type Pathway = string | string[];
type History = Sequence;
interface MineContextRow {
    pathway: string;
    depth: number;
    count: number;
    state: string;
    probability: number;
    isModal: boolean;
}
interface MineContextsOptions {
    minProbability?: number;
    maxProbability?: number;
    minCount?: number;
}
interface MineSequencesOptions {
    n?: number;
    which?: 'surprising' | 'expected';
}
interface TuneTreeOptions {
    maxDepth?: number[];
    minCount?: number[];
    smoothing?: SmoothingSpec[];
    prune?: boolean[];
    alpha?: number;
    folds?: number;
    seed?: number;
    alphabet?: string[];
}
interface TuneTreeRow {
    maxDepth: number;
    minCount: number;
    smoothing: string;
    prune: boolean;
    logLikelihood: number;
    nScored: number;
    perplexity: number;
    nNodesAverage: number;
    foldsFailed: number;
}
interface TuneTreeResult {
    rows: TuneTreeRow[];
    best: TuneTreeRow | null;
}
interface TreeDistanceRow {
    pathway: string;
    countA: number;
    countB: number;
    divergenceAB: number;
    divergenceBA: number;
    divergenceSymmetric: number;
}
interface CompareTreesOptions {
    iterations?: number;
    seed?: number;
    symmetric?: boolean;
}
interface TreeComparison {
    distance: number;
    nullDistribution: number[];
    pValue: number;
    pathways: TreeDistanceRow[];
}
type BootstrapPathwayStatistic = 'count' | 'nextProbability' | 'divergence';
interface BootstrapPathwaysOptions {
    iterations?: number;
    statistic?: BootstrapPathwayStatistic;
    consistencyRange?: [number, number];
    stabilityThreshold?: number;
    informativeThreshold?: number;
    alpha?: number;
    ciLevel?: number;
    seed?: number;
    keepResamples?: boolean;
}
interface EmpiricalPathwayRow {
    pathway: string;
    depth: number;
    count: number;
    likelyNext: string | null;
    nextProbability: number;
    divergence: number;
    changesPrediction: boolean | null;
    g2: number;
}
interface BootstrapPathwayRow extends EmpiricalPathwayRow {
    pStability: number;
    stabilityRate: number;
    stable: boolean;
    informativeRate: number;
    informative: boolean;
    flipConsistency: number;
    meanCount: number;
    sdCount: number;
    countCI: [number, number];
    meanNextProbability: number;
    sdNextProbability: number;
    nextProbabilityCI: [number, number];
    meanDivergence: number;
    sdDivergence: number;
    divergenceCI: [number, number];
    meanG2: number;
    sdG2: number;
    g2CI: [number, number];
}
interface BootstrapResamples {
    count: number[][];
    nextProbability: number[][];
    divergence: number[][];
    g2: number[][];
    changesPrediction: Array<Array<boolean | null>>;
}
interface BootstrapPathwaysResult {
    pathways: EmpiricalPathwayRow[];
    summary: BootstrapPathwayRow[];
    resamples: BootstrapResamples | null;
    iterations: number;
    statistic: BootstrapPathwayStatistic;
    consistencyRange: [number, number];
    stabilityThreshold: number;
    informativeThreshold: number;
    alpha: number;
    ciLevel: number;
    g2CriticalValue: number;
    seed: number;
}
interface CompareSmoothingRow {
    smoothing: SmoothingMethod;
    nNodes: number;
    perplexity: number;
}
interface ComparePruningRow {
    criterion: PruningCriterion;
    nNodes: number;
    reductionPercent: number;
}
interface LongEventRow {
    [column: string]: unknown;
}
interface PrepareTreeInputOptions {
    action: string;
    actor?: string | string[];
    time?: string;
    order?: string;
    session?: string;
    timeThreshold?: number;
    unixTimeUnit?: 'seconds' | 'milliseconds' | 'microseconds';
    metadata?: string[];
}
interface PreparedTreeInput {
    sequences: Array<Array<string | null>>;
    sessionIds: string[];
    metadata: Array<Record<string, unknown>> | null;
}
interface ContextTreeGroup {
    trees: Record<string, ContextTree>;
    groupNames: string[];
    groupVariable?: string;
    block?: Array<string | number>;
}
interface CompareGroupsOptions {
    iterations?: number;
    minCount?: number;
    seed?: number;
    block?: Array<string | number>;
}
interface GroupPathwayRow {
    pathway: string;
    depth: number;
    countTotal: number;
    counts: Record<string, number>;
    modalNext: Record<string, string | null>;
    flips: boolean;
    jsdBits: number;
    jsdPValue: number;
    jsdAdjustedPValue: number;
    usageG2: number;
    usagePValue: number;
    usageAdjustedPValue: number;
}
interface GroupOmnibusRow {
    axis: 'behavioral' | 'usage';
    statistic: string;
    value: number;
    pValue: number;
}
interface GroupComparison {
    pathways: GroupPathwayRow[];
    omnibus: GroupOmnibusRow[];
    distanceMatrix: Record<string, Record<string, number>>;
    groups: string[];
    iterations: number;
    seed: number;
    nContexts: number;
    stratified: boolean;
}

declare const ROOT_CONTEXT = "<root>";
declare const ROOT_PATHWAY = "(start)";
declare const PATH_SEPARATOR = " -> ";
declare function resolveSmoothing(spec?: SmoothingSpec): ResolvedSmoothing;
declare function smoothCounts(counts: Float64Array, smoothing: ResolvedSmoothing, parentProbability: Float64Array | null): Float64Array;
declare function parentContext(context: string): string | null;
declare function contextTree(input: ContextTreeInput, options?: ContextTreeOptions): ContextTree;
declare function smoothTree(tree: ContextTree, smoothingSpec?: SmoothingSpec): ContextTree;
declare function matchContext(tree: ContextTree, history: readonly (string | null)[]): string;

declare function pathwayExists(tree: ContextTree, pathway: Pathway): boolean;
declare function queryPathway(tree: ContextTree, pathway: Pathway, options: QueryPathwayOptions & {
    nextState: string;
}): number;
declare function queryPathway(tree: ContextTree, pathway: Pathway, options?: QueryPathwayOptions): Float64Array;
declare function subtree(tree: ContextTree, pathway: Pathway): ContextTree;
declare function treePathways(tree: ContextTree, options?: TreePathwaysOptions): PathwayRow[];
declare function commonPathways(tree: ContextTree, options?: CommonPathwaysOptions): PathwayRow[];
declare function divergentPathways(tree: ContextTree, options?: DivergentPathwaysOptions): PathwayRow[];
declare function sharpPathways(tree: ContextTree, options?: {
    top?: number;
    minCount?: number;
}): PathwayRow[];
declare function treeDependence(tree: ContextTree, options?: {
    base?: number;
    sortBy?: 'divergence' | 'entropyDrop' | 'entropy' | 'count' | 'depth';
    top?: number;
}): TreeDependenceRow[];
declare function predictNext(tree: ContextTree, history: readonly (string | null)[]): Float64Array;
declare function predictTree(tree: ContextTree, histories: readonly (readonly (string | null)[])[], options: PredictTreeOptions & {
    type: 'class';
}): string[];
declare function predictTree(tree: ContextTree, histories: readonly (readonly (string | null)[])[], options?: PredictTreeOptions): Float64Array[];
declare function scorePositions(tree: ContextTree, newData: readonly (readonly (string | null)[])[], options?: {
    worst?: number;
}): ScorePositionRow[];
declare function scoreSequences(tree: ContextTree, newData: readonly (readonly (string | null)[])[]): ScoreSequenceRow[];
declare function treeLogLikelihood(tree: ContextTree, newData?: readonly (readonly (string | null)[])[]): TreeLogLikelihood;
declare function treePerplexity(tree: ContextTree, newData?: readonly (readonly (string | null)[])[]): number;
declare function treeModelFit(tree: ContextTree, newData?: readonly (readonly (string | null)[])[]): TreeModelFit;
declare function pruneTree(tree: ContextTree, options?: PruneTreeOptions): ContextTree;
declare function generateTreeSequences(tree: ContextTree, options?: GenerateTreeOptions): string[][];
declare function nTreeNodes(tree: ContextTree): number;

type NullableSequence = readonly (string | null)[];
type NullableSequenceData = readonly NullableSequence[];
/** Fill internal missing states from left to right, leaving trailing gaps unchanged. */
declare function imputeSequences(tree: ContextTree, newData: NullableSequenceData, options?: {
    method?: 'modal' | 'probability';
    seed?: number;
}): Array<Array<string | null>>;
declare function imputeSequences(tree: ContextTree, newData: NullableSequence, options?: {
    method?: 'modal' | 'probability';
    seed?: number;
}): Array<string | null>;
declare function mineContexts(tree: ContextTree, state: string, options?: MineContextsOptions): MineContextRow[];
declare function mineSequences(tree: ContextTree, newData: NullableSequenceData, options?: MineSequencesOptions): ScoreSequenceRow[];
declare function treeDistanceBreakdown(treeA: ContextTree, treeB: ContextTree): TreeDistanceRow[];
declare function treeDistance(treeA: ContextTree, treeB: ContextTree, options?: {
    symmetric?: boolean;
}): number;
declare function compareTrees(treeA: ContextTree, treeB: ContextTree, options?: CompareTreesOptions): TreeComparison;
declare function tuneTree(data: Array<Array<string | null>>, options?: TuneTreeOptions): TuneTreeResult;
declare function bootstrapPathways(tree: ContextTree, options?: BootstrapPathwaysOptions): BootstrapPathwaysResult;

/** Convert one-row-per-event records to sequence rows with optional session splitting. */
declare function prepareTreeInput(data: LongEventRow[], options: PrepareTreeInputOptions): PreparedTreeInput;
declare function compareSmoothing(input: ContextTree | Array<Array<string | null>>, options?: Omit<ContextTreeOptions, 'smoothing'> & {
    smoothing?: SmoothingMethod[];
}): CompareSmoothingRow[];
declare function comparePruning(tree: ContextTree, options?: {
    criteria?: PruningCriterion[];
    alpha?: number;
    threshold?: number;
}): ComparePruningRow[];
declare function contextTreeGroups(data: Array<Array<string | null>>, groups: readonly (string | number)[], options?: ContextTreeOptions & {
    block?: Array<string | number>;
    groupVariable?: string;
}): ContextTreeGroup;
declare function compareGroups(group: ContextTreeGroup, options?: CompareGroupsOptions): GroupComparison;

type TreePlotStyle = 'horizontal' | 'dendrogram' | 'icicle';
interface SVGPlotOptions {
    width?: number;
    height?: number;
    title?: string;
    theme?: 'dark' | 'light';
}
interface TreePlotOptions extends SVGPlotOptions {
    style?: TreePlotStyle;
    showLabels?: boolean;
    /** Draw at most this many contexts, the highest-count ones. A context tree has a longer
     *  history occurring no more often than its prefix, so the top-N by count is automatically
     *  ancestor-closed — a connected subtree, never floating branches. Omit to draw all. */
    maxNodes?: number;
}
interface PathwayPlotOptions extends SVGPlotOptions {
    top?: number;
    sortBy?: 'count' | 'divergence' | 'depth';
    minCount?: number;
}
declare function plotTree(tree: ContextTree, options?: TreePlotOptions): string;
declare function plotPathways(tree: ContextTree, options?: PathwayPlotOptions): string;
declare function plotDivergence(tree: ContextTree, options?: PathwayPlotOptions): string;
declare function plotDistributions(tree: ContextTree, options?: PathwayPlotOptions): string;
declare function plotPruning(tree: ContextTree, pathway: string, pruned: ContextTree, options?: SVGPlotOptions): string;
declare function plotPredictive(tree: ContextTree, data: readonly (readonly (string | null)[])[], options?: SVGPlotOptions & {
    type?: 'logloss' | 'ecdf' | 'position';
}): string;
declare function plotTrajectories(tree: ContextTree, options?: SVGPlotOptions & {
    measure?: 'frequency' | 'predictability';
    minCount?: number;
    maxDepth?: number;
}): string;
declare function plotBootstrap(result: BootstrapPathwaysResult, options?: SVGPlotOptions & {
    top?: number;
}): string;
declare function plotPathwayResamples(result: BootstrapPathwaysResult, options?: SVGPlotOptions & {
    statistic?: 'count' | 'nextProbability' | 'divergence' | 'g2';
    top?: number;
}): string;
declare function plotComparison(result: TreeComparison, options?: SVGPlotOptions): string;
declare function plotTuning(result: TuneTreeResult, options?: SVGPlotOptions): string;
declare function plotGroupDifference(trees: Record<string, ContextTree>, options?: SVGPlotOptions & {
    depth?: number;
    groups?: [string, string];
}): string;

export { type BootstrapPathwayRow, type BootstrapPathwayStatistic, type BootstrapPathwaysOptions, type BootstrapPathwaysResult, type BootstrapResamples, type CommonPathwaysOptions, type CompareGroupsOptions, type ComparePruningRow, type CompareSmoothingRow, type CompareTreesOptions, type ContextTree, type ContextTreeEdge, type ContextTreeGroup, type ContextTreeInput, type ContextTreeNode, type ContextTreeOptions, type ContextTreePruning, type DivergentPathwaysOptions, type EmpiricalPathwayRow, type FloorRule, type GenerateTreeOptions, type GroupComparison, type GroupOmnibusRow, type GroupPathwayRow, type History, type LongEventRow, type MineContextRow, type MineContextsOptions, type MineSequencesOptions, PATH_SEPARATOR, type Pathway, type PathwayPlotOptions, type PathwayRow, type PredictTreeOptions, type PrepareTreeInputOptions, type PreparedTreeInput, type PruneTreeOptions, type PruningCriterion, type QueryPathwayOptions, ROOT_CONTEXT, ROOT_PATHWAY, type ResolvedSmoothing, type SVGPlotOptions, type ScorePositionRow, type ScoreSequenceRow, type SmoothingMethod, type SmoothingSpec, type TreeComparison, type TreeDependenceRow, type TreeDistanceRow, type TreeLogLikelihood, type TreeModelFit, type TreePathwaysOptions, type TreePlotOptions, type TreePlotStyle, type TuneTreeOptions, type TuneTreeResult, type TuneTreeRow, bootstrapPathways, commonPathways, compareGroups, comparePruning, compareSmoothing, compareTrees, contextTree, contextTreeGroups, divergentPathways, generateTreeSequences, imputeSequences, matchContext, mineContexts, mineSequences, nTreeNodes, parentContext, pathwayExists, plotBootstrap, plotComparison, plotDistributions, plotDivergence, plotGroupDifference, plotPathwayResamples, plotPathways, plotPredictive, plotPruning, plotTrajectories, plotTree, plotTuning, predictNext, predictTree, prepareTreeInput, pruneTree, queryPathway, resolveSmoothing, scorePositions, scoreSequences, sharpPathways, smoothCounts, smoothTree, subtree, treeDependence, treeDistance, treeDistanceBreakdown, treeLogLikelihood, treeModelFit, treePathways, treePerplexity, tuneTree };
