import { B as BuildModelOptions, h as SequenceData, T as TNA, M as Matrix } from '../types-C4ftN5gs.cjs';
import { a as BootstrapOptions, b as BootstrapResult } from '../bootstrap-FLE9gIyi.cjs';

interface HtnaOptions extends BuildModelOptions {
    /**
     * Node-to-actor lookup: actor name → array of codes belonging to that actor.
     * Each code must appear in exactly one entry (no cross-actor collisions).
     * Intra-actor duplicates are silently de-duplicated.
     */
    nodeGroups: Record<string, string[]>;
    /**
     * Canonical actor ordering, defaults to `Object.keys(nodeGroups)`.
     * Stored on the TNA as `actorLevels` for consistent renderer behavior
     * (color/shape/layout assignment across the partition).
     */
    actorLevels?: string[];
}
/**
 * Build a Heterogeneous TNA from a single combined SequenceData and a
 * node-to-actor lookup. The lookup determines each node's partition tag.
 * Returns a TNA with `partition` and `actorLevels` populated.
 *
 * @throws if any code in `data` is not assigned to any actor in `nodeGroups`,
 *         or if a code appears in more than one actor's entry.
 *
 * @example
 * htna(sessions, {
 *   nodeGroups: {
 *     Human: ['Specify', 'Request', 'Refine'],
 *     AI:    ['Plan', 'Execute', 'Report'],
 *   },
 * });
 */
declare function htna(data: SequenceData | number[][], options: HtnaOptions): TNA;
/** One long-format event row. */
interface LongRow {
    /** Session identifier (events with the same session form one sequence). */
    session: string | number;
    /** Within-session ordering key (events sort ascending by this). */
    order: number;
    /** The code / action that occurred. */
    code: string;
    /** Optional actor-type tag for this event (overrides nodeGroups lookup). */
    actor?: string;
}
interface HtnaLongOptions extends BuildModelOptions {
    /**
     * Either supply `actorPerRow` semantics (the `actor` field on each row),
     * OR supply a node-level `nodeGroups` lookup. Mutually exclusive.
     */
    nodeGroups?: Record<string, string[]>;
    actorLevels?: string[];
    /**
     * When true, codes appearing under multiple actor labels are renamed
     * to `"<actor>:<code>"` before the model is built, so they become
     * distinct nodes. Default false (collisions throw).
     *
     * Only applicable when actor tags are per-event (`rows[i].actor` set)
     * — without per-event tags, collisions cannot be safely disambiguated.
     */
    disambiguate?: boolean;
}
/**
 * Build a Heterogeneous TNA from long-format event rows. Mirrors the R
 * `build_htna()` semantics: events are sorted by (session, order), then
 * grouped per session, then handed to `buildModel`.
 *
 * Per-event actor tags (`row.actor`) take precedence over `nodeGroups`.
 */
declare function htnaFromLong(rows: LongRow[], options: HtnaLongOptions): TNA;

/**
 * bootstrapHtna — Bootstrap an HTNA model to assess edge stability,
 * preserving the actor partition on the result.
 *
 * Port of R `bootstrap_htna()` from htna 0.1.0. The R version delegates
 * to `Nestimate::bootstrap_network()` and re-injects the partition onto
 * `boot$model` (which Nestimate strips). We do the analogous thing here:
 * call tnaj's existing `bootstrapTna()` and tag the result's model with
 * `partition` + `actorLevels` from the input HTNA.
 *
 * Cross-language numerical note: R and tnaj use different RNG streams
 * (R's Mersenne Twister vs tnaj's xoshiro128**), so the per-iteration
 * sampled sessions differ even with matching seeds. As a result, mean
 * weights / SDs / CI bounds cannot be byte-equal across languages. What
 * IS guaranteed (and tested):
 *   - `result.model` carries the same partition + actorLevels as input.
 *   - `result.model.weights` equals the input model's weights (the
 *     bootstrap does not mutate the source network).
 *   - For large enough `iter`, bootstrap means converge to the original
 *     weights — checked at a loose tolerance as a sanity bound.
 */

declare function bootstrapHtna(model: TNA, options?: BootstrapOptions): BootstrapResult;

/**
 * extractMetaPaths — Type-level meta-path enumeration over an HTNA.
 *
 * Port of R `extract_meta_paths()` from htna 0.1.0 (installed binary,
 * NOT the GitHub source — see memory `htna-binary-vs-source-divergence`).
 *
 * Concept: given a TNA whose nodes are partitioned by actor type
 * (e.g. Human / AI), each session is re-encoded as a sequence of actor
 * types. The function enumerates k-length patterns of actor types
 * (length 2..4 by default) that occur in the sessions, returning
 * count / support / frequency / lift per pattern.
 *
 * Lift is computed against the marginal-independence null:
 *     expected_count = prod(marg_p[type_j]) * total_windows
 *     lift           = count / expected_count
 * where marg_p is the per-type marginal frequency across all events.
 *
 * Schema filtering: `schema = "Human->AI->Human"` keeps only that one
 * pattern. `schema = "Human->*->Human"` keeps every k=3 pattern whose
 * first and last elements are Human. Schema parts may be type names
 * or `"*"` (wildcard) — concrete state names are NOT supported in the
 * installed v0.1.0 binary (they'd require state-level enumeration,
 * which the binary doesn't expose).
 *
 * Output rows are sorted by (length asc, gap asc, count desc) to match R.
 */

interface MetaPathRow {
    /** Pattern, e.g. "Human->AI->Human". */
    schema: string;
    /** Number of elements in the pattern (k). */
    length: number;
    /** Gap between consecutive positions; 0 for contiguous patterns. */
    gap: number;
    /** Total occurrences across all sessions. */
    count: number;
    /** Number of distinct sessions containing the pattern at least once. */
    nSequences: number;
    /** Proportion of sessions containing the pattern (`nSequences / total_n_sessions`). */
    support: number;
    /** Relative frequency within (length, gap) group (`count / sum(count_at_same_length_gap)`). */
    frequency: number;
    /** Observed-over-expected ratio under marginal independence. NaN if expected is 0. */
    lift: number;
}
interface ExtractMetaPathsOptions {
    /** Pattern lengths to enumerate. Default [2, 3, 4]. Ignored when `schema` is set. */
    length?: number[];
    /** Schema DSL: e.g. "Human->AI->Human", "Human->*->Human". Concrete states NOT supported. */
    schema?: string;
    /** "contiguous" (default): consecutive positions. "gapped": positions spaced by `gap + 1`. */
    type?: 'contiguous' | 'gapped';
    /** Gap size(s) for `type='gapped'`. Default [1]. Multiple values yield one row per (length, gap). */
    gap?: number | number[];
    /** Minimum count to retain a row. Default 1. */
    minCount?: number;
    /** Minimum support (proportion of sessions). Default 0. */
    minSupport?: number;
    /** Minimum lift; 0 disables the filter. Default 0. */
    minLift?: number;
    /** Keep only patterns whose first element is in this set. */
    start?: string[];
    /** Keep only patterns whose last element is in this set. */
    end?: string[];
    /** Keep only patterns containing every element in this set. */
    contain?: string[];
}
/**
 * Enumerate type-level meta-paths in an HTNA. See file docstring for details.
 */
declare function extractMetaPaths(model: TNA, options?: ExtractMetaPathsOptions): MetaPathRow[];

/**
 * formatPaths — TS equivalent of R `print.htna_paths` from htna 0.1.0.
 *
 * Renders MetaPathRow[] (from extractMetaPaths) as a fixed-width text
 * table whose byte layout matches R's `print(mp, n = 10)` exactly so
 * downstream tooling (CarmNote cells, Dynalytics notebook output, CI
 * log diffs) can compare TS and R sessions line-by-line.
 *
 * Output shape:
 *   <header line>: "Meta-paths (type-level) over N sequences"
 *   <summary>:     "Rows: M | Lengths: 2, 3, 4 | Gaps: 0"
 *   <columns>:     right-aligned, single-space-separated, format-matched
 *   <truncation>:  "... (X more)" if row count > n
 *
 * Column widths follow R's data.frame print: each column width =
 *   max(header_width, max_data_width) + 1
 * with all cells right-aligned. Numeric columns are pre-formatted:
 *   support / frequency → "%.3f"     lift → "%.2f"
 */

interface FormatPathsOptions {
    /** Max rows to render. Default 10. */
    n?: number;
    /** Total number of sessions the rows came from (for the header line). */
    nSequences?: number;
    /** Level label for the header. Default 'meta' → "Meta-paths (type-level)". */
    level?: 'meta' | 'state' | 'paths';
}
declare function formatPaths(rows: MetaPathRow[], options?: FormatPathsOptions): string;

/**
 * diffNetworks — element-wise diff of two TNA weight matrices.
 *
 * Pure data shaper for "plot the difference between two networks"
 * consumers (Dynalytics, CarmNote, demo). NOT an htna 0.1.0 export —
 * this is a helper we provide because every consumer that does diff
 * rendering needs the same structured input.
 *
 * Contract:
 *   - Both inputs must share the same set of labels (any order).
 *   - Output rows enumerate every (from, to) pair where either A or B
 *     has a non-zero weight (zero-weight cells on both sides are skipped).
 *   - `magnitude` is the signed change `b - a`.
 *   - `kind` classifies each edge: 'added' (only in b), 'removed' (only
 *     in a), 'increased' / 'decreased' (in both, magnitude !=0),
 *     'unchanged' (in both, magnitude == 0).
 *
 * For HTNA inputs both partitions must agree; the result carries the
 * shared partition + actorLevels so renderers can color by actor.
 */

interface NetworkDiffEdge {
    from: string;
    to: string;
    weightA: number;
    weightB: number;
    magnitude: number;
    kind: 'added' | 'removed' | 'increased' | 'decreased' | 'unchanged';
}
interface NetworkDiff {
    labels: string[];
    partition?: string[];
    actorLevels?: string[];
    edges: NetworkDiffEdge[];
    /** Counts by kind for quick summary stats. */
    counts: Record<NetworkDiffEdge['kind'], number>;
}
declare function diffNetworks(a: TNA, b: TNA): NetworkDiff;

/**
 * sequencePlotHtnaData — Data layer for `sequence_plot_htna()` from htna 0.1.0.
 *
 * R `sequence_plot_htna()` is two thin layers stacked:
 *   1. A pure data transform over the HTNA model's session data.
 *   2. A delegation to `Nestimate::sequence_plot()` for rendering.
 *
 * tnaj owns (1) here; (2) lives in whichever consumer renders the
 * matrix (Dynalytics' sequence ribbons, CarmNote cells, demo, etc.).
 *
 * Two modes:
 *
 *   by = 'group' (re-encode by actor type)
 *     Every cell of the session matrix is replaced by its actor-type
 *     label. Result is one matrix [sessions × maxLen] of actor strings
 *     (e.g. "Human" / "AI") with `null` for missing cells.
 *
 *   by = 'state' (default — split per actor, then stack)
 *     For each actor, filter each session to only that actor's events
 *     and pack into a per-actor matrix (right-padded with null).
 *     Then stack all per-actor matrices into one wide matrix; the
 *     parallel `group: string[]` tags each row with its source actor.
 */

interface SequencePlotHtnaOptions {
    /**
     * 'state' (default): split sessions per actor, stack → renderer plots
     *                    one sequence-per-actor-per-session row.
     * 'group':           re-encode each event as its actor type, producing
     *                    one row per original session with actor-type cells.
     */
    by?: 'state' | 'group';
    /**
     * Canonical actor ordering (overrides `model.actorLevels`). Determines
     * the per-actor split order in 'state' mode.
     */
    actorLevels?: string[];
}
interface SequencePlotHtnaData {
    by: 'state' | 'group';
    /** Actor labels in canonical order. */
    actors: string[];
    /** Wide-format session matrix (rows = sessions, cols = positions). */
    data: (string | null)[][];
    /** Per-row actor tag (length = data.length). Same value repeated for 'group' mode. */
    group: string[];
    /**
     * Per-actor session-matrix pieces (only populated for `by = 'state'`).
     * Keyed by actor name; same row-count semantics as `data` but split
     * apart so consumers can render per-actor heatmaps/indices side by side.
     */
    pieces?: Record<string, (string | null)[][]>;
}
declare function sequencePlotHtnaData(model: TNA, options?: SequencePlotHtnaOptions): SequencePlotHtnaData;

/**
 * htnaPlotData — layout + render data for `plot_htna()` from htna 0.1.0.
 *
 * R `plot_htna()` is a 30+ option renderer that delegates layout + styling
 * to internal helpers and finally paints via cograph/igraph. tnaj owns
 * the *structural* layer here: given a TNA + a minimal set of options,
 * return a fully-typed render package that any consumer (demo, CarmNote,
 * Dynalytics, future svelte/react cells) can paint without recomputing
 * geometry.
 *
 * What's covered (matching plot_htna defaults):
 *   - Color palette: plot_htna's exact 12-color sequence
 *   - Shape palette: plot_htna's 8-shape sequence
 *   - Default per-actor color/shape: actorLevels[0] → palette[0], etc.
 *   - Layouts:
 *       'bipartite-arcs' (default, matches Dynalytics + tnaj demo norm)
 *       'circular'       (all nodes on one ring, R plot_htna fallback)
 *       'vertical'       (two columns, group1 left / group2 right)
 *       'horizontal'     (two rows)
 *   - Per-edge classification: 'within' / 'between' / 'self'
 *   - Edge color = source actor's color
 *
 * What's NOT covered (renderer responsibility):
 *   - Painting (SVG/canvas/base R graphics)
 *   - Self-loop control points, exact curvature shapes, arrowheads,
 *     label positioning, donut rings, legend boxes — those are visual
 *     decisions that each consumer makes consistently with its other
 *     plots. The structural data here is enough to drive any of them.
 */

/** plot_htna's default 12-color palette (exact hex codes). */
declare const HTNA_COLOR_PALETTE: readonly ["#4FC3F7", "#fbb550", "#7eb5d6", "#98d4a2", "#f4a582", "#92c5de", "#d6c1de", "#b8e186", "#fdcdac", "#cbd5e8", "#f4cae4", "#e6f5c9"];
/** plot_htna's default 8-shape palette. */
declare const HTNA_SHAPE_PALETTE: readonly ["circle", "square", "diamond", "triangle", "pentagon", "hexagon", "star", "cross"];
type HtnaShape = (typeof HTNA_SHAPE_PALETTE)[number];
type HtnaLayout = 'bipartite-arcs' | 'circular' | 'vertical' | 'horizontal';
interface HtnaPlotOptions {
    layout?: HtnaLayout;
    width?: number;
    height?: number;
    /** Override per-actor color: actor name → hex. Default: HTNA_COLOR_PALETTE in actorLevels order. */
    groupColors?: Record<string, string>;
    /** Override per-actor shape: actor name → shape. Default: HTNA_SHAPE_PALETTE in actorLevels order. */
    groupShapes?: Record<string, HtnaShape>;
    /** Hide edges with weight strictly below this threshold. Default: 0 (show all non-zero). */
    edgeThreshold?: number;
    /** Curvature magnitude for within-group edges (0..1). Default 0.4 (matches R plot_htna). */
    curvature?: number;
    /** Bipartite-arcs only: half the horizontal distance between the two arc centers. Default 40. */
    bipartiteGapHalf?: number;
    /** Bipartite-arcs only: arc radius. Defaults to keep nodes inside the canvas. */
    bipartiteRadius?: number;
    /** Bipartite-arcs only: half-angle each side of the equator. Default 0.45π (≈81°). */
    bipartiteArcSpan?: number;
}
interface HtnaPlotNode {
    id: string;
    label: string;
    partition: string;
    x: number;
    y: number;
    shape: HtnaShape;
    color: string;
    /** Initial-state probability (0..1) — drives the donut ring fill in renderers that show it. */
    initProb: number;
}
interface HtnaPlotEdge {
    from: string;
    to: string;
    weight: number;
    /** Edge color = source actor's color. */
    color: string;
    /**
     * within  — both endpoints in the same actor group
     * between — endpoints in different actor groups
     * self    — self-loop (from === to)
     */
    kind: 'within' | 'between' | 'self';
    /**
     * Suggested curve magnitude as a unit-less fraction of chord length.
     * 0 means straight line. Renderer chooses sign (which side of the chord
     * the curve bows toward) based on its own conventions. For 'within' and
     * 'between' bidirectional pairs, renderer should pick opposite signs
     * for the two directions to disambiguate them.
     */
    curvature: number;
}
interface HtnaPlotLegendEntry {
    name: string;
    color: string;
    shape: HtnaShape;
}
interface HtnaPlotData {
    layout: HtnaLayout;
    width: number;
    height: number;
    nodes: HtnaPlotNode[];
    edges: HtnaPlotEdge[];
    legend: HtnaPlotLegendEntry[];
}
declare function htnaPlotData(model: TNA, options?: HtnaPlotOptions): HtnaPlotData;

/**
 * MCML hierarchical network plot.
 *
 * The computation/renderer boundary follows Nestimate + cograph:
 * - callers may pass an already-computed MCML object;
 * - a plain TNA may be adapted with named clusters for plotting;
 * - `mode` controls automatic edge labels and never rewrites weights.
 *
 * The returned plot-data package follows the same renderer-neutral pattern as
 * `htnaPlotData()`. `plotMCML()` is the bundled SVG painter for consumers that
 * do not need to supply their own D3/canvas renderer.
 */

declare const MCML_COLOR_PALETTE: readonly ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#999999"];
type McmlMatrix = Matrix | number[][];
type McmlClusters = Record<string, readonly string[]>;
type McmlTheme = 'classic' | 'rich' | 'light';
type McmlSummaryPie = 'inits' | 'self';
type McmlEdgeColorBy = 'auto' | 'cluster' | 'sign';
type McmlAggregation = 'sum' | 'mean' | 'max';
type McmlNodeShape = 'circle' | 'square' | 'diamond' | 'triangle';
interface McmlLayerLike {
    weights: McmlMatrix;
    inits?: ArrayLike<number> | null;
    labels: string[];
    data?: unknown;
}
/** Structural contract shared by Nestimate `mcml` and cograph `cluster_summary`. */
interface McmlLike {
    macro: McmlLayerLike;
    clusters?: Record<string, McmlLayerLike> | null;
    cluster_members: McmlClusters;
    meta?: {
        directed?: boolean;
        n_nodes?: number;
        n_clusters?: number;
        [key: string]: unknown;
    };
    nodes_df?: unknown;
    [key: string]: unknown;
}
interface McmlPlotOptions {
    /** Required only when plotting a plain TNA. */
    clusters?: McmlClusters;
    /** Block aggregation used only for the plain-TNA adapter. Default `sum`. */
    aggregation?: McmlAggregation;
    /** Like current cograph: controls automatic labels, not weight conversion. */
    mode?: 'weights' | 'tna';
    theme?: McmlTheme;
    width?: number;
    height?: number;
    minimum?: number;
    directed?: boolean;
    colors?: string[];
    summaryPie?: McmlSummaryPie;
    edgeColorBy?: McmlEdgeColorBy;
    edgePositiveColor?: string;
    edgeNegativeColor?: string;
    edgeLabels?: boolean;
    summaryEdgeLabels?: boolean;
    edgeLabelDigits?: number;
    showLabels?: boolean;
    summaryLabels?: boolean;
    legend?: boolean;
    title?: string;
    subtitle?: string;
    spacing?: number;
    shapeSize?: number;
    summarySize?: number;
    skewAngle?: number;
    topLayerScale?: [number, number];
    /** This is the active layer-gap control in current cograph. */
    interLayerGap?: number;
    nodeRadiusScale?: number;
    nodeSize?: number;
    nodeShape?: McmlNodeShape | McmlNodeShape[];
    nodeDonut?: boolean;
    nodeDonutInnerRatio?: number;
    summaryDonutInnerRatio?: number;
    curvedEdges?: boolean;
    summaryCurve?: number;
    summaryArrows?: boolean;
    betweenArrows?: boolean;
    edgeWidthRange?: [number, number];
    betweenEdgeWidthRange?: [number, number];
    summaryEdgeWidthRange?: [number, number];
    edgeAlpha?: number;
    betweenEdgeAlpha?: number;
    summaryEdgeAlpha?: number;
    interLayerAlpha?: number;
    shellAlpha?: number;
    shellBorderWidth?: number;
    /** Compatibility-only: current cograph computes this but positions by `interLayerGap`. */
    layerSpacing?: number | null;
    /** Compatibility-only: summary nodes remain circular pies/donuts. */
    clusterShape?: string;
    /** Compatibility-only: detail labels are positioned radially. */
    labelPosition?: number;
}
interface McmlPlotNode {
    id: string;
    label: string;
    cluster: string;
    x: number;
    y: number;
    radius: number;
    color: string;
    shape: McmlNodeShape;
    selfProportion: number;
}
interface McmlPlotShell {
    id: string;
    label: string;
    x: number;
    y: number;
    rx: number;
    ry: number;
    color: string;
}
interface McmlSummaryNode extends McmlPlotShell {
    radius: number;
    proportion: number;
}
type McmlPlotEdgeKind = 'within' | 'between' | 'summary' | 'inter-layer';
interface McmlPlotEdge {
    id: string;
    from: string;
    to: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    weight: number;
    kind: McmlPlotEdgeKind;
    color: string;
    width: number;
    opacity: number;
    directed: boolean;
    label?: string;
    curvature: number;
    loopRotation?: number;
}
interface McmlPlotLegendEntry {
    name: string;
    color: string;
}
interface McmlPlotData {
    width: number;
    height: number;
    directed: boolean;
    theme: McmlTheme;
    nodeDonut: boolean;
    summaryDonut: boolean;
    nodeDonutInnerRatio: number;
    summaryDonutInnerRatio: number;
    title?: string;
    subtitle?: string;
    shells: McmlPlotShell[];
    detailNodes: McmlPlotNode[];
    summaryNodes: McmlSummaryNode[];
    withinEdges: McmlPlotEdge[];
    betweenEdges: McmlPlotEdge[];
    summaryEdges: McmlPlotEdge[];
    interLayerEdges: McmlPlotEdge[];
    legend: McmlPlotLegendEntry[];
    options: Pick<McmlPlotOptions, 'showLabels' | 'summaryLabels' | 'legend' | 'shellAlpha' | 'shellBorderWidth'>;
}
/** Build renderer-neutral geometry and styling for an MCML hierarchy. */
declare function mcmlPlotData(input: TNA | McmlLike, options?: McmlPlotOptions): McmlPlotData;
/** Render an MCML hierarchy as a self-contained SVG string. */
declare function plotMCML(input: TNA | McmlLike, options?: McmlPlotOptions): string;
/** R-style aliases. */
declare const plot_mcml: typeof plotMCML;
declare const mcml_plot_data: typeof mcmlPlotData;

export { type ExtractMetaPathsOptions, type FormatPathsOptions, HTNA_COLOR_PALETTE, HTNA_SHAPE_PALETTE, type HtnaLayout, type HtnaLongOptions, type HtnaOptions, type HtnaPlotData, type HtnaPlotEdge, type HtnaPlotLegendEntry, type HtnaPlotNode, type HtnaPlotOptions, type HtnaShape, type LongRow, MCML_COLOR_PALETTE, type McmlAggregation, type McmlClusters, type McmlEdgeColorBy, type McmlLayerLike, type McmlLike, type McmlMatrix, type McmlNodeShape, type McmlPlotData, type McmlPlotEdge, type McmlPlotEdgeKind, type McmlPlotLegendEntry, type McmlPlotNode, type McmlPlotOptions, type McmlPlotShell, type McmlSummaryNode, type McmlSummaryPie, type McmlTheme, type MetaPathRow, type NetworkDiff, type NetworkDiffEdge, type SequencePlotHtnaData, type SequencePlotHtnaOptions, bootstrapHtna, diffNetworks, extractMetaPaths, formatPaths, htna, htnaFromLong, htnaPlotData, mcmlPlotData, mcml_plot_data, plotMCML, plot_mcml, sequencePlotHtnaData };
