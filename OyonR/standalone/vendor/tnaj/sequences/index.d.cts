/**
 * Prepared (integer-coded) sequence data — output of `prepareSequenceData`.
 *
 * Distinct from the package-root `SequenceData = Sequence[]` (string arrays);
 * this is the integer-coded matrix + alphabet form used internally by the
 * sequence-pattern indices and pattern discovery, ported from the codynaj
 * package.
 */
interface PreparedSequenceData {
    /** Integer-coded sequences (1-based into alphabet, NaN for missing) */
    sequences: number[][];
    /** Sorted unique non-null states */
    alphabet: string[];
}
/** Result of convert() */
type ConvertResult = FrequencyResult | EdgeListResult;
interface FrequencyResult {
    /** Row identifiers (1-based) */
    ids: number[];
    /** State names (column headers) */
    states: string[];
    /** Count or 0/1 matrix [nRows x nStates] */
    matrix: number[][];
}
interface EdgeListEntry {
    id: number;
    from: string;
    to: string;
}
interface ReverseEdgeListEntry {
    id: number;
    state: string;
    previous: string;
}
type EdgeListResult = EdgeListEntry[];
type ReverseEdgeListResult = ReverseEdgeListEntry[];
/** Run-length encoding result */
interface RLEResult {
    values: number[];
    lengths: number[];
}
/** Per-sequence index result */
interface IndexResult {
    validN: number;
    validProportion: number;
    uniqueStates: number;
    meanSpellDuration: number;
    maxSpellDuration: number;
    longitudinalEntropy: number;
    simpsonDiversity: number;
    selfLoopTendency: number;
    transitionRate: number;
    transitionComplexity: number;
    initialStatePersistence: number;
    initialStateProportion: number;
    initialStateInfluenceDecay: number;
    cyclicFeedbackStrength: number;
    firstState: string;
    lastState: string;
    dominantState: string;
    dominantProportion: number;
    dominantMaxSpell: number;
    emergentState: string | null;
    emergentStatePersistence: number | null;
    emergentStateProportion: number | null;
    integrativePotential?: number;
    complexityIndex: number;
}
/** Options for sequenceIndices */
interface IndicesOptions {
    /** States considered favorable for integrative potential */
    favorable?: string[];
    /** Omega parameter for integrative potential weighting (default 1.0) */
    omega?: number;
}
/** Single pattern entry in discovery results */
interface PatternEntry {
    pattern: string;
    length: number;
    frequency: number;
    proportion: number;
    count: number;
    support: number;
    lift: number;
    /** Per-group counts (keys are "count_<groupLabel>") */
    groupCounts?: Record<string, number>;
    chisq?: number;
    pValue?: number;
}
/** Options for discoverPatterns */
interface DiscoverOptions {
    type?: 'ngram' | 'gapped' | 'repeated';
    pattern?: string;
    len?: number[];
    gap?: number[];
    minFreq?: number;
    minSupport?: number;
    start?: string[];
    end?: string[];
    contain?: string[];
    group?: string[] | null;
}
/** Result from discoverPatterns */
interface PatternResult {
    patterns: PatternEntry[];
    /** Internal raw pattern matrices (used by analyzeOutcome) */
    _raw: RawPatterns[];
}
/** Internal: raw pattern matrix from extraction */
interface RawPatterns {
    /** Count matrix [nSequences x nUniquePatterns] */
    matrix: number[][];
    /** Unique pattern labels */
    unique: string[];
    /** Pattern length */
    length: number;
}

/**
 * Prepare sequence data: extract sorted unique alphabet and
 * convert each cell to 1-based integer index (NaN for missing).
 *
 * @param data Wide-format string matrix (rows = sequences, cols = time points).
 *   Null/undefined/empty-string cells treated as missing.
 */
declare function prepareSequenceData(data: (string | null | undefined)[][]): PreparedSequenceData;
/**
 * Run-length encoding matching R's rle() behavior.
 * Each NaN is its own run (since NaN !== NaN, like R's NA != NA → NA).
 */
declare function rle(arr: number[]): RLEResult;
/**
 * Extract last non-missing observation from each sequence as a group label,
 * removing those values from the sequences.
 * Matches R's extract_last().
 */
declare function extractLast(sequences: number[][], alphabet: string[]): {
    sequences: number[][];
    alphabet: string[];
    group: string[];
};

/**
 * Convert wide-format sequence data into various formats.
 *
 * @param data Wide-format string matrix (rows = sequences, cols = time points)
 * @param format Target format: "frequency", "onehot", "edgelist", or "reverse"
 */
declare function convert(data: (string | null | undefined)[][], format?: 'frequency' | 'onehot' | 'edgelist' | 'reverse'): FrequencyResult | EdgeListEntry[] | ReverseEdgeListEntry[];

/**
 * Precise chi-squared upper-tail p-value matching R's pchisq(x, df, lower.tail=FALSE).
 * Uses regularized incomplete gamma function via series/continued-fraction.
 */
/**
 * Chi-squared upper-tail p-value: P(X > x) for X ~ chi2(df).
 * Matches R's pchisq(x, df, lower.tail=FALSE) = Q(df/2, x/2).
 */
declare function chiSqUpperTail(x: number, df: number): number;

/**
 * Compute per-sequence transition count arrays.
 * Returns trans[i][from][to] counts for each sequence i.
 */
declare function sequenceTransitions(sequences: number[][], a: number): number[][][];
/**
 * Compute 24 per-sequence structural indices.
 * Matches R sequence_indices_().
 *
 * @param data Wide-format string matrix
 * @param options Optional: favorable states, omega
 */
declare function sequenceIndices(data: (string | null | undefined)[][], options?: IndicesOptions): IndexResult[];

/**
 * Discover sequence patterns: n-grams, gapped, repeated, or custom search.
 * Matches R discover_patterns().
 *
 * @param data Wide-format string matrix
 * @param options Discovery options
 */
declare function discoverPatterns(data: (string | null | undefined)[][], options?: DiscoverOptions): PatternResult;

/**
 * Sequence descriptive statistics inspired by TraMineR.
 * All functions accept wide-format (string | null)[][] data.
 */
/**
 * State proportions at each time position (TraMineR seqstatd).
 * Ignores null values at each position.
 */
declare function sequenceStateDistribution(data: (string | null)[][]): {
    proportions: number[][];
    counts: number[][];
    states: string[];
    nPositions: number;
};
/**
 * Overall state frequencies across entire dataset (TraMineR seqstatf).
 * Counts each occurrence of each state across all positions.
 * Ignores null values.
 */
declare function sequenceStateFrequencies(data: (string | null)[][]): {
    counts: number[];
    proportions: number[];
    states: string[];
    total: number;
};
/**
 * Mean time (number of positions) spent in each state per sequence (TraMineR seqmeant).
 * Computes per-sequence count of each state, then takes mean and sd across sequences.
 * Uses sample sd (n-1) matching R's sd().
 * Ignores null values.
 */
declare function meanTimeInState(data: (string | null)[][]): {
    meanTime: number[];
    sdTime: number[];
    states: string[];
};
/**
 * Modal (most frequent) state at each position (TraMineR seqmodst).
 * Returns the state with highest frequency at each position, and its proportion.
 * Ties broken alphabetically (states are already sorted).
 */
declare function modalSequence(data: (string | null)[][]): {
    states: string[];
    proportions: number[];
};
/**
 * Shannon entropy at each position.
 * H = -sum(p_i * log2(p_i)) for p_i > 0.
 * Normalized by log2(nStates) so values are in [0, 1].
 * nStates = total number of unique states in the dataset (not just at that position).
 */
declare function entropyProfile(data: (string | null)[][]): {
    entropy: number[];
    nPositions: number;
};
/**
 * Most frequent complete sequences ranked by count.
 * Sequences compared as JSON strings (with nulls stripped from the end).
 * Returns top N (default all).
 */
declare function sequenceFrequencies(data: (string | null)[][], options?: {
    top?: number;
}): {
    sequence: string[];
    count: number;
    proportion: number;
}[];

export { type ConvertResult, type DiscoverOptions, type EdgeListEntry, type EdgeListResult, type FrequencyResult, type IndexResult, type IndicesOptions, type PatternEntry, type PatternResult, type PreparedSequenceData, type RLEResult, type RawPatterns, type ReverseEdgeListEntry, type ReverseEdgeListResult, chiSqUpperTail, convert, discoverPatterns, entropyProfile, extractLast, meanTimeInState, modalSequence, prepareSequenceData, rle, sequenceFrequencies, sequenceIndices, sequenceStateDistribution, sequenceStateFrequencies, sequenceTransitions };
