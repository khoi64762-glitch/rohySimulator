// Type declarations for the Oyon interaction subpath.
// Hand-written; consult JSDoc and the source modules
// (`src/capture/InteractionTracker.js`, `src/aggregation/InteractionAggregator.js`)
// for authoritative shapes. See docs/INTERACTION.md and audio_text.md §4.9.

/**
 * Per-event state label, drawn from `OYON_INTERACTION_STATES`
 * (`interaction-states-v1`, `src/version.js`). Mirrored here rather than
 * imported because `types/version.d.ts` does not (yet) declare
 * `OYON_INTERACTION_STATES` — if the vocabulary changes, update
 * `src/version.js` first and mirror the change here; this file must never
 * define states of its own.
 */
export type InteractionStateLabel =
  | 'pointer_move'
  | 'pointer_idle'
  | 'click'
  | 'double_click'
  | 'scroll_down'
  | 'scroll_up'
  | 'select_text'
  | 'focus_gain'
  | 'focus_loss'
  | 'tab_hidden'
  | 'tab_visible';

/** `detail` shape for `pointer_move` — normalized `[0, 1]` viewport coordinates. */
export interface InteractionPointerMoveDetail {
  /** Normalized viewport x, `0` (left edge) to `1` (right edge). */
  x: number;
  /** Normalized viewport y, `0` (top edge) to `1` (bottom edge). */
  y: number;
  /** AOI id from `aoiResolver`, or `null` when unresolved/no resolver configured. */
  aoi: string | null;
}

/** `detail` shape for a synthesized `pointer_idle` event — the LAST known position before the idle stretch began. */
export interface InteractionPointerIdleDetail {
  /** The `idleThresholdMs` that triggered this event. */
  idle_ms: number;
  x: number | null;
  y: number | null;
  aoi: string | null;
}

/** `detail` shape for `click` / `double_click`. */
export interface InteractionClickDetail {
  x: number;
  y: number;
  aoi: string | null;
  /** `MouseEvent.button`: `0` left, `1` middle, `2` right. */
  button: number;
}

/** `detail` shape for `scroll_down` / `scroll_up`. */
export interface InteractionScrollDetail {
  /** Magnitude (always `>= 0`) of the coalesced scroll since the last emitted scroll event. */
  delta_px: number;
  /** Scroll position as a fraction of scrollable height, `0`-`1`. */
  depth_ratio: number;
}

/** `detail` shape for `select_text` — LENGTH only, never the selected text. */
export interface InteractionSelectTextDetail {
  length: number;
}

export type InteractionEventDetail =
  | InteractionPointerMoveDetail
  | InteractionPointerIdleDetail
  | InteractionClickDetail
  | InteractionScrollDetail
  | InteractionSelectTextDetail
  | null;

/**
 * One event `InteractionTracker` hands to `options.onEvent`. Shape matches
 * `SignalEventLog.record()`'s input (`modality`/`state`/`source`/`timestamp`/
 * `detail`) so a caller can pass it straight through.
 */
export interface InteractionEvent {
  modality: 'interaction';
  state: InteractionStateLabel;
  source: 'user';
  /** Wall-clock ms from the tracker's `now()` (default `Date.now()`). */
  timestamp: number;
  detail: InteractionEventDetail;
}

/** `documentRef`/`windowRef` event-target shape every `InteractionTracker` listener attaches to. */
export interface InteractionEventTarget {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

/**
 * `documentRef` shape — a `Document` satisfies this. `getSelection()` backs
 * `select_text`'s length measurement (the string itself is read only
 * transiently, never retained/emitted); `hidden`/`visibilityState` back
 * `tab_hidden`/`tab_visible`; `documentElement.scrollHeight` backs scroll
 * `depth_ratio`.
 */
export interface InteractionDocumentRef extends InteractionEventTarget {
  hidden?: boolean;
  visibilityState?: string;
  getSelection?: () => { toString(): string } | null;
  documentElement?: { scrollHeight?: number };
}

/**
 * `windowRef` shape — a `Window` satisfies this. Supplies viewport geometry
 * (coordinate normalization), scroll position, `focus`/`blur` (OS-level
 * window focus, distinct from `tab_hidden`/`tab_visible`), and
 * `setTimeout`/`clearTimeout` for the idle timer and the throttled
 * `selectionchange` flush — see `InteractionTracker`'s class doc for why
 * `windowRef` (not a separate timer-injection option) carries the timers.
 */
export interface InteractionWindowRef extends InteractionEventTarget {
  innerWidth?: number;
  innerHeight?: number;
  scrollY?: number;
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * `(clientX, clientY)` viewport-PIXEL coordinates (matching
 * `MouseEvent.clientX/clientY`, and what `src/gaze/domAoi.js` natively works
 * in) -> an AOI id, or `null` when the point resolves to no AOI. Passed
 * unmodified to `aoiResolver` for both `pointer_move` and `click`/
 * `double_click` — NOT the normalized `[0, 1]` coordinates carried in the
 * emitted event `detail`.
 */
export type InteractionAoiResolver = (clientX: number, clientY: number) => string | null;

export interface InteractionTrackerOptions {
  /** The page document. Required. */
  documentRef: InteractionDocumentRef;
  /** The page window. Required — see `InteractionWindowRef` for why it carries more than events. */
  windowRef: InteractionWindowRef;
  /** Called with every emitted `InteractionEvent`. `null`/omitted means "emit nothing". */
  onEvent?: ((event: InteractionEvent) => void) | null;
  /** Wall clock used to stamp every emitted event's `timestamp`. Default `Date.now()`. */
  now?: () => number;
  /**
   * Leading-edge throttle (ms) on `pointer_move` emission — a PERFORMANCE
   * parameter (recorded in `quality.thresholds` on the aggregator's window),
   * never a privacy throttle. Default `100`.
   */
  pointerSampleMs?: number;
  /** No `mousemove` for this long (ms) synthesizes exactly one `pointer_idle`. Default `1500`. */
  idleThresholdMs?: number;
  /** AOI resolver for `pointer_move`/`click`/`double_click`. Default `null` (no AOI resolution). */
  aoiResolver?: InteractionAoiResolver | null;
  /** Cumulative scroll (px) since the last emitted scroll event required to emit another. Default `40`. */
  scrollThresholdPx?: number;
  /** Trailing-edge throttle (ms) for the `selectionchange` listener. Default `200`. */
  selectionThrottleMs?: number;
}

export interface InteractionTracker {
  /** Attach listeners and begin tracking. Idempotent while already active. */
  start(): void;
  /** Detach listeners. Safe to call twice, and safe after `dispose()`. */
  stop(): void;
  /** Detach listeners. Alias of `stop()` — both are idempotent teardown. */
  dispose(): void;
  readonly active: boolean;
}

/**
 * Translate page-wide DOM events (pointer, click, scroll, selection, focus,
 * tab visibility) into `InteractionEvent`s. Attaches listeners to exactly
 * `documentRef`/`windowRef` — never the bare global `document`/`window`.
 */
export function createInteractionTracker(options: InteractionTrackerOptions): InteractionTracker;

/** One entry for `createElementAoiResolver` — a named DOM element AOI, mirroring `DomAoiOptions` in `types/gaze-aoi.d.ts`. */
export interface InteractionAoiElementEntry {
  id: string;
  element: Element;
  region?: { left: number; top: number; width: number; height: number };
  minSize?: number;
}

export interface InteractionAoiResolverOptions {
  /** Overrides which `window` supplies viewport/screen geometry. Default: each element's own `ownerDocument.defaultView`. */
  windowRef?: InteractionWindowRef | null;
}

/**
 * Default AOI resolver factory: builds a `(clientX, clientY) => aoiId | null`
 * resolver from `elementToGazeAoi`/`domRectToGazeAoi` (`src/gaze/domAoi.js`)
 * so pointer/click AOI membership uses the SAME geometry `GazeAggregator`
 * uses for gaze AOI membership. `elements` is checked in array order; the
 * first matching AOI wins.
 */
export function createElementAoiResolver(
  elements: InteractionAoiElementEntry[],
  options?: InteractionAoiResolverOptions,
): InteractionAoiResolver;

/**
 * The `interaction` block of an `interaction-v1` window
 * (`InteractionAggregator.finalize()`). `selection_mean_length` is `null`
 * (not `0`) when `selection_count` is `0` — "never measured" stays
 * distinguishable from "measured as zero", mirroring `typing`/`ai_assist`'s
 * convention.
 */
export interface InteractionMetrics {
  /** Summed normalized (`[0, 1]` coordinate space) Euclidean distance across consecutive `pointer_move` samples. */
  pointer_path_length: number;
  /** Count of `pointer_move` events recorded. */
  pointer_sample_count: number;
  /** Sum of every `pointer_idle` event's `detail.idle_ms`. */
  idle_ms: number;
  /** `idle_ms / (window_end - window_start)`, clamped to `[0, 1]`; `0` for a zero-duration window. */
  idle_ratio: number;
  click_count: number;
  double_click_count: number;
  /** `scroll_down` + `scroll_up` event count. */
  scroll_events: number;
  /** Maximum `detail.depth_ratio` observed across scroll events; `0` if none occurred. */
  scroll_depth_max: number;
  /** Count of direction changes between consecutive scroll events (`scroll_down` <-> `scroll_up`). */
  scroll_reversals: number;
  /** Count of `select_text` events. */
  selection_count: number;
  /** Mean of `detail.length` across `select_text` events; `null` if `selection_count` is `0`. */
  selection_mean_length: number | null;
  /** Count of `focus_loss` events. */
  focus_loss_count: number;
  /** Total ms spent tab-hidden (`tab_hidden` -> `tab_visible` span, or -> window end if still hidden). */
  hidden_ms: number;
  /** AOI id -> ms dwelled, attributed from consecutive `pointer_move` sample gaps (see `InteractionAggregator`'s class doc). */
  aoi_dwell_ms: Record<string, number>;
  /** AOI id -> click count (`click` + `double_click`, keyed by `detail.aoi`). */
  aoi_click_counts: Record<string, number>;
}

export interface InteractionQualityThresholds {
  /** The `pointerSampleMs` in effect. */
  pointer_sample_ms: number;
  /** The `idleThresholdMs` in effect. */
  idle_threshold_ms: number;
  /** The `scrollThresholdPx` in effect. */
  scroll_threshold_px: number;
  /** The AOI-dwell gap-interruption limit in effect (see `InteractionAggregator`'s class doc). */
  max_sample_gap_ms: number;
}

export interface InteractionQuality {
  thresholds: InteractionQualityThresholds;
}

/**
 * One `interaction-v1` interval window, returned by
 * `InteractionAggregator.finalize()`.
 */
export interface InteractionWindow {
  modality: 'interaction';
  window_kind: 'interval';
  feature_profile: 'interaction-v1';
  window_start: string;
  window_end: string;
  interaction: InteractionMetrics;
  quality: InteractionQuality;
}

export interface InteractionAggregatorOptions {
  /** Wall clock; defaults `start()`/`finalize()`'s `timestamp` when omitted. Default `() => Date.now()`. */
  now?: () => number;
  /** Recorded verbatim into `quality.thresholds.pointer_sample_ms`. Default `100`. */
  pointerSampleMs?: number;
  /** Recorded verbatim into `quality.thresholds.idle_threshold_ms`. Default `1500`. */
  idleThresholdMs?: number;
  /** Recorded verbatim into `quality.thresholds.scroll_threshold_px`. Default `40`. */
  scrollThresholdPx?: number;
  /** AOI-dwell gap-interruption limit (ms). Default `max(500, pointerSampleMs * 4)`. */
  maxSampleGapMs?: number;
}

export interface InteractionStartArgs {
  /** Same clock `event.timestamp` values use. Defaults to `options.now()` when omitted. */
  timestamp?: number;
}

export interface InteractionFinalizeArgs {
  /** Same clock `event.timestamp` values use. Defaults to `options.now()` when omitted. */
  timestamp?: number;
}

/**
 * Aggregates one interaction window from `InteractionEvent`s. Pure: no DOM,
 * no timers — all timing comes in as `event.timestamp` / the `start`/
 * `finalize` `timestamp` argument.
 */
export class InteractionAggregator {
  constructor(options?: InteractionAggregatorOptions);
  options: Required<InteractionAggregatorOptions>;
  /** True while a window is in progress (between `start()` and `finalize()`). */
  readonly active: boolean;
  /** Begin a new interaction window. Discards any prior unfinished one. */
  start(args?: InteractionStartArgs): void;
  /** Consume one `InteractionEvent`. No-op (and never throws) when not active; throws on an unknown `state`. */
  record(event: InteractionEvent): void;
  /** End the window and return it. Returns `null` when there was no active window. */
  finalize(args?: InteractionFinalizeArgs): InteractionWindow | null;
}
