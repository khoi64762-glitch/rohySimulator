/**
 * prepareLong — the long event-log → wide sequences pivot, WITH metadata.
 *
 * This is the engine's counterpart to R `tna::prepare_data(data, actor, time, action, order,
 * time_threshold, unused_fn)`, and it exists because the function did not exist here and so
 * got written four times:
 *
 *   · Dynalytics_Desktop/src/data.ts   — longToSequences + extractCovariatesPerSequence
 *   · carm-tna's built notebook        — "verbatim copy of Dynalytics longToSequences logic"
 *   · carmnote-htna-pro/lib/model.js   — extractLongRows + cutSessionsOnGap + sessionValues
 *   · R tna::prepare_data              — the original
 *
 * Four copies, and they had drifted at exactly the seams nobody compared: whether a 0/1 flag
 * counts as numeric (so whether it may enter a covariate model at all), how a repeated column
 * is collapsed onto a session, and where a session is cut. One implementation, pinned to R.
 *
 * WHAT METADATA IS. Everything the pivot did not consume, one row per SESSION. Not a rule
 * invented here: R takes `wide_data[, !(sequence_cols | time_cols)]` — so the ACTOR and the
 * raw TIME column survive as metadata too (time collapses to the session's start), and only
 * the action columns (which became T1..Tn) are removed. A column that would otherwise be
 * repeated across a session's events is collapsed by an aggregator.
 *
 * WHY IT AGGREGATES RATHER THAN REFUSES. R's default is `unused_fn = dplyr::first` — take the
 * first value, silently. Dynalytics is type-aware (`numericAgg: 'mean'`, `categoricalAgg:
 * 'mode'`). Both are defensible; neither tells you when the column was NOT constant, which is
 * the case where the aggregation actually changes the answer. So we aggregate like Dynalytics
 * AND report every column that varied within a session, in `meta.varying`. The caller can then
 * refuse it, mean it, or shrug — but never without knowing.
 */
/** How a repeated column is collapsed onto one session. */
type NumericAgg = 'first' | 'last' | 'sum' | 'mean' | 'mode';
type CategoricalAgg = 'first' | 'last' | 'mode';
interface PrepareLongOptions {
    /** Column name (or index) identifying the actor/participant. Required. */
    actor: string | number;
    /** The event/state column that becomes the sequence. Required. */
    action: string | number;
    /** Timestamp column. Used for ordering and for session cutting. */
    time?: string | number;
    /** Explicit ordering column, used when `time` is absent or ties. */
    order?: string | number;
    /**
     * Cut a session after this much inactivity, in the units of `time`.
     * R `prepare_data(time_threshold = 900)`. 0 / undefined = never cut.
     */
    timeThreshold?: number;
    /** Collapse rule for a numeric metadata column. Default 'mean' (Dynalytics). */
    numericAgg?: NumericAgg;
    /** Collapse rule for a categorical metadata column. Default 'mode' (Dynalytics). */
    categoricalAgg?: CategoricalAgg;
}
interface MetaData {
    /** Column names, in dataset order. `.session_id` and `.session_nr` lead, as in R. */
    columns: string[];
    /** One row per SEQUENCE, index-aligned with `sequences`. */
    rows: (string | number | null)[][];
    /** Per column: is it a measurement or a factor? */
    types: ('numeric' | 'categorical')[];
    /**
     * Columns that were NOT constant within at least one session, and how many sessions.
     * The aggregator silently produced a number for these; whether that number MEANS anything
     * is the caller's call, and it cannot make it without being told.
     */
    varying: {
        column: string;
        nSessions: number;
    }[];
}
interface PrepareLongResult {
    /** Wide, ragged sequences — one array per session, in session order. */
    sequences: (string | null)[][];
    /** Session ids, R's format: `<actor> session<N>`. Index-aligned with `sequences`. */
    ids: string[];
    /** The actor each session belongs to (a session is nested in an actor; the tests that
     *  follow usually assume independent rows, and this is what lets a caller notice). */
    actors: string[];
    /** 1-based session number WITHIN the actor (R `.session_nr`). */
    sessionNr: number[];
    /** The RAW ROW INDICES that produced each session, in order. The exact join key for any
     *  per-session quantity: a session id is not always a value in the data (a gap cut mints
     *  `u1 session2`), so joining by id works right up until someone sets a time threshold. */
    seqRowIndices: number[][];
    /** Parsed, sorted time values per session (empty when no time column). */
    times: number[][];
    meta: MetaData;
    statistics: {
        totalSessions: number;
        totalActions: number;
        maxSequenceLength: number;
        meanSequenceLength: number;
        uniqueActors: number;
        /** Sessions per actor — > 1 anywhere means sessions are NESTED and the usual
         *  independence assumption of every downstream test is violated. */
        sessionsPerActor: {
            actor: string;
            nSessions: number;
        }[];
        actionsPerSession: {
            id: string;
            nActions: number;
        }[];
        /** Sessions created by cutting on `timeThreshold` (0 when nothing was cut). */
        sessionsFromGap: number;
    };
}
/** A timestamp as a sortable number: a plain number, else a parsed date. null when neither. */
declare function parseTimeValue(raw: unknown): number | null;
/**
 * Is this column a measurement or a factor?
 *
 * "Every non-blank value parses as a finite number" — and NOTHING else. Dynalytics uses
 * exactly this; carmnote had added "…and more than 2 distinct values", which quietly
 * reclassified every 0/1 indicator as a factor and so barred it from entering a covariate
 * model at all. A binary flag is a perfectly good regressor; the extra clause was a guess at
 * the user's intent that guessed wrong.
 */
declare function isNumericColumn(vals: readonly string[]): boolean;
/**
 * Long event log → wide sequences + metadata.
 *
 * @param rows    raw data rows (arrays of cells, in `headers` order)
 * @param headers column names
 */
declare function prepareLong(rows: readonly (readonly unknown[])[], headers: readonly string[], options: PrepareLongOptions): PrepareLongResult;
interface DesignMatrix {
    /** n x p, WITHOUT an intercept column (mmm adds one). */
    X: number[][];
    /** One name per column of X. A dummy is named `col=level`. */
    names: string[];
    /** The dropped reference level of each factor — the baseline every dummy is read against. */
    reference: Record<string, string>;
    /** Sessions dropped because a term was missing for them, by id. A hole in X cannot be
     *  imputed to 0: that silently places the case at the covariate's origin. */
    dropped: number[];
}
/**
 * Build a design matrix from selected metadata columns.
 *
 * A numeric column enters as itself. A FACTOR with L levels enters as L−1 dummies against a
 * dropped reference level — R's `model.matrix`, and the reason `nnet::multinom` and
 * `seqHMM::build_mmm(formula = ~ condition)` accept factors without the caller thinking about
 * it. carmnote could not: it required numeric covariates, so `condition` simply could not be
 * modelled. Ordinal-encoding it as 1, 2, 3 instead would have produced a slope that looks like
 * a result and means nothing.
 */
declare function designMatrix(meta: MetaData, terms: readonly string[], options?: {
    reference?: Record<string, string>;
}): DesignMatrix;

export { type CategoricalAgg as C, type DesignMatrix as D, type MetaData as M, type NumericAgg as N, type PrepareLongOptions as P, type PrepareLongResult as a, prepareLong as b, designMatrix as d, isNumericColumn as i, parseTimeValue as p };
