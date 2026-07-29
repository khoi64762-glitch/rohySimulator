// Type declarations for the Oyon ai_assist subpath.
// Hand-written; consult JSDoc and the source modules
// (`src/capture/AiAssistTracker.js`, `src/aggregation/AiAssistAggregator.js`)
// for authoritative shapes. See docs/AI_ASSIST.md and audio_text.md §4.10/§3.6.

/**
 * Per-event state label, drawn from `OYON_AI_ASSIST_STATES`
 * (`ai-assist-states-v1`, `src/version.js`). Mirrored here rather than
 * imported because `types/version.d.ts` does not (yet) declare
 * `OYON_AI_ASSIST_STATES` — if the vocabulary changes, update
 * `src/version.js` first and mirror the change here; this file must never
 * define states of its own.
 */
export type AiAssistStateLabel =
  | 'suggestion_request'
  | 'suggestion_shown'
  | 'suggestion_accept'
  | 'suggestion_reject'
  | 'suggestion_dismiss'
  | 'ai_turn_start'
  | 'ai_turn_end';

/**
 * `detail` shape for a `suggestion_request` event. Never carries the
 * suggestion text itself — see `AiAssistTracker`'s class doc.
 */
export interface AiAssistRequestDetail {
  suggestion_id: string | null;
  model: string | null;
}

/** `detail` shape for a `suggestion_shown` event. */
export interface AiAssistShownDetail {
  suggestion_id: string | null;
  options_shown: number | null;
  /**
   * Measured by `AiAssistTracker` itself (request -> shown, on the monotonic
   * clock), not supplied by the host. `null` when there was no matching
   * `requested()` call for this `suggestion_id` — never a throw.
   */
  latency_ms: number | null;
  model: string | null;
}

/** `detail` shape for a `suggestion_accept` event — a LEARNER decision. */
export interface AiAssistAcceptDetail {
  suggestion_id: string | null;
  chosen_index: number | null;
  /** Grapheme-cluster length of what the learner accepted. */
  accepted_graphemes: number | null;
  model: string | null;
}

/** `detail` shape for a `suggestion_reject` event — a LEARNER decision. */
export interface AiAssistRejectDetail {
  suggestion_id: string | null;
  chosen_index: number | null;
  model: string | null;
}

/** `detail` shape for a `suggestion_dismiss` event — a LEARNER decision. */
export interface AiAssistDismissDetail {
  suggestion_id: string | null;
  model: string | null;
}

/** `detail` shape for an `ai_turn_start` / `ai_turn_end` event. */
export interface AiAssistTurnDetail {
  model: string | null;
}

export type AiAssistEventDetail =
  | AiAssistRequestDetail
  | AiAssistShownDetail
  | AiAssistAcceptDetail
  | AiAssistRejectDetail
  | AiAssistDismissDetail
  | AiAssistTurnDetail;

/**
 * One event object handed to `AiAssistTracker`'s `onEvent` callback (and
 * consumed by `AiAssistAggregator.record()`). `source` is `'ai'` for
 * `suggestion_request` / `suggestion_shown` / `ai_turn_start` / `ai_turn_end`
 * (the AI pipeline's own activity) and `'user'` for `suggestion_accept` /
 * `suggestion_reject` / `suggestion_dismiss` (the learner's decision about a
 * suggestion the AI already produced) — see `AiAssistTracker`'s class doc
 * for the full rationale.
 */
export interface AiAssistEvent {
  modality: 'ai_assist';
  state: AiAssistStateLabel;
  source: 'ai' | 'user';
  /** Wall-clock ms (`Date.now()`-epoch), via `options.wallClockNow()`. */
  timestamp: number;
  /** Monotonic ms, via `options.now()` — the same clock latency/duration math is done on. */
  monotonic_ms: number;
  detail: AiAssistEventDetail;
}

/**
 * A descriptor passed to one of `AiAssistTracker`'s methods. Every field is
 * optional (defaults to `null`); a descriptor MUST NOT carry `text`,
 * `content`, `suggestion`, or `body` — any of those throws, naming the
 * offending field, because the host already stores the suggestion text
 * (a redundancy rule, not a privacy rule — see CLAUDE.md).
 */
export interface AiAssistDescriptor {
  /** Host-supplied opaque id correlating `requested()`/`shown()`/`accepted()`/`rejected()`/`dismissed()` calls for one suggestion. */
  suggestion_id?: string | null;
  /** `shown()` only: how many suggestion options were offered. */
  options_shown?: number | null;
  /** `accepted()`/`rejected()` only: which offered option (0-based) was involved, if any. */
  chosen_index?: number | null;
  /** `accepted()` only: grapheme-cluster length of what was inserted. */
  accepted_graphemes?: number | null;
  /** Short model identifier, e.g. `'gpt-4o-mini'`. */
  model?: string | null;
  // Forbidden — see class doc. Declared here only so TypeScript flags the
  // mistake at the call site rather than only at runtime.
  text?: never;
  content?: never;
  suggestion?: never;
  body?: never;
}

export interface AiAssistTrackerOptions {
  /** Per-event sink. `null`/omitted (default) means "emit nothing" — every method still runs its bookkeeping and returns the event. */
  onEvent?: ((event: AiAssistEvent) => void) | null;
  /** Monotonic clock, used for `monotonic_ms` and for measuring `latency_ms`. Default: `performance.now()`, falling back to `Date.now()`. */
  now?: () => number;
  /** Wall clock, used for `timestamp`. Default: the real `Date.now`. */
  wallClockNow?: () => number;
  /** Cap on the `requested()` -> `shown()` correlation map (transport/memory bound, not a privacy measure). Default 1000. */
  maxPendingRequests?: number;
}

/**
 * Host-facing emitter for the AI-suggestion cycle. NOT a DOM listener — the
 * host calls these methods at the points in its own code where it asks the
 * AI for a suggestion, renders the result, and observes what the learner did
 * with it. See docs/AI_ASSIST.md.
 */
export interface AiAssistTracker {
  /** The host asked the AI for a suggestion. Starts the request->shown latency clock for `suggestion_id`. */
  requested(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** The AI's suggestion(s) were rendered to the learner. */
  shown(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** The learner accepted a suggestion. */
  accepted(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** The learner explicitly rejected a suggestion. */
  rejected(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** The learner dismissed a suggestion without engaging it. */
  dismissed(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** An AI conversational turn began. */
  aiTurnStart(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** An AI conversational turn ended. */
  aiTurnEnd(descriptor?: AiAssistDescriptor): AiAssistEvent | null;
  /** Stop emitting. Idempotent. Does not finalize anything. */
  dispose(): void;
  /** `false` after `dispose()`. */
  readonly active: boolean;
}

/** Create a host-facing `AiAssistTracker`. See docs/AI_ASSIST.md for the full integration recipe. */
export function createAiAssistTracker(options?: AiAssistTrackerOptions): AiAssistTracker;

/**
 * Map of 0-based `chosen_index` -> acceptance count, tallied ONLY from
 * `suggestion_accept` events — shows whether writers favour the first
 * offered option. Keys are the stringified index.
 */
export type AiAssistChosenIndexCounts = Record<string, number>;

/**
 * The `ai_assist` block of an `ai-assist-v1` window, returned by
 * `AiAssistAggregator.finalize()`. Every rate/mean field is `null` (never
 * `0`) when its denominator was 0 — "never measured" stays distinguishable
 * from "measured as zero".
 */
export interface AiAssistMetrics {
  request_count: number;
  shown_count: number;
  accept_count: number;
  reject_count: number;
  dismiss_count: number;
  /** `accept_count / shown_count`, or `null` when `shown_count` is 0. */
  acceptance_rate: number | null;
  /** Mean of every `suggestion_shown` event's measured `latency_ms`, or `null` when none were measured. */
  mean_latency_ms: number | null;
  /** Median of the same series, or `null` when none were measured. */
  median_latency_ms: number | null;
  /** Sum of `accepted_graphemes` across every `suggestion_accept` event. */
  accepted_graphemes_total: number;
  /** `accepted_graphemes_total / accept_count`, or `null` when `accept_count` is 0. */
  mean_accepted_graphemes: number | null;
  /** Count of `ai_turn_start` events. */
  ai_turn_count: number;
  /** Sum of every closed AI turn's duration, in ms (see `AiAssistAggregator` class doc for the pairing/closing rule). */
  ai_turn_total_ms: number;
  chosen_index_counts: AiAssistChosenIndexCounts;
  /**
   * Equal to `accepted_graphemes_total` — the headline authorship figure.
   * Combine with a `typing` window's `committed_graphemes` to compute the
   * human-vs-AI authorship split (see docs/AI_ASSIST.md, "Authorship split").
   */
  ai_authored_graphemes: number;
}

export interface AiAssistQuality {
  /** Count of `suggestion_shown` events with no matching `requested()` (so `latency_ms` was `null` for them). */
  unmatched_shown_count: number;
  /** Count of `ai_turn_end` events with no open `ai_turn_start` to close. */
  unmatched_turn_end_count: number;
  /** Count of AI turns still open at `finalize()`, closed synthetically against the finalize timestamp. */
  open_ai_turns_closed_at_finalize: number;
  /** `true` when `chosen_index_counts` was capped at `options.maxChosenIndexKeys` distinct indices. */
  chosen_index_counts_truncated: boolean;
}

/** Identifies which host-registered target (e.g. a composer) produced the window, when supplied to `start()`. */
export interface AiAssistTarget {
  kind: string | null;
  id: string | null;
}

export interface AiAssistWindow {
  modality: 'ai_assist';
  window_kind: 'interval';
  feature_profile: 'ai-assist-v1';
  window_start: string;
  window_end: string;
  ai_assist: AiAssistMetrics;
  quality: AiAssistQuality;
  target?: AiAssistTarget;
}

export interface AiAssistAggregatorOptions {
  /** Wall clock, used only to stamp `window_start`/`window_end`. Default `() => Date.now()`. */
  now?: () => number;
  /** Cap on distinct `chosen_index_counts` keys (transport bound). Default 64. */
  maxChosenIndexKeys?: number;
}

export interface AiAssistStartArgs {
  /** Monotonic ms marking the start of the window. */
  timestamp: number;
  targetKind?: string | null;
  targetId?: string | null;
}

export interface AiAssistFinalizeArgs {
  /** Monotonic ms marking the end of the window; also closes any still-open AI turn. */
  timestamp: number;
}

/**
 * Aggregates the `AiAssistTracker` event stream into an `ai-assist-v1`
 * window. Pure: no DOM, no timers, no globals — all timing is passed in as
 * arguments (`options.now()` stamps only the ISO window bounds).
 */
export class AiAssistAggregator {
  constructor(options?: AiAssistAggregatorOptions);
  options: Required<AiAssistAggregatorOptions>;
  /** True while a window is in progress (between `start()` and `finalize()`). */
  readonly active: boolean;
  /** Begin a new aggregation window. Discards any prior unfinished window. */
  start(args: AiAssistStartArgs): void;
  /** Consume one event from `AiAssistTracker`. No-op when not active. */
  record(event: AiAssistEvent): void;
  /** End the window and return it, or `null` when there was none. */
  finalize(args: AiAssistFinalizeArgs): AiAssistWindow | null;
}
