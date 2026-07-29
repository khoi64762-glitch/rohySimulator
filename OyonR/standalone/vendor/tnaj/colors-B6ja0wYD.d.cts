import { M as Matrix, h as SequenceData, i as TNAData, B as BuildModelOptions, T as TNA, g as ModelType, j as TransitionParams, G as GroupTNA } from './types-C4ftN5gs.cjs';

/**
 * Dense linear algebra helpers: LU solve and stationary-distribution extraction.
 *
 * These are required by the Markov-chain routines (passage_time, markov_stability)
 * that rely on the Kemeny-Snell identity (I - P + 1·pi^T)^{-1}.
 *
 * Only dense, small-matrix workloads (typical Markov networks have 3..50 states),
 * so a Gaussian elimination with partial pivoting is sufficient.
 */

/**
 * Solve a linear system A·x = b via LU decomposition with partial pivoting.
 *
 * Matches the behaviour of R's `base::solve(A, b)` for well-conditioned systems.
 * Throws on singular or near-singular matrices; the caller is responsible for
 * pre-checking ergodicity when passing a Markov-derived matrix.
 *
 * @param A square n×n matrix (must be non-singular).
 * @param b right-hand side; either an n-vector or an n×m matrix.
 * @returns solution x (same shape as b).
 */
declare function solveLinear(A: Matrix, b: Matrix | Float64Array | number[]): Matrix;
/**
 * Compute the stationary distribution π of a row-stochastic matrix P.
 *
 * Equivalent to R's `.mpt_stationary`: eigen-decompose Pᵀ, pick the eigenvector
 * whose eigenvalue is closest to 1, take |Re(·)|, normalise to sum 1.
 *
 * Because we do not ship a full complex-eigen routine, we use inverse iteration:
 * solve (Pᵀ - I + ε·I)·v = v₀ repeatedly, which converges to the eigenvector
 * associated with the eigenvalue 1. For ergodic row-stochastic P this matches
 * R's `abs(Re(eigen(t(P))$vectors[, idx]))` up to sign/normalisation.
 *
 * As a robustness fallback we also check via power iteration on Pᵀ shifted so
 * that the dominant eigenvalue is unique (the actual computation uses a linear
 * solve of (I - Pᵀ + 1·1ᵀ/n)·π = 1/n which gives π in one shot for ergodic P —
 * a known closed-form trick equivalent to solving πᵀ P = πᵀ, Σπ = 1).
 *
 * @throws if P has a zero row (non-ergodic).
 */
declare function eigenDominantLeft(P: Matrix): Float64Array;

/**
 * Data preparation functions.
 * Port of Python tna/prepare.py
 */

/** Result of importOnehot with window metadata for windowed co-occurrence. */
interface OnehotSequenceData {
    sequences: SequenceData;
    windowSize: number;
    windowSpan: number;
}
/**
 * Create sequence data from a 2D string array (wide format).
 * Extracts unique state labels and optionally adds begin/end states.
 */
declare function createSeqdata(data: SequenceData, options?: {
    beginState?: string;
    endState?: string;
}): {
    data: SequenceData;
    labels: string[];
};
/**
 * Parse wide-format data into a TNAData object.
 * Input: array of arrays where each inner array is a sequence.
 */
declare function prepareData(data: SequenceData, options?: {
    beginState?: string;
    endState?: string;
}): TNAData;
/**
 * Convert one-hot encoded data into wide-format sequence data.
 *
 * Matches R's import_onehot() from the tna package (dev branch).
 *
 * Two-level windowing hierarchy:
 *   - windowSize (R's window_size): rows per sub-window (default 1).
 *   - interval   (R's interval):    sub-windows per output sequence
 *                                   (default = all sub-windows in one sequence).
 *
 * With windowSize=1, interval=3: every 3 consecutive rows form one output
 * sequence, within which each row is treated as its own co-occurrence window.
 * This matches R's default when window_size=1 and interval=3.
 *
 * @param data - Array of records with 0/1 values for each column
 * @param cols - Column names that are one-hot encoded state indicators
 * @param options - windowing options
 * @returns OnehotSequenceData with sequences and window metadata
 */
declare function importOnehot(data: Record<string, number | string>[], cols: string[], options?: {
    actor?: string;
    session?: string;
    /** R's window_size: rows per sub-window (default 1). */
    windowSize?: number;
    /** R's interval: sub-windows per output sequence (default = all sub-windows). */
    interval?: number;
    windowType?: 'tumbling' | 'sliding';
    aggregate?: boolean;
}): OnehotSequenceData;

/** Create a TNA model object. */
declare function createTNA(weights: Matrix, inits: Float64Array, labels: string[], data?: SequenceData | null, type?: ModelType, scaling?: string[], params?: TransitionParams): TNA;
/**
 * Build a TNA model from data.
 *
 * @param x - Input data: sequence data (SequenceData), TNAData, or a square weight matrix (number[][])
 * @param options - Build options
 */
declare function buildModel(x: SequenceData | TNAData | number[][], options?: BuildModelOptions): TNA;
/** Build a relative transition probability model. */
declare function tna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type' | 'params'>): TNA;
/** Build a frequency-based transition model. */
declare function ftna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type' | 'params'>): TNA;
/** Build a co-occurrence transition model. */
declare function ctna(x: SequenceData | TNAData | number[][] | OnehotSequenceData, options?: Omit<BuildModelOptions, 'type'>): TNA;
/** Build an attention-weighted transition model. */
declare function atna(x: SequenceData | TNAData | number[][], options?: Omit<BuildModelOptions, 'type'> & {
    beta?: number;
}): TNA;
/** Get a summary of the TNA model. */
declare function summary(model: TNA): Record<string, unknown>;

/**
 * Transition computation algorithms.
 * Port of Python tna/transitions.py
 */

/**
 * Compute transition matrix and initial probabilities from sequence data.
 */
declare function computeTransitions(data: SequenceData, states: string[], type?: ModelType, params?: TransitionParams): {
    weights: Matrix;
    inits: Float64Array;
};
/**
 * Compute per-sequence transition counts as a 3D array.
 * Returns array of matrices of shape (nStates x nStates),
 * one per sequence, where mat[i][j] = count of i->j transitions in that sequence.
 *
 * Matches R TNA's compute_transitions function.
 */
declare function computeTransitions3D(data: SequenceData, states: string[], type?: ModelType, params?: TransitionParams): Matrix[];
/**
 * Compute weight matrix from array of per-sequence transition matrices.
 * Sums over sequences, then row-normalizes for 'relative' type.
 */
declare function computeWeightsFrom3D(transitions: Matrix[], type?: ModelType, scaling?: string | string[] | null): Matrix;
/** Process an existing weight/count matrix. */
declare function computeWeightsFromMatrix(mat: Matrix, type?: ModelType): Matrix;

/** Check if an object is a GroupTNA (duck typing). */
declare function isGroupTNA(x: unknown): x is GroupTNA;
/**
 * Check if a TNA is an HTNA (has the actor partition populated).
 * HTNA is a TNA with the same shape plus a `partition: string[]` field
 * tagging each node with its actor group — no separate type, no separate factory.
 */
declare function isHtna(x: unknown): x is TNA & {
    partition: string[];
    actorLevels: string[];
};
/** Create a GroupTNA from a models record. */
declare function createGroupTNA(models: Record<string, TNA>): GroupTNA;
/** Get group names. */
declare function groupNames(g: GroupTNA): string[];
/** Iterate over groups. */
declare function groupEntries(g: GroupTNA): [string, TNA][];
/** Apply a function to each group model. */
declare function groupApply<T>(g: GroupTNA, fn: (model: TNA, name: string) => T): Record<string, T>;
/** Rename groups. */
declare function renameGroups(g: GroupTNA, newNames: string[]): GroupTNA;
/** Build grouped relative transition probability models. */
declare function groupTna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped frequency-based transition models. */
declare function groupFtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped co-occurrence transition models. */
declare function groupCtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type' | 'params'>): GroupTNA;
/** Build grouped attention-weighted transition models. */
declare function groupAtna(data: SequenceData, groups: string[], options?: Omit<BuildModelOptions, 'type'> & {
    beta?: number;
}): GroupTNA;

/**
 * Color palette utilities for TNA visualization.
 * Port of Python tna/colors.py
 */
/** Default 9-color palette matching R TNA package. */
declare const DEFAULT_COLORS: string[];
/** Accent palette (8 colors). */
declare const ACCENT_PALETTE: string[];
/** Set3 palette (12 colors). */
declare const SET3_PALETTE: string[];
/**
 * Generate a color palette for TNA visualization.
 *
 * @param nStates - Number of colors needed
 * @param palette - Force a specific palette: 'default', 'accent', 'set3', 'hcl'
 */
declare function colorPalette(nStates: number, palette?: 'default' | 'accent' | 'set3' | 'hcl'): string[];
/** Convert hex to [r, g, b] (0-255). */
declare function hexToRgb(hex: string): [number, number, number];
/** Convert RGB to hex. */
declare function rgbToHex(r: number, g: number, b: number): string;
/** Lighten a color. */
declare function lightenColor(hex: string, amount?: number): string;
/** Darken a color. */
declare function darkenColor(hex: string, amount?: number): string;
/** Create a mapping from labels to colors. */
declare function createColorMap(labels: string[], colors?: string[]): Record<string, string>;

export { ACCENT_PALETTE as A, lightenColor as B, prepareData as C, DEFAULT_COLORS as D, renameGroups as E, rgbToHex as F, solveLinear as G, summary as H, tna as I, type OnehotSequenceData as O, SET3_PALETTE as S, atna as a, buildModel as b, colorPalette as c, computeTransitions as d, computeTransitions3D as e, computeWeightsFrom3D as f, computeWeightsFromMatrix as g, createColorMap as h, createGroupTNA as i, createSeqdata as j, createTNA as k, ctna as l, darkenColor as m, eigenDominantLeft as n, ftna as o, groupApply as p, groupAtna as q, groupCtna as r, groupEntries as s, groupFtna as t, groupNames as u, groupTna as v, hexToRgb as w, importOnehot as x, isGroupTNA as y, isHtna as z };
