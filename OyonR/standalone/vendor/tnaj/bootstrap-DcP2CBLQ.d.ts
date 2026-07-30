import { T as TNA } from './types-C4ftN5gs.js';

/**
 * Window-based Transition Network Analysis (WTNA).
 * Port of R wtna() function / Desktop analysis/wtna.ts.
 *
 * Computes a directed transition matrix M where M[i,j] counts how often
 * state i in window t leads to state j in window t+1, accumulated across all actors.
 *
 * R parameter mapping:
 *   actor=   → groups data; each actor is one independent stream
 *   session= → variable-size windowing column
 *   interval → fixed window size (default 3)
 */
interface WtnaOptions {
    /** Grouping column. Each unique actor value is one independent stream. */
    actor?: string;
    /** Variable-size windowing column (R's session=). */
    session?: string;
    /** Fixed window size in rows (R's interval=, default 3). */
    windowSize?: number;
    /** Windowing strategy for fixed-size windows. */
    windowType?: 'tumbling' | 'sliding';
    type?: 'frequency' | 'relative';
}
interface WtnaResult {
    matrix: number[][];
    withinMatrix: number[][];
    labels: string[];
}
/** Build a binary matrix (n_records × n_codes) from records. */
declare function toBinaryMatrix(records: Record<string, string | number>[], codes: string[]): number[][];
/**
 * Apply fixed-size windowing to a binary matrix X (n_rows × n_cols).
 * Tumbling: non-overlapping blocks. Sliding: overlapping windows.
 */
declare function applyWindowing(X: number[][], windowSize: number, mode: 'tumbling' | 'sliding'): number[][];
/**
 * Apply variable-size windowing using row labels (R's session= parameter).
 * Consecutive rows sharing the same label are OR-reduced into one window.
 */
declare function applyIntervalWindowing(X: number[][], labels: string[]): number[][];
/**
 * Compute the transition matrix T from windowed binary matrix W.
 * T[i,j] = Σ_t W[t,i] * W[t+1,j]
 *
 * NOTE: This is WTNA-specific, operating on plain number[][].
 * Not to be confused with core/transitions.ts computeTransitions (SequenceData → Matrix).
 */
declare function computeWtnaTransitions(W: number[][]): number[][];
/**
 * Compute within-window co-occurrence matrix from windowed binary matrix W.
 * C[i,j] = Σ_t W[t,i] · W[t,j] for i ≠ j (zero diagonal).
 */
declare function computeWithinWindow(W: number[][]): number[][];
/** Row-normalize matrix M (type = 'relative'). */
declare function rowNormalizeWtna(M: number[][]): number[][];
/**
 * Compute the WTNA transition matrix from one-hot records.
 *
 * @param records Flat array of data rows (binary cols + optional actor/session strings).
 * @param codes   Column names for the binary state columns.
 * @param opts    Actor/session column names, window settings, weight type.
 */
declare function buildWtnaMatrix(records: Record<string, string | number>[], codes: string[], opts?: WtnaOptions): WtnaResult;

/**
 * Bootstrap resampling for TNA model stability testing.
 * Port of Desktop analysis/bootstrap.ts.
 * Uses tnaj's computeTransitions3D / computeWeightsFrom3D for R equivalence.
 */

interface BootstrapEdge {
    from: string;
    to: string;
    weight: number;
    bootstrapMean: number;
    bias: number;
    pValue: number;
    significant: boolean;
    crLower: number;
    crUpper: number;
    ciLower: number;
    ciUpper: number;
}
interface BootstrapResult {
    edges: BootstrapEdge[];
    model: TNA;
    labels: string[];
    method: string;
    iter: number;
    level: number;
    weightsMean: Float64Array;
    weightsSd: Float64Array;
    weightsBias: Float64Array;
}
interface BootstrapOptions {
    iter?: number;
    level?: number;
    method?: 'stability' | 'threshold';
    threshold?: number;
    consistencyRange?: [number, number];
    seed?: number;
}
/**
 * Bootstrap a TNA model to assess edge stability.
 * The model must have sequence data (model.data).
 */
declare function bootstrapTna(model: TNA, options?: BootstrapOptions): BootstrapResult;
/** Input for WTNA bootstrap. */
interface BootstrapWtnaInput {
    originalModel: TNA;
    records: Record<string, string | number>[];
    codes: string[];
    wtnaOpts: WtnaOptions;
    modelType: 'tna' | 'ftna';
    scaling: string | null | '';
}
/**
 * Bootstrap a WTNA model to assess edge stability via row-level resampling.
 */
declare function bootstrapWtna(input: BootstrapWtnaInput, options?: BootstrapOptions): BootstrapResult;

export { type BootstrapEdge as B, type WtnaOptions as W, type BootstrapOptions as a, type BootstrapResult as b, type BootstrapWtnaInput as c, type WtnaResult as d, applyIntervalWindowing as e, applyWindowing as f, bootstrapTna as g, bootstrapWtna as h, buildWtnaMatrix as i, computeWithinWindow as j, computeWtnaTransitions as k, rowNormalizeWtna as r, toBinaryMatrix as t };
