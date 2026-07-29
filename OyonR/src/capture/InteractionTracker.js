/**
 * InteractionTracker — translates page-wide DOM events (pointer, click,
 * scroll, selection, focus, tab visibility) into `InteractionAggregator`-shaped
 * events, mirroring `TypingComposerAdapter`'s capture-side shape: an
 * injected-collaborators options object, an explicit `stop()`/`dispose()`
 * teardown, and listeners tracked as `[target, type, listener]` triples so
 * teardown is exactly symmetric with attachment.
 *
 * Scope discipline: unlike `TypingComposerAdapter` (scoped to one composer
 * element), this tracker is deliberately PAGE-WIDE — audio_text.md §4.9 calls
 * this out explicitly: pointer/scroll/click describe what the learner did
 * BETWEEN edits, and that only pairs with the AOI machinery in
 * `src/gaze/domAoi.js` (making mouse and gaze directly comparable streams) if
 * it covers the whole page, not one field. Every listener still attaches to
 * exactly `documentRef` or `windowRef` — never the bare global `document`/
 * `window` — so a host controls the lifetime and a test can inject fakes.
 *
 * `windowRef` does triple duty here, all deliberate:
 *   1. Viewport geometry (`innerWidth`/`innerHeight`) to normalize pointer/
 *      click coordinates into `[0, 1]`.
 *   2. Page-wide events that fire on `window`, not `document`: `scroll`
 *      (page scroll position), `focus`/`blur` (OS-level window focus, distinct
 *      from `tab_hidden`/`tab_visible`, which is browser-tab visibility via
 *      `document.visibilitychange`).
 *   3. `setTimeout`/`clearTimeout` for the idle timer and the throttled
 *      `selectionchange` flush — the same real methods a genuine `window`
 *      object already has, so production code needs no extra wiring; tests
 *      inject a fake `windowRef` with a controllable timer queue (see
 *      `tests/interaction-tracker.test.js`), the same idiom
 *      `GazeCalibrationDriver`/`TypingComposerAdapter` use via an explicit
 *      `setTimerFn`/`clearTimerFn` — reusing `windowRef` for it here instead
 *      of adding two more constructor options, since a real `window` already
 *      carries these methods.
 *
 * Pointer sampling is a LEADING-EDGE throttle, not a periodic tick:
 * `mousemove` fires at display refresh (~60-120Hz) and would dominate the
 * log, so a `pointer_move` event is emitted at most once every
 * `pointerSampleMs`, using the position of whichever `mousemove` happens to
 * cross that threshold. This is a PERFORMANCE parameter (recorded verbatim in
 * `quality.thresholds` on the aggregator's window) — never a privacy
 * throttle; see CLAUDE.md's data policy.
 *
 * Idle detection uses a real timer (via `windowRef.setTimeout`), reset on
 * every `mousemove` (not just the throttled samples — idle must reflect
 * every movement, not only the ones that happened to emit a sample). When the
 * timer fires uninterrupted for `idleThresholdMs`, exactly one `pointer_idle`
 * event is emitted; the timer is not rescheduled until movement resumes, so a
 * long idle stretch produces exactly one event, not a repeating one.
 *
 * AOI resolution (`aoiResolver(clientX, clientY)`) is called with raw
 * VIEWPORT PIXEL coordinates (`MouseEvent.clientX/clientY`), not the
 * normalized `[0, 1]` coordinates carried in the emitted `detail` — this
 * matches what `src/gaze/domAoi.js` natively works in (`getBoundingClientRect()`
 * pixel rects). `createElementAoiResolver()` below is the default
 * implementation, built on `elementToGazeAoi`/`domRectToGazeAoi` so pointer/
 * click AOI membership uses the EXACT SAME geometry (including any
 * `region`/`minSize` shrink) that `GazeAggregator` uses for gaze AOI
 * membership — that identity is the whole point (audio_text.md §4.9): mouse
 * and gaze become directly comparable streams only if they agree on what an
 * AOI's boundary actually is.
 */

import { elementToGazeAoi, domRectToGazeAoi } from '../gaze/domAoi.js';

const MODALITY = 'interaction';
const EVENT_SOURCE = 'user';

const DEFAULT_POINTER_SAMPLE_MS = 100;
const DEFAULT_IDLE_THRESHOLD_MS = 1500;
const DEFAULT_SCROLL_THRESHOLD_PX = 40;
// Trailing-edge throttle for `selectionchange`, mirroring
// `TypingComposerAdapter`'s `selectionChangeThrottleMs` (same default, same
// "coalesce a drag-select into one settled report" rationale). Not exposed as
// a top-level option in the task contract; still overridable for symmetry.
const DEFAULT_SELECTION_THROTTLE_MS = 200;

const INTERACTION_STATES = new Set([
  'pointer_move', 'pointer_idle', 'click', 'double_click',
  'scroll_down', 'scroll_up', 'select_text',
  'focus_gain', 'focus_loss', 'tab_hidden', 'tab_visible',
]);

export function createInteractionTracker(options = {}) {
  const {
    documentRef,
    windowRef,
    onEvent = null,
    now = defaultNow,
    pointerSampleMs = DEFAULT_POINTER_SAMPLE_MS,
    idleThresholdMs = DEFAULT_IDLE_THRESHOLD_MS,
    aoiResolver = null,
    scrollThresholdPx = DEFAULT_SCROLL_THRESHOLD_PX,
    selectionThrottleMs = DEFAULT_SELECTION_THROTTLE_MS,
  } = options;

  if (!documentRef) throw new Error('createInteractionTracker: documentRef is required');
  if (!windowRef) throw new Error('createInteractionTracker: windowRef is required');

  let active = false;
  let listeners = []; // [target, type, listener] — mirrors TypingComposerAdapter's teardown bookkeeping.

  // Pointer sampling / idle state.
  let lastPointerSampleAt = null; // clock reading (from `now()`) of the last EMITTED pointer_move.
  let idleTimerHandle = null;
  let lastNormX = null;
  let lastNormY = null;
  let lastAoi = null;

  // Scroll coalescing state.
  let baselineScrollY = 0;

  // Throttled selectionchange state.
  let selectionTimerHandle = null;

  // Tab-hidden span state (for callers who also feed events into
  // InteractionAggregator; the tracker itself does not compute hidden_ms —
  // that's InteractionAggregator's job — this tracker just reports the raw
  // tab_hidden/tab_visible transitions faithfully).

  function addListener(target, type, listener) {
    target.addEventListener(type, listener);
    listeners.push([target, type, listener]);
  }

  function removeAllListeners() {
    for (const [target, type, listener] of listeners) {
      target.removeEventListener(type, listener);
    }
    listeners = [];
  }

  function dispatch(state, detail, timestamp) {
    if (!INTERACTION_STATES.has(state)) {
      // Defensive: this tracker must never emit a label outside the closed,
      // versioned OYON_INTERACTION_STATES vocabulary (src/version.js).
      throw new Error(`InteractionTracker: '${state}' is not a known interaction state`);
    }
    if (typeof onEvent !== 'function') return;
    onEvent({ modality: MODALITY, state, source: EVENT_SOURCE, timestamp, detail });
  }

  function normalizePoint(clientX, clientY) {
    const width = Number.isFinite(windowRef.innerWidth) && windowRef.innerWidth > 0 ? windowRef.innerWidth : 1;
    const height = Number.isFinite(windowRef.innerHeight) && windowRef.innerHeight > 0 ? windowRef.innerHeight : 1;
    return { x: clamp01(clientX / width), y: clamp01(clientY / height) };
  }

  function resolveAoi(clientX, clientY) {
    if (typeof aoiResolver !== 'function') return null;
    const id = aoiResolver(clientX, clientY);
    return typeof id === 'string' ? id : null;
  }

  // ---- pointer sampling + idle ----

  function scheduleIdleTimer() {
    clearIdleTimer();
    idleTimerHandle = windowRef.setTimeout(handleIdleTimeout, idleThresholdMs);
  }

  function clearIdleTimer() {
    if (idleTimerHandle !== null) {
      windowRef.clearTimeout(idleTimerHandle);
      idleTimerHandle = null;
    }
  }

  function handleIdleTimeout() {
    idleTimerHandle = null;
    if (!active) return;
    dispatch('pointer_idle', { idle_ms: idleThresholdMs, x: lastNormX, y: lastNormY, aoi: lastAoi }, now());
    // Deliberately NOT rescheduled here — the timer only resumes on the next
    // `mousemove`, which is what makes this "emitted once per idle stretch,
    // not repeatedly".
  }

  function handleMouseMove(event) {
    if (!active) return;
    scheduleIdleTimer(); // every movement resets idle tracking, independent of the sample throttle below.

    const nowMs = now();
    if (lastPointerSampleAt !== null && nowMs - lastPointerSampleAt < pointerSampleMs) return;
    lastPointerSampleAt = nowMs;

    const clientX = event.clientX;
    const clientY = event.clientY;
    const { x, y } = normalizePoint(clientX, clientY);
    const aoi = resolveAoi(clientX, clientY);
    lastNormX = x;
    lastNormY = y;
    lastAoi = aoi;
    dispatch('pointer_move', { x, y, aoi }, nowMs);
  }

  // ---- click / double_click ----

  function emitClickLike(state, event) {
    if (!active) return;
    const clientX = event.clientX;
    const clientY = event.clientY;
    const { x, y } = normalizePoint(clientX, clientY);
    const aoi = resolveAoi(clientX, clientY);
    dispatch(state, { x, y, aoi, button: Number.isFinite(event.button) ? event.button : 0 }, now());
  }

  function handleClick(event) {
    emitClickLike('click', event);
  }

  function handleDoubleClick(event) {
    emitClickLike('double_click', event);
  }

  // ---- scroll ----

  function readScrollY() {
    return Number.isFinite(windowRef.scrollY) ? windowRef.scrollY : 0;
  }

  function computeDepthRatio(scrollY) {
    const scrollHeight = Number.isFinite(documentRef.documentElement?.scrollHeight)
      ? documentRef.documentElement.scrollHeight
      : 0;
    const viewportHeight = Number.isFinite(windowRef.innerHeight) ? windowRef.innerHeight : 0;
    const maxScrollable = scrollHeight - viewportHeight;
    if (maxScrollable <= 0) return 0;
    return clamp01(scrollY / maxScrollable);
  }

  function handleScroll() {
    if (!active) return;
    const currentScrollY = readScrollY();
    const delta = currentScrollY - baselineScrollY;
    if (Math.abs(delta) < scrollThresholdPx) return;
    const state = delta > 0 ? 'scroll_down' : 'scroll_up';
    dispatch(state, { delta_px: Math.abs(delta), depth_ratio: computeDepthRatio(currentScrollY) }, now());
    baselineScrollY = currentScrollY;
  }

  // ---- selection (throttled, trailing edge) ----

  function flushSelectionChange() {
    selectionTimerHandle = null;
    if (!active) return;
    const selection = typeof documentRef.getSelection === 'function' ? documentRef.getSelection() : null;
    // Read the selection ONLY to measure its length; the string itself is
    // discarded within this call and never retained, logged, or emitted —
    // same discipline as TypingComposerAdapter's grapheme/word counting.
    const length = selection ? String(selection).length : 0;
    if (length <= 0) return; // nothing to report — 'select_text' means a non-empty selection exists.
    dispatch('select_text', { length }, now());
  }

  function handleSelectionChange() {
    if (!active) return;
    if (selectionTimerHandle !== null) return; // already scheduled — trailing edge reads live state at fire time.
    selectionTimerHandle = windowRef.setTimeout(flushSelectionChange, selectionThrottleMs);
  }

  // ---- focus / visibility ----

  function handleFocus() {
    if (!active) return;
    dispatch('focus_gain', null, now());
  }

  function handleBlur() {
    if (!active) return;
    dispatch('focus_loss', null, now());
  }

  function handleVisibilityChange() {
    if (!active) return;
    const hidden = documentRef.hidden === true || documentRef.visibilityState === 'hidden';
    dispatch(hidden ? 'tab_hidden' : 'tab_visible', null, now());
  }

  // ---- lifecycle ----

  function start() {
    if (active) return; // idempotent — do not double-attach.
    active = true;
    lastPointerSampleAt = null;
    lastNormX = null;
    lastNormY = null;
    lastAoi = null;
    baselineScrollY = readScrollY();

    addListener(documentRef, 'mousemove', handleMouseMove);
    addListener(documentRef, 'click', handleClick);
    addListener(documentRef, 'dblclick', handleDoubleClick);
    addListener(documentRef, 'selectionchange', handleSelectionChange);
    addListener(documentRef, 'visibilitychange', handleVisibilityChange);
    addListener(windowRef, 'scroll', handleScroll);
    addListener(windowRef, 'focus', handleFocus);
    addListener(windowRef, 'blur', handleBlur);

    scheduleIdleTimer();
  }

  function stop() {
    if (!active) return;
    active = false;
    clearIdleTimer();
    if (selectionTimerHandle !== null) {
      windowRef.clearTimeout(selectionTimerHandle);
      selectionTimerHandle = null;
    }
    removeAllListeners();
  }

  function dispose() {
    // Safe to call twice, and safe after stop() — same idempotent teardown.
    stop();
  }

  return {
    start,
    stop,
    dispose,
    get active() { return active; },
  };
}

/**
 * Default AOI resolver factory: given a list of `{ id, element, region?,
 * minSize? }` entries, returns a `(clientX, clientY) => aoiId | null`
 * function built on `elementToGazeAoi`/`domRectToGazeAoi`
 * (`src/gaze/domAoi.js`) — the SAME geometry (including any `region`/
 * `minSize` shrink) `GazeAggregator` uses for gaze AOI membership, so pointer
 * dwell/clicks and gaze fixations agree on what an AOI's boundary is.
 *
 * Implementation note: `elementToGazeAoi` converts a DOM rect into Oyon's
 * gaze coordinate space (`[-0.5, 0.5]`, origin at screen centre — see
 * `domAoi.js`). To test a raw viewport-pixel point (`clientX`/`clientY`,
 * matching `MouseEvent`) for membership in that space, this resolver converts
 * the POINT into the same space too, via `domRectToGazeAoi` on a degenerate
 * 1x1-pixel "rect" at the point — reusing the exact same screen/chrome
 * geometry math `elementToGazeAoi` uses internally, rather than re-deriving
 * it. `elements` is checked in array order; the first matching AOI wins
 * (mirrors `GazeAggregator`'s `matchingAoiId`), so list the more specific/
 * smaller regions first when AOIs overlap.
 *
 * `options.windowRef` overrides which `window` supplies viewport/screen
 * geometry; defaults to each element's own `ownerDocument.defaultView` (the
 * same default `elementToGazeAoi` uses).
 */
export function createElementAoiResolver(elements, options = {}) {
  const entries = Array.isArray(elements) ? elements : [];
  const { windowRef: overrideWindowRef = null } = options;

  return function resolveAoi(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;

    for (const entry of entries) {
      if (!entry || !entry.element || typeof entry.id !== 'string') continue;
      const aoi = elementToGazeAoi(entry.element, { id: entry.id, region: entry.region, minSize: entry.minSize });
      if (!aoi) continue;

      const view = overrideWindowRef || entry.element.ownerDocument?.defaultView;
      if (!view) continue;
      const environment = readGazeEnvironment(view);
      const point = domRectToGazeAoi({ left: clientX, top: clientY, width: 1, height: 1 }, environment, { id: aoi.id });
      if (!point) continue;

      if (
        point.x >= aoi.x && point.x < aoi.x + aoi.width
        && point.y >= aoi.y && point.y < aoi.y + aoi.height
      ) {
        return aoi.id;
      }
    }
    return null;
  };
}

/** Mirrors `elementToGazeAoi`'s internal environment construction (`src/gaze/domAoi.js`). */
function readGazeEnvironment(view) {
  const screen = view.screen;
  return {
    innerWidth: view.innerWidth,
    innerHeight: view.innerHeight,
    screenX: view.screenX,
    screenY: view.screenY,
    outerWidth: view.outerWidth,
    outerHeight: view.outerHeight,
    screenWidth: screen?.width,
    screenHeight: screen?.height,
  };
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function defaultNow() {
  return Date.now();
}
