/**
 * TypingAggregator — aggregates one composition episode (the period during
 * which a learner writes into a single host-registered composer) into a
 * `typing-v3` window, mirroring the cadence/ISO conventions of
 * `EngagementAggregator` / `PostureAggregator`.
 *
 * This class is PURE: no DOM, no timers, no globals. All timing comes in as
 * arguments (monotonic milliseconds, e.g. `performance.now()`); the only use
 * of wall-clock time is `options.now()`, and that is used exclusively to
 * stamp the ISO `window_start` / `window_end` strings on the output — it
 * never enters any duration/interval computation.
 *
 * The DOM adapter (host-side) is responsible for turning `input` /
 * `beforeinput` / `compositionstart|update|end` / `selectionchange` events
 * into calls to `record()`; see docs/TYPING.md and audio_text.md §4.
 *
 * Every metric below is an operational definition, not a psychological
 * state — see the comment on each field.
 *
 * ---- typing-v2: per-event state labels + positional deltas ----
 *
 * On top of the `typing-v1` window accounting (unchanged below), every
 * `record()` call — plus `start()` and `finalize()` — synthesizes exactly one
 * event object drawn from the closed, versioned `OYON_TYPING_STATES`
 * vocabulary (`src/version.js`, `typing-states-v1`) and hands it to the
 * caller-supplied `onEvent` callback. This class does NOT own the per-event
 * log (`signal_events` / `SignalEventLog`) — it only emits; wiring emitted
 * events into a log/store is the caller's job.
 *
 * Each edit-shaped event also carries a positional delta
 * (`detail.offset` / `detail.length` / `detail.op`) and, when a position is
 * known, an entry is appended to `typing.revision_locations` on the window —
 * this is what gives REVISION LOCATION (where an edit happened), not the
 * edited text itself (Oyon never carries content — see docs/TYPING.md).
 *
 * ---- typing-v3: writing-process metrics + absolute timestamps ----
 *
 * `typing-v3` adds the standard keystroke-logging-research metrics
 * (Inputlog, Leijten & Van Waes) that `typing-v2` conspicuously lacked, plus
 * an absolute-time anchor for every relative/monotonic series. All of it is
 * additive: every `typing-v1`/`typing-v2` field keeps meaning exactly what it
 * meant before.
 *
 * `record()` gains four OPTIONAL input fields — `wallTimestamp`,
 * `previousWords`, `currentWords`, `boundaryContext` — supplied by a newer
 * capture adapter. This class never assumes their presence: every metric
 * derived from them degrades to `null` (never `0`) when they are absent, so
 * "never measured" stays distinguishable from "measured as zero". See the
 * field-by-field notes below and docs/TYPING.md.
 *
 * New fields on `window.typing`:
 *   - `edit_timestamps_ms` — absolute wall-clock ms per retained interval in
 *     `inter_event_intervals_ms` (same order, same length, same cap): the
 *     interval series is deltas with no anchor, this anchors it.
 *   - `p_burst_count` / `r_burst_count` / `p_burst_mean_graphemes` /
 *     `r_burst_mean_graphemes` / `mean_burst_graphemes` — the P-burst
 *     (pause-terminated) vs R-burst (revision-terminated) distinction from
 *     Chenoweth & Hayes, operationalized on this class's own event stream.
 *     `burst_count` (v1) is unchanged and still counts every threshold-gap
 *     the old way.
 *   - `revision_distance_mean` / `revision_distance_median` /
 *     `leading_edge_revision_ratio` — how far back from the document's
 *     current end each positioned edit landed; `distance` is also added to
 *     every `revision_locations` entry. `null` when no edit ever carried a
 *     `caretOffset`.
 *   - `chars_per_min` / `chars_per_min_active` / `words_per_min` /
 *     `words_per_min_active` / `mean_burst_words` — fluency in the field's
 *     conventional reporting units. The `words_*` fields and
 *     `mean_burst_words` are `null` unless the caller ever supplied
 *     `previousWords`/`currentWords`.
 *   - `produced_graphemes` / `product_ratio` / `baseline_graphemes` /
 *     `baseline_words` — process-vs-product: how much of what was typed THIS
 *     EPISODE survived into the final text. See "Episode baseline" below —
 *     every produced/committed comparison and every fluency rate is scoped to
 *     the episode's own contribution, never to text that pre-existed the
 *     episode.
 *   - `pause_location_counts` — pause counts bucketed by `boundaryContext`
 *     (`mid_word` / `word_boundary` / `sentence_boundary` /
 *     `paragraph_boundary`). `null` unless `boundaryContext` was ever
 *     supplied.
 *   - `adaptive_burst_count` / `adaptive_active_input_ms` — present ONLY in
 *     `pauseThresholdMode: 'adaptive'` (see below); the FIXED-threshold
 *     `burst_count` / `active_input_ms` / `pause_histogram` are computed
 *     identically in both modes.
 *
 * New fields on `window.quality.thresholds`: `pause_threshold_mode`,
 * `leading_edge_tolerance_graphemes`, and (adaptive mode only)
 * `adaptive_burst_threshold_ms` / `adaptive_rule`.
 *
 * Every emitted event object (`onEvent`) and every `revision_locations`
 * entry gains `wall_ms`: the caller-supplied `wallTimestamp` (a real
 * `Date.now()` reading taken by the adapter at `record()` time) when given,
 * else the same synthesized wall-clock value already used for the event's
 * `timestamp` field. `timestamp` and `monotonic_ms` on events, and `t` on
 * `revision_locations` entries, are UNCHANGED — `wall_ms` is purely additive.
 *
 * ---- Episode baseline (process-vs-product and fluency scoping) ----
 *
 * A composition episode routinely starts inside a composer that ALREADY
 * holds text (a saved draft, a quoted reply, a re-opened essay). The first
 * committed edit's `previousGraphemes` is captured as `baseline_graphemes`
 * (and the first word-carrying edit's `previousWords` as `baseline_words`):
 * the document length the episode found, not something it wrote.
 *
 *   - `committed_graphemes` stays what it always was: the FINAL DOCUMENT
 *     length (grapheme clusters) at episode end — a document-level fact.
 *   - The episode's NET PRODUCTION is `committed_graphemes -
 *     baseline_graphemes`, which is identically `inserted_graphemes -
 *     deleted_graphemes`. It is negative when the episode net-deleted
 *     pre-existing text.
 *   - `product_ratio` = `max(0, produced_graphemes - deleted_graphemes) /
 *     produced_graphemes` — the share of graphemes typed THIS EPISODE that
 *     survived to episode end, bounded to [0, 1]; `null` when nothing was
 *     produced. (This is an operational LOWER bound: deletions of
 *     pre-existing text are indistinguishable from deletions of new text in
 *     the delta stream, so they subtract here too.) For an episode starting
 *     from an empty field this is exactly the classic
 *     committed/produced Inputlog ratio.
 *   - Every fluency rate (`chars_per_min`, `chars_per_min_active`,
 *     `production_rate_per_active_min`, `words_per_min`,
 *     `words_per_min_active`) uses the episode's net production
 *     (floored at 0 — the deletion signal lives in `deleted_graphemes` /
 *     `revision_ratio`, not in a negative rate), never the whole document
 *     length. Adding one character to a 100-character draft is 1 char of
 *     production, not 101.
 *
 * ---- Null discipline for rates / ratios / means ----
 *
 * A statistic whose denominator is 0 was NOT MEASURED and reports `null`,
 * never 0: `chars_per_min*` / `words_per_min*` /
 * `production_rate_per_active_min` with no elapsed/active time,
 * `revision_ratio` with nothing inserted, `product_ratio` with nothing
 * produced, and every `*_mean_*` burst figure with zero closed bursts of
 * that kind. SUMS and COUNTS over an empty set (e.g. `active_input_ms`,
 * `burst_count`, `deleted_graphemes`) are legitimately 0.
 *
 * ---- P-burst / R-burst tie-break rule ----
 *
 * A burst is a run of contiguous PRODUCTION edits (anything other than
 * `delete` / `replace` / `correct`). It closes — and a new one starts — on
 * either of two triggers, evaluated in this order for every edit event:
 *   1. A PAUSE: the inter-edit interval before this event is >= the FIXED
 *      `burstThresholdMs` (adaptive mode never changes this check — see
 *      below). If the in-progress burst had any production, it closes as a
 *      P-burst.
 *   2. A REVISION: this event's own state is `delete`, `replace`, or
 *      `correct`. If the in-progress burst (after step 1 above has
 *      already run) still has production, it closes as an R-burst.
 *
 * An accepted correction (`correct`, i.e. `insertReplacementText`) is a
 * REVISION in BOTH families: it counts into the revision-distance
 * statistics (`revision_distance_*`) AND closes an R-burst — the two views
 * must never disagree about whether a correction revised the text. A
 * same-length correction with no visible selection is still an edit (the
 * text changed even though the length did not) and is classified `correct`,
 * not `move`.
 *
 * Resolving the pause FIRST is the tie-break: when a long silence is
 * immediately followed by a delete, the pause closes the prior burst as a
 * P-burst, so the arriving revision lands on an already-empty burst and does
 * NOT itself close an R-burst. Pause wins the tie.
 *
 * A revision event never contributes to a burst's own grapheme/word count —
 * it is a boundary, not production. An in-progress burst still open at
 * `finalize()` (ended by submit/abandon, not by a pause or a revision) closes
 * as a P-burst: episode termination is not a revision, so by elimination it
 * groups with P.
 *
 * ---- Adaptive pause threshold ----
 *
 * `pauseThresholdMode: 'adaptive'` derives a per-writer pause threshold as
 * 3x the writer's own median inter-keystroke interval (IKI), computed from
 * the COMPLETE inter-edit interval series — a private, adaptive-mode-only
 * accumulator that is never capped by `maxIntervals` (that cap is a
 * TRANSPORT bound on the exported raw series, not a measurement bound; see
 * the option comment). `adaptive_burst_count` / `adaptive_active_input_ms`
 * are likewise computed over every interval of the episode, exactly like
 * the fixed-mode `burst_count` / `active_input_ms` are. Median (not mean) because
 * IKI distributions are heavy-tailed/log-normal — a few genuine pauses would
 * inflate a mean-based estimate, silently raising the very threshold meant
 * to detect them; the median is robust to that. A x3 multiplicative margin
 * (not an additive one) scales correctly across writers with very different
 * baseline rhythms — a fast typist's median IKI might be 80ms (adaptive
 * threshold ~240ms), a slow typist's 400ms (~1200ms), and a fixed additive
 * margin would fit neither. Falls back to the fixed threshold when there are
 * no intervals, or the median is degenerate (zero).
 *
 * CRITICAL: adaptive mode never changes `burst_count`, `active_input_ms`, or
 * `pause_histogram` — those stay computed against the FIXED
 * `burstThresholdMs` in both modes, so results stay comparable across
 * studies. The adaptively-derived figures are additive, clearly-named
 * `adaptive_*` fields.
 */

import { OYON_TYPING_STATES } from '../version.js';

const MODALITY = 'typing';
const FEATURE_PROFILE = 'typing-v3';
const EVENT_SOURCE = 'user';

/** state -> short `detail.op` / `revision_locations[].op` label. */
const STATE_TO_OP = {
  insert: 'insert',
  delete: 'delete',
  replace: 'replace',
  paste: 'paste',
  undo: 'undo',
  redo: 'redo',
  correct: 'correct',
  compose: 'compose',
  composing: 'composing',
  commit: 'commit',
  move: 'move',
  select: 'select',
  deselect: 'deselect',
};

/**
 * Boundary-context vocabulary for `pause_location_counts` (typing-v3). Kept
 * local (not in `src/version.js`) because it describes the shape of a
 * `record()` input field, not a per-event state on the `OYON_TYPING_STATES`
 * wire vocabulary.
 */
const PAUSE_LOCATION_KEYS = ['mid_word', 'word_boundary', 'sentence_boundary', 'paragraph_boundary'];

/** typing-v3 adaptive-threshold rule identifier — see class doc comment. */
const ADAPTIVE_PAUSE_MEDIAN_MULTIPLIER = 3;
const ADAPTIVE_RULE_ID = 'median_iki_x3';

export class TypingAggregator {
  constructor(options = {}) {
    this.options = {
      // Upper bounds (ms) for the pause histogram. With the defaults below
      // this produces exactly the five buckets in the `typing-v1` contract:
      // lt_500_ms, 500_to_1000_ms, 1000_to_2000_ms, 2000_to_5000_ms, gte_5000_ms.
      pauseBuckets: [500, 1000, 2000, 5000],
      // A pause >= this ends the current burst and starts a new one, AND is
      // the same threshold used to synthesize a `pause` event (see below).
      // This is the FIXED threshold — `pauseThresholdMode: 'adaptive'` never
      // changes what this option means or what it drives (see class doc).
      burstThresholdMs: 2000,
      // Cap on the retained `inter_event_intervals_ms` series (transport
      // bound). Every other metric (histogram, active time, bursts, AND the
      // typing-v3 adaptive threshold/burst figures — which use a private
      // uncapped accumulator in adaptive mode) keeps counting past this cap;
      // only the raw exported series stops growing. Also bounds
      // `revision_locations` and `edit_timestamps_ms` (see
      // `_recordRevisionLocation`).
      maxIntervals: 5000,
      // Wall clock, used ONLY for the ISO window_start / window_end strings.
      now: () => Date.now(),
      // Per-event sink: `onEvent(event)`. `null` (default) means "emit
      // nothing" — every `_dispatchEvent` call becomes a no-op. Never throws
      // on the caller's behalf; a throwing `onEvent` propagates as-is, same
      // as `TypingComposerAdapter`'s `onWindow`.
      onEvent: null,
      // typing-v3: 'fixed' (default, unchanged v1/v2 behaviour) or
      // 'adaptive' (adds parallel adaptive_* figures — see class doc).
      pauseThresholdMode: 'fixed',
      // typing-v3: an edit at or below this many graphemes from the current
      // document end counts as "leading edge" for `leading_edge_revision_ratio`.
      leadingEdgeToleranceGraphemes: 2,
      ...options,
    };

    if (this.options.pauseThresholdMode !== 'fixed' && this.options.pauseThresholdMode !== 'adaptive') {
      throw new Error(
        `TypingAggregator: pauseThresholdMode must be 'fixed' or 'adaptive', got ${JSON.stringify(this.options.pauseThresholdMode)}`,
      );
    }

    this._pauseHistogramKeys = buildPauseHistogramKeys(this.options.pauseBuckets);
    this._reset();
  }

  /** True while a composition episode is in progress (between start/finalize). */
  get active() {
    return this._started;
  }

  /** Begin a new composition episode. Discards any prior unfinished episode. */
  start({ timestamp, targetKind = null, targetId = null }) {
    this._reset();
    this._started = true;
    this._startTimestamp = timestamp;
    this._startWallClock = this.options.now();
    this._target = (targetKind != null || targetId != null)
      ? { kind: targetKind, id: targetId }
      : null;

    // Anchor for pause-gap detection (see `_maybeEmitPause`): a long silent
    // gap between start and the first real interaction is itself
    // analytically meaningful (was the learner staring at a blank composer?)
    // so start counts as the first "event" in the pause timeline.
    this._lastEventTimestamp = timestamp;
    this._dispatchEvent('start', timestamp, null);
  }

  /** Consume one input event. No-op (and never throws) when not active. */
  record(event) {
    if (!this._started) return;

    const {
      timestamp,
      inputType = null,
      previousGraphemes,
      currentGraphemes,
      replacedSelection = false,
      compositionState = 'none',
      // typing-v2: optional per-event position. Absent -> every edit state
      // still fires correctly, just with `detail.offset: null` (degraded,
      // not broken) and no `revision_locations` entry (there is nothing
      // positional to record without an offset).
      caretOffset = null,
      selectionLength = null,
      // typing-v3: optional fields a caller MAY supply (see class doc).
      // `wallTimestamp` is a real `Date.now()` reading taken by the adapter
      // at record() time; `previousWords`/`currentWords` are word counts
      // around the edit; `boundaryContext` classifies where the caret sat.
      // All default to absent, and code defensively throughout — a
      // concurrent workstream is adding these to the capture adapter, and
      // this class must keep working correctly before that lands.
      wallTimestamp = null,
      previousWords = null,
      currentWords = null,
      boundaryContext = null,
    } = event;

    // A pause is synthesized relative to ANY prior event (edit, composition,
    // cursor/selection, or start) — not just prior edits, which is
    // what `_lastEditTimestamp` below tracks for the v1 metrics. This is a
    // deliberate decoupling: v1's `burst_count`/`active_input_ms` describe
    // EDITING bursts specifically, while the synthesized `pause` state
    // describes a gap in the whole interaction stream (a learner re-reading
    // via selection counts as "still present", not a pause).
    this._maybeEmitPause(timestamp);
    this._lastEventTimestamp = timestamp;

    const delta = currentGraphemes - previousGraphemes;
    const isUndo = inputType === 'historyUndo';
    const isRedo = inputType === 'historyRedo';
    const isPaste = isPasteInputType(inputType);
    // Accepted spelling/autocorrect suggestion. Both the native spellcheck menu
    // and OS autocorrect surface as `insertReplacementText`.
    const isCorrection = inputType === 'insertReplacementText';
    // An accepted correction is an edit even when it nets to zero graphemes
    // with no visible selection (the flagged word was swapped in place) —
    // without `isCorrection` here it would fall through to the
    // caret/selection path below and be misclassified `move`.
    const isEditSignal =
      compositionState !== 'none' || delta !== 0 || replacedSelection || isUndo || isRedo || isPaste || isCorrection;

    if (!isEditSignal) {
      // No text changed: this call exists purely to report caret/selection
      // movement (e.g. `TypingComposerAdapter`'s throttled `selectionchange`
      // listener, or a plain `input` event that happened to net to zero
      // graphemes). Does not touch any v1 accounting below.
      const state = resolveSelectionState(selectionLength, this._lastSelectionLength);
      this._emitTypingEvent(state, { timestamp, caretOffset, selectionLength, wallTimestamp });
      this._updateSelectionMemory(caretOffset, selectionLength);
      return;
    }

    // Intermediate IME states are candidate text, not committed input: they
    // are counted into `composition_count` but must not move any edit,
    // grapheme, or interval accounting. `compositionend` (below) is the
    // commit point for the whole composition.
    if (compositionState === 'update') {
      this._compositionCount += 1;
      this._emitTypingEvent('composing', { timestamp, caretOffset, selectionLength, wallTimestamp });
      this._updateSelectionMemory(caretOffset, selectionLength);
      return;
    }
    if (compositionState === 'end') {
      this._compositionCount += 1;
    }

    this._editEventCount += 1;

    // typing-v3 episode baseline: the document length the episode FOUND
    // (before its first committed edit). Everything the episode itself
    // produced/committed is measured against this anchor — see the class doc
    // "Episode baseline". `null` until the first committed edit.
    if (this._baselineGraphemes === null && Number.isFinite(previousGraphemes)) {
      this._baselineGraphemes = previousGraphemes;
    }

    if (delta > 0) {
      this._insertedGraphemes += delta;
    } else if (delta < 0) {
      this._deletedGraphemes += -delta;
    }
    // delta === 0 with replacedSelection === true (e.g. "abc" -> "xyz") is
    // still an edit event; it was already counted above via editEventCount.

    // We only observe the net grapheme delta, not which graphemes were
    // replaced, so this is a lower-bound proxy: it only captures the case
    // where the replacement made the field net shorter. A same-length or
    // net-longer replacement (e.g. "a" -> "hello") reports 0 here even
    // though a selection was in fact replaced — that information isn't
    // recoverable from delta alone.
    if (replacedSelection) {
      this._replacementGraphemes += Math.max(0, previousGraphemes - currentGraphemes);
    }

    if (isPaste) {
      this._pastedGraphemes += Math.max(0, delta);
    }

    // Current DOCUMENT length — the composer's full text, including anything
    // that pre-existed this episode. Episode-scoped production is measured
    // against `_baselineGraphemes` at finalize (class doc "Episode baseline").
    this._committedGraphemes = currentGraphemes;

    // typing-v3: word-count accounting, present only when the caller
    // supplies both endpoints for this edit. `_sawWordCounts` latches true
    // the first time this happens so every word-derived aggregate can report
    // `null` (never measured) instead of `0` (measured, zero) when it never
    // does across the whole episode.
    let wordDelta = null;
    if (Number.isFinite(previousWords) && Number.isFinite(currentWords)) {
      wordDelta = currentWords - previousWords;
      // Word-count baseline: `previousWords` of the FIRST word-carrying edit.
      // An approximation when word counts only start arriving mid-episode —
      // the best available anchor for episode-net word production.
      if (this._baselineWords === null) this._baselineWords = previousWords;
      this._sawWordCounts = true;
      this._lastWordCount = currentWords;
    }

    let pauseBeforeThisEdit = false;
    if (this._lastEditTimestamp === null) {
      // Gap from episode start to the first committed edit.
      this._firstInputLatencyMs = Math.max(0, timestamp - this._startTimestamp);
      // An episode with at least one edit has at least one burst.
      this._burstCount = 1;
    } else {
      const interval = Math.max(0, timestamp - this._lastEditTimestamp);
      if (this._intervals.length < this.options.maxIntervals) {
        this._intervals.push(interval);
        // typing-v3: anchors this interval to an absolute wall-clock time —
        // same retention cap, same push site, so the two arrays always stay
        // the same length (see `edit_timestamps_ms` in the class doc).
        this._editTimestampsMs.push(this._resolveWallMs(timestamp, wallTimestamp));
      } else {
        this._intervalsTruncated = true;
      }
      this._accumulateInterval(interval);
      // typing-v3 adaptive mode: private, UNCAPPED interval accumulator —
      // the adaptive threshold and adaptive_* figures must describe the
      // whole episode, not the `maxIntervals`-capped exported prefix.
      if (this.options.pauseThresholdMode === 'adaptive') this._adaptiveIntervals.push(interval);
      // typing-v3: always evaluated against the FIXED threshold, in BOTH
      // pauseThresholdMode values — see class doc "Adaptive pause threshold".
      pauseBeforeThisEdit = interval >= this.options.burstThresholdMs;
    }
    this._lastEditTimestamp = timestamp;

    // ---- typing-v2: state label + positional delta ----
    const state = resolveEditState({ compositionState, isUndo, isRedo, isPaste, isCorrection, replacedSelection, delta });
    if (state === 'correct') this._correctionCount += 1;
    const opName = STATE_TO_OP[state] || state;
    // Prefer the caller-supplied selection extent (what changed size-wise at
    // this position); fall back to the magnitude of the grapheme delta when
    // it wasn't supplied. A same-length replacement with no selectionLength
    // given reports 0 — the same documented lower bound as
    // `replacement_graphemes` above.
    const length = Number.isFinite(selectionLength) ? selectionLength : Math.abs(delta);
    this._emitTypingEvent(state, { timestamp, caretOffset, lengthOverride: length, op: opName, wallTimestamp });

    // ---- typing-v3: P-burst / R-burst classification ----
    // See the class doc "P-burst / R-burst tie-break rule": the pause (if
    // any) is resolved BEFORE this event's own revision/production
    // classification, which is what makes pause win a same-transition tie.
    // `correct` is a revision here for the same reason it is one in the
    // revision-distance statistics (`revisionOps` in finalize) — the two
    // families must agree on what counts as a revision.
    const isRevisionState = state === 'delete' || state === 'replace' || state === 'correct';
    if (pauseBeforeThisEdit) this._closeCurrentBurst('p');
    if (isRevisionState) {
      this._closeCurrentBurst('r');
    } else {
      this._currentBurst.hasProduction = true;
      this._currentBurst.graphemes += Math.max(0, delta);
      if (wordDelta !== null) this._currentBurst.words += Math.max(0, wordDelta);
    }

    // ---- typing-v3: pause location (boundary context) ----
    // Scoped to the same fixed-threshold inter-edit pause used for bursts
    // above (not the broader any-event `_maybeEmitPause` gap) — boundary
    // context is only meaningful relative to a committed edit's position.
    if (boundaryContext !== null && boundaryContext !== undefined) {
      this._sawBoundaryContext = true;
      if (pauseBeforeThisEdit && Object.prototype.hasOwnProperty.call(this._pauseLocationCounts, boundaryContext)) {
        this._pauseLocationCounts[boundaryContext] += 1;
      }
    }

    if (Number.isFinite(caretOffset)) {
      this._recordRevisionLocation({
        offset: caretOffset,
        length,
        op: opName,
        t: timestamp,
        // typing-v3 additions — see class doc.
        wall_ms: this._resolveWallMs(timestamp, wallTimestamp),
        // 0 = caret sits at the current document end (leading edge); larger
        // = further back into already-written text (restructuring). Clamped
        // at 0 defensively (a caretOffset past the reported document end
        // should not happen, but must never produce a negative distance).
        distance: Math.max(0, currentGraphemes - caretOffset),
      });
    }
    this._updateSelectionMemory(caretOffset, selectionLength);
  }

  /** End the episode and return its window, or `null` if there was none. */
  finalize({ timestamp, reason }) {
    if (reason !== 'submitted' && reason !== 'abandoned') {
      throw new Error(
        `TypingAggregator.finalize: reason must be 'submitted' or 'abandoned', got ${JSON.stringify(reason)}`,
      );
    }
    if (!this._started) return null;

    this._maybeEmitPause(timestamp);
    this._dispatchEvent(reason === 'submitted' ? 'submit' : 'abandon', timestamp, null);
    // typing-v3: an episode ending mid-burst (submit/abandon, not a pause or
    // a revision) closes that burst as a P-burst — see class doc.
    this._closeCurrentBurst('trailing');

    const elapsedMs = Math.max(0, timestamp - this._startTimestamp);
    const insertedGraphemes = this._insertedGraphemes;
    const deletedGraphemes = this._deletedGraphemes;
    const activeInputMs = this._activeInputMs;
    const committedGraphemes = this._committedGraphemes;

    // deleted / inserted; null (unmeasurable, NOT 0) when nothing was
    // inserted — an episode that only deleted, or did nothing, has no
    // insertion base to express its deletions against.
    const revisionRatio = insertedGraphemes > 0 ? deletedGraphemes / insertedGraphemes : null;

    // ---- typing-v3: episode baseline + net production (see class doc) ----
    // The document length the episode found (null when there were no edits),
    // and the episode's own net effect on it. `netProducedGraphemes` is
    // identically `inserted - deleted`; it is negative when the episode
    // net-deleted pre-existing text. Rates floor it at 0 — a rate is a
    // production figure, and the deletion signal is carried by
    // `deleted_graphemes` / `revision_ratio`.
    const baselineGraphemes = this._baselineGraphemes;
    const netProducedGraphemes = committedGraphemes - (baselineGraphemes ?? 0);
    const episodeProduction = Math.max(0, netProducedGraphemes);

    // Episode net production per active minute; null (unmeasurable) when no
    // active time was observed.
    const productionRatePerActiveMin = activeInputMs > 0
      ? episodeProduction / (activeInputMs / 60000)
      : null;

    // ---- typing-v3: process vs. product ----
    // "Everything typed" — identical to `inserted_graphemes` (both accumulate
    // every positive net delta across the episode); exposed under this name
    // so `product_ratio` reads naturally without cross-referencing a
    // differently-named v1 field.
    const producedGraphemes = insertedGraphemes;
    // Share of this episode's typed graphemes that survived to episode end:
    // max(0, produced - deleted) / produced, bounded to [0, 1]. NEVER uses
    // the whole-document `committed_graphemes` as numerator — text that
    // pre-existed the episode is not something this episode produced. Null
    // (unmeasurable) when nothing was produced. See class doc
    // "Episode baseline" for the lower-bound caveat.
    const productRatio = producedGraphemes > 0
      ? Math.max(0, producedGraphemes - deletedGraphemes) / producedGraphemes
      : null;

    // ---- typing-v3: fluency in the field's reporting units ----
    // All rates are EPISODE-scoped (net production against the baseline,
    // floored at 0) and null — never 0 — when their time denominator is 0.
    const charsPerMin = elapsedMs > 0 ? episodeProduction / (elapsedMs / 60000) : null;
    const charsPerMinActive = activeInputMs > 0 ? episodeProduction / (activeInputMs / 60000) : null;
    const baselineWords = this._baselineWords;
    const netProducedWords = this._sawWordCounts
      ? Math.max(0, this._lastWordCount - (baselineWords ?? 0))
      : null;
    const wordsPerMin = this._sawWordCounts && elapsedMs > 0
      ? netProducedWords / (elapsedMs / 60000)
      : null;
    const wordsPerMinActive = this._sawWordCounts && activeInputMs > 0
      ? netProducedWords / (activeInputMs / 60000)
      : null;

    // ---- typing-v3: P-burst / R-burst summary ----
    // Counts are real zeros when no burst closed; the MEANS over zero closed
    // bursts are unmeasurable and report null (see class doc "Null
    // discipline").
    const totalClosedBursts = this._pBurstCount + this._rBurstCount;
    const burstGraphemesTotal = this._pBurstGraphemesTotal + this._rBurstGraphemesTotal;
    const meanBurstGraphemes = totalClosedBursts > 0 ? burstGraphemesTotal / totalClosedBursts : null;
    const pBurstMeanGraphemes = this._pBurstCount > 0 ? this._pBurstGraphemesTotal / this._pBurstCount : null;
    const rBurstMeanGraphemes = this._rBurstCount > 0 ? this._rBurstGraphemesTotal / this._rBurstCount : null;
    const meanBurstWords = this._sawWordCounts && totalClosedBursts > 0
      ? this._burstWordsTotal / totalClosedBursts
      : null;

    // ---- typing-v3: revision distance from the point of inscription ----
    // Over REVISIONS ONLY (delete / replace / accepted correction), not every
    // positioned edit. `revision_locations` deliberately logs all edits — it is
    // the positional replay stream — but plain inserts sit at distance 0 by
    // definition and would swamp these statistics, making a writer who never
    // goes back look identical to one who does. The keystroke-logging
    // literature means deletes and replaces by "revision"; so do these fields.
    const revisionOps = new Set(['delete', 'replace', 'correct']);
    const distances = this._revisionLocations
      .filter((entry) => revisionOps.has(entry.op))
      .map((entry) => entry.distance);
    const revisionDistanceMean = distances.length > 0 ? mean(distances) : null;
    const revisionDistanceMedian = distances.length > 0 ? median(distances) : null;
    const leadingEdgeRevisionRatio = distances.length > 0
      ? distances.filter((d) => d <= this.options.leadingEdgeToleranceGraphemes).length / distances.length
      : null;

    // ---- typing-v3: adaptive pause threshold (see class doc) ----
    const pauseThresholdMode = this.options.pauseThresholdMode;
    let adaptiveBurstThresholdMs;
    let adaptiveBurstCount;
    let adaptiveActiveInputMs;
    if (pauseThresholdMode === 'adaptive') {
      // Derived from the COMPLETE interval series (`_adaptiveIntervals`,
      // never capped), so the adaptive figures describe the whole episode —
      // not a silently truncated `maxIntervals` prefix of it.
      adaptiveBurstThresholdMs = computeAdaptiveThreshold(this._adaptiveIntervals, this.options.burstThresholdMs);
      const adaptiveStats = computeBurstStats(
        this._adaptiveIntervals,
        adaptiveBurstThresholdMs,
        this._firstInputLatencyMs !== null,
      );
      adaptiveBurstCount = adaptiveStats.burstCount;
      adaptiveActiveInputMs = adaptiveStats.activeInputMs;
    }

    const window = {
      modality: MODALITY,
      window_kind: 'episode',
      feature_profile: FEATURE_PROFILE,
      window_start: new Date(this._startWallClock).toISOString(),
      window_end: new Date(this.options.now()).toISOString(),
      typing: {
        elapsed_ms: elapsedMs,
        // Sum of inter-edit intervals below burstThresholdMs only. This is a
        // lower-bound estimate of continuous active engagement — it does NOT
        // add a nominal per-keystroke dwell allowance on top, so it will
        // under-count true "hands on keys" time somewhat.
        active_input_ms: activeInputMs,
        first_input_latency_ms: this._firstInputLatencyMs,
        committed_graphemes: committedGraphemes,
        inserted_graphemes: insertedGraphemes,
        deleted_graphemes: deletedGraphemes,
        replacement_graphemes: this._replacementGraphemes,
        pasted_graphemes: this._pastedGraphemes,
        edit_event_count: this._editEventCount,
        composition_count: this._compositionCount,
        correction_count: this._correctionCount,
        revision_ratio: revisionRatio,
        production_rate_per_active_min: productionRatePerActiveMin,
        inter_event_intervals_ms: this._intervals,
        pause_histogram: this._pauseHistogram,
        burst_count: this._burstCount,
        submitted: reason === 'submitted',
        abandoned: reason === 'abandoned',
        // typing-v2: one entry per edit event that carried a known offset —
        // see the class doc comment. Positional REPLAY, not verbatim replay
        // (docs/TYPING.md).
        revision_locations: this._revisionLocations,

        // ---- typing-v3 ----
        edit_timestamps_ms: this._editTimestampsMs,
        p_burst_count: this._pBurstCount,
        r_burst_count: this._rBurstCount,
        p_burst_mean_graphemes: pBurstMeanGraphemes,
        r_burst_mean_graphemes: rBurstMeanGraphemes,
        mean_burst_graphemes: meanBurstGraphemes,
        mean_burst_words: meanBurstWords,
        revision_distance_mean: revisionDistanceMean,
        revision_distance_median: revisionDistanceMedian,
        leading_edge_revision_ratio: leadingEdgeRevisionRatio,
        chars_per_min: charsPerMin,
        chars_per_min_active: charsPerMinActive,
        words_per_min: wordsPerMin,
        words_per_min_active: wordsPerMinActive,
        produced_graphemes: producedGraphemes,
        product_ratio: productRatio,
        // Document length (graphemes/words) the episode found before its
        // first committed edit; null when the episode had no edits (graphemes)
        // or never carried word counts (words). `committed_graphemes -
        // baseline_graphemes` is the episode's net production — see class doc
        // "Episode baseline".
        baseline_graphemes: baselineGraphemes,
        baseline_words: this._sawWordCounts ? baselineWords : null,
        pause_location_counts: this._sawBoundaryContext ? { ...this._pauseLocationCounts } : null,
        ...(pauseThresholdMode === 'adaptive' ? {
          adaptive_burst_count: adaptiveBurstCount,
          adaptive_active_input_ms: adaptiveActiveInputMs,
        } : {}),
      },
      quality: {
        thresholds: {
          pause_buckets: this.options.pauseBuckets,
          burst_threshold_ms: this.options.burstThresholdMs,
          pause_threshold_mode: pauseThresholdMode,
          leading_edge_tolerance_graphemes: this.options.leadingEdgeToleranceGraphemes,
          ...(pauseThresholdMode === 'adaptive' ? {
            adaptive_burst_threshold_ms: adaptiveBurstThresholdMs,
            adaptive_rule: ADAPTIVE_RULE_ID,
          } : {}),
        },
        intervals_truncated: this._intervalsTruncated,
        // Sibling to `intervals_truncated`, not a reuse of it: the two arrays
        // are bounded by the same `maxIntervals` cap but can truncate at
        // different points (an episode can have far more/fewer positioned
        // edits than raw intervals, e.g. many caretOffset-less edits).
        revision_locations_truncated: this._revisionLocationsTruncated,
      },
    };

    if (this._target) window.target = this._target;

    this._reset();
    return window;
  }

  // ---- internal ----

  _accumulateInterval(interval) {
    if (interval < this.options.burstThresholdMs) {
      this._activeInputMs += interval;
    } else {
      // A pause at/above the burst threshold ends the current burst and
      // starts a new one.
      this._burstCount += 1;
    }
    const key = pauseBucketKey(interval, this.options.pauseBuckets, this._pauseHistogramKeys);
    this._pauseHistogram[key] += 1;
  }

  /**
   * Synthesize a `pause` event when the gap since the last event (of ANY
   * kind — see `record()`) reaches `burstThresholdMs`. The pause's own
   * `monotonic_ms` is the START of the gap (`_lastEventTimestamp`, i.e. the
   * moment the previous event finished), with `detail.duration_ms` carrying
   * the gap length — so `monotonic_ms + detail.duration_ms` recovers the
   * moment the triggering event fired.
   */
  _maybeEmitPause(timestamp) {
    if (this._lastEventTimestamp === null) return;
    // The gap before the FIRST edit is already reported as
    // `first_input_latency_ms`. Emitting a `pause` for it too would double-count
    // pre-writing deliberation and put a near-certain, information-free
    // `start -> pause` edge in every transition matrix.
    if (this._editEventCount === 0) return;
    const gap = timestamp - this._lastEventTimestamp;
    if (gap >= this.options.burstThresholdMs) {
      this._dispatchEvent('pause', this._lastEventTimestamp, { duration_ms: gap });
    }
  }

  /** Build and emit one edit/selection event's `detail`, then dispatch it. */
  _emitTypingEvent(state, { timestamp, caretOffset = null, selectionLength = null, lengthOverride, op, wallTimestamp = null }) {
    const detail = {
      offset: caretOffset,
      length: lengthOverride !== undefined
        ? lengthOverride
        : (Number.isFinite(selectionLength) ? selectionLength : null),
      op: op || STATE_TO_OP[state] || state,
    };
    this._dispatchEvent(state, timestamp, detail, wallTimestamp);
  }

  /** Hand one event object to `options.onEvent`, if configured. */
  _dispatchEvent(state, timestamp, detail, wallTimestamp = null) {
    if (typeof this.options.onEvent !== 'function') return;
    assertKnownState(state);
    const wallClockTimestamp = this._startWallClock + (timestamp - this._startTimestamp);
    this.options.onEvent({
      modality: MODALITY,
      state,
      source: EVENT_SOURCE,
      timestamp: wallClockTimestamp,
      monotonic_ms: timestamp,
      // typing-v3: best-available ABSOLUTE wall-clock time for this event —
      // the caller-supplied `wallTimestamp` (real `Date.now()`, taken by the
      // adapter at record() time) when available, else the same synthesized
      // value as `timestamp` above. `timestamp` / `monotonic_ms` are
      // unchanged for back-compat; this is purely additive.
      wall_ms: this._resolveWallMs(timestamp, wallTimestamp),
      detail,
    });
  }

  /** Bounded by the same `maxIntervals` cap as `inter_event_intervals_ms`. */
  _recordRevisionLocation(entry) {
    if (this._revisionLocations.length < this.options.maxIntervals) {
      this._revisionLocations.push(entry);
    } else {
      this._revisionLocationsTruncated = true;
    }
  }

  /**
   * typing-v3: resolve the best-available absolute wall-clock ms for a
   * monotonic `timestamp` — prefer a real caller-supplied `wallTimestamp`,
   * else synthesize from the episode's single `_startWallClock` anchor (the
   * same computation `_dispatchEvent` has always used for its `timestamp`
   * field).
   */
  _resolveWallMs(timestamp, wallTimestamp) {
    return Number.isFinite(wallTimestamp)
      ? wallTimestamp
      : this._startWallClock + (timestamp - this._startTimestamp);
  }

  /**
   * typing-v3: close the in-progress burst (if it has any production) and
   * fold its totals into the P- or R-burst counters. `kind` is `'p'`
   * (pause), `'r'` (revision), or `'trailing'` (episode end — grouped with
   * P, see class doc). A no-op when the current burst has no production
   * (e.g. two revisions with nothing typed between them, or an episode that
   * ends exactly on a closed burst).
   */
  _closeCurrentBurst(kind) {
    if (!this._currentBurst.hasProduction) return;
    const { graphemes, words } = this._currentBurst;
    if (kind === 'r') {
      this._rBurstCount += 1;
      this._rBurstGraphemesTotal += graphemes;
    } else {
      this._pBurstCount += 1;
      this._pBurstGraphemesTotal += graphemes;
    }
    if (this._sawWordCounts) this._burstWordsTotal += words;
    this._currentBurst = { graphemes: 0, words: 0, hasProduction: false };
  }

  _updateSelectionMemory(caretOffset, selectionLength) {
    if (caretOffset !== null && caretOffset !== undefined) this._lastCaretOffset = caretOffset;
    if (selectionLength !== null && selectionLength !== undefined) this._lastSelectionLength = selectionLength;
  }

  _reset() {
    this._started = false;
    this._startTimestamp = null;
    this._startWallClock = null;
    this._target = null;

    this._lastEditTimestamp = null;
    this._firstInputLatencyMs = null;

    this._intervals = [];
    // Adaptive-mode-only, UNCAPPED interval accumulator — see the class doc
    // "Adaptive pause threshold". Stays empty in fixed mode.
    this._adaptiveIntervals = [];
    this._intervalsTruncated = false;
    this._activeInputMs = 0;
    this._burstCount = 0;
    this._pauseHistogram = buildZeroedHistogram(this._pauseHistogramKeys);

    this._insertedGraphemes = 0;
    this._deletedGraphemes = 0;
    this._replacementGraphemes = 0;
    this._pastedGraphemes = 0;
    this._committedGraphemes = 0;
    this._editEventCount = 0;
    this._compositionCount = 0;
    this._correctionCount = 0;

    // typing-v2 state.
    this._lastEventTimestamp = null;
    this._lastCaretOffset = null;
    this._lastSelectionLength = 0;
    this._revisionLocations = [];
    this._revisionLocationsTruncated = false;

    // typing-v3 state.
    this._baselineGraphemes = null;
    this._baselineWords = null;
    this._editTimestampsMs = [];
    this._pBurstCount = 0;
    this._rBurstCount = 0;
    this._pBurstGraphemesTotal = 0;
    this._rBurstGraphemesTotal = 0;
    this._currentBurst = { graphemes: 0, words: 0, hasProduction: false };
    this._sawWordCounts = false;
    this._lastWordCount = null;
    this._burstWordsTotal = 0;
    this._sawBoundaryContext = false;
    this._pauseLocationCounts = { mid_word: 0, word_boundary: 0, sentence_boundary: 0, paragraph_boundary: 0 };
  }
}

/**
 * Derive the pause-histogram bucket keys from the configured upper bounds.
 * `[500, 1000, 2000, 5000]` -> `['lt_500_ms', '500_to_1000_ms',
 * '1000_to_2000_ms', '2000_to_5000_ms', 'gte_5000_ms']`.
 */
function buildPauseHistogramKeys(buckets) {
  const keys = [`lt_${buckets[0]}_ms`];
  for (let i = 1; i < buckets.length; i += 1) {
    keys.push(`${buckets[i - 1]}_to_${buckets[i]}_ms`);
  }
  keys.push(`gte_${buckets[buckets.length - 1]}_ms`);
  return keys;
}

function buildZeroedHistogram(keys) {
  const histogram = {};
  for (const key of keys) histogram[key] = 0;
  return histogram;
}

/** Which bucket key a given interval (ms) falls into. */
function pauseBucketKey(interval, buckets, keys) {
  for (let i = 0; i < buckets.length; i += 1) {
    if (interval < buckets[i]) return keys[i];
  }
  return keys[keys.length - 1];
}

function isPasteInputType(inputType) {
  return typeof inputType === 'string' && inputType.toLowerCase().includes('paste');
}

/**
 * State label for an edit-shaped `record()` call (i.e. `isEditSignal` was
 * true). Precedence, highest first: composition lifecycle > undo/redo >
 * paste > selection-replace > plain insert/delete. Composition and undo/redo
 * are checked first because they describe the MECHANISM of the edit, which a
 * caller cannot infer from the grapheme delta alone; paste is checked ahead
 * of `replace` because "pasted over a selection" is still fundamentally
 * a paste (the task spec grants `replace` precedence only over plain
 * insert/delete, not over paste — see docs/TYPING.md for the full writeup of
 * this precedence call).
 */
function resolveEditState({ compositionState, isUndo, isRedo, isPaste, isCorrection, replacedSelection, delta }) {
  if (compositionState === 'start') return 'compose';
  if (compositionState === 'end') return 'commit';
  if (isUndo) return 'undo';
  if (isRedo) return 'redo';
  if (isPaste) return 'paste';
  // Before `replace`: an accepted correction always replaces the flagged word,
  // so the generic replace branch would otherwise swallow it.
  if (isCorrection) return 'correct';
  if (replacedSelection) return 'replace';
  if (delta > 0) return 'insert';
  return 'delete';
}

/**
 * State label for a no-text-change `record()` call, derived from the
 * currently-reported `selectionLength` vs. the last-known one:
 *   - a non-empty selection right now -> `select` (covers both "just
 *     started selecting" and "extended/shrank an existing selection" —
 *     the spec text only calls out extension explicitly, but there is no
 *     separate state for "selection changed but stayed non-empty");
 *   - selection just went from non-empty to empty -> `deselect`;
 *   - otherwise (no selection before or now, caret simply moved, or no
 *     selection info was ever supplied) -> `move`.
 */
function resolveSelectionState(selectionLength, priorSelectionLength) {
  const current = Number.isFinite(selectionLength) ? selectionLength : 0;
  const prior = Number.isFinite(priorSelectionLength) ? priorSelectionLength : 0;
  if (current > 0) return 'select';
  if (prior > 0) return 'deselect';
  return 'move';
}

/**
 * Defensive check that every emitted state is a member of the closed,
 * versioned `OYON_TYPING_STATES` vocabulary (`src/version.js`,
 * `typing-states-v1`) — this class must never emit an ad-hoc label outside
 * that contract.
 */
function assertKnownState(state) {
  if (!OYON_TYPING_STATES.includes(state)) {
    throw new Error(`TypingAggregator: '${state}' is not a member of OYON_TYPING_STATES`);
  }
}

/**
 * typing-v3 adaptive pause threshold: 3x the writer's own median IKI — see
 * the class doc "Adaptive pause threshold" for the rationale. Falls back to
 * `fixedThresholdMs` when there is no (or a degenerate, all-zero) interval
 * distribution to derive from.
 */
function computeAdaptiveThreshold(intervals, fixedThresholdMs) {
  if (!intervals || intervals.length === 0) return fixedThresholdMs;
  const med = median(intervals);
  return med > 0 ? med * ADAPTIVE_PAUSE_MEDIAN_MULTIPLIER : fixedThresholdMs;
}

/**
 * Pure re-implementation of the `burst_count` / `active_input_ms` accounting
 * in `_accumulateInterval`, parameterized by threshold — used to compute the
 * typing-v3 adaptive-mode figures without touching the fixed-mode code path
 * (which must stay byte-identical in both modes; see class doc).
 */
function computeBurstStats(intervals, thresholdMs, hadFirstEdit) {
  let burstCount = hadFirstEdit ? 1 : 0;
  let activeInputMs = 0;
  for (const interval of intervals) {
    if (interval < thresholdMs) {
      activeInputMs += interval;
    } else {
      burstCount += 1;
    }
  }
  return { burstCount, activeInputMs };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
