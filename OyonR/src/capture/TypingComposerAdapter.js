/**
 * TypingComposerAdapter — translates DOM input events on ONE host-designated
 * `<input>`/`<textarea>` into `TypingAggregator` calls.
 *
 * This is the capture-side boundary for the typing/composer signal, mirroring
 * `CameraController`'s shape: an injected-collaborators options object, an
 * explicit `stop()`-equivalent (`dispose()`), and no globals reached for
 * directly — `documentRef` comes through options so tests can inject a fake.
 *
 * Scope discipline: this adapter attaches listeners to exactly the element it
 * is given, plus `visibilitychange` and (throttled) `selectionchange` on the
 * provided document — the latter filtered to `documentRef.activeElement ===
 * element`, so a selection made in some other field on the page never reaches
 * this adapter's aggregator. It must never install a page-wide listener
 * (e.g. on `window` or the bare global `document`) — a host may run several
 * composers at once and each gets its own adapter instance.
 *
 * `selectionchange` (typing-v2) exists to capture selection made WITHOUT any
 * edit — re-reading a passage by selecting it is a real writing-process
 * behaviour that otherwise produces no signal at all. It is throttled
 * (trailing edge) because it fires continuously while the user drags a
 * selection; see `selectionChangeThrottleMs`.
 *
 * Enrichment (word counts, boundary context, wall timestamp): like grapheme
 * counting, word counting reads `element.value` transiently — one pass per
 * event, nothing retained, nothing logged, the text itself never handed to
 * `aggregator.record()`. `boundaryContext` reads only the handful of
 * characters immediately adjacent to the caret (never the surrounding
 * document) to classify where an edit landed; see `classifyBoundaryContext`
 * below and docs/TYPING.md's "Pause location" section for why this matters
 * more than pause duration alone.
 */

const DEFAULT_TARGET_KIND = 'chat_composer';
// Long enough to coalesce every intermediate `selectionchange` firing during
// a drag-select into one settled report; short enough that a deliberate
// "select this sentence to re-read it" gesture is still captured within a
// human-perceptible instant. Not derived from any spec value — a documented,
// tunable default (see docs/TYPING.md).
const DEFAULT_SELECTION_CHANGE_THROTTLE_MS = 200;

// How many characters immediately adjacent to the caret `classifyBoundaryContext`
// is allowed to read on each side. Bounded deliberately: this keeps the read
// O(1) regardless of document length (never scan back to find "the nearest
// sentence end", only ever look at a small fixed window) and keeps the
// "never retain surrounding text" guarantee trivially true — the window is
// sliced, classified, and discarded within a single synchronous call. The
// tradeoff: a run of adjacent whitespace longer than this window (e.g. many
// blank lines) hides an earlier newline or sentence-ending punctuation from
// the classifier, which then reports `word_boundary` instead of
// `paragraph_boundary`/`sentence_boundary`. Documented, not a bug — see
// docs/TYPING.md.
const BOUNDARY_CONTEXT_WINDOW = 8;

// Sentence-terminating punctuation, ASCII and the full-width CJK equivalents.
const SENTENCE_END_CHARS = new Set(['.', '!', '?', '。', '！', '？']);

// Unicode-aware "word character": a letter, number, or underscore. Used only
// to decide whether the immediate caret-adjacent characters are "inside a
// word" for `mid_word` classification — not a segmentation boundary.
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

export function createTypingComposerAdapter(options = {}) {
  const {
    element,
    aggregator,
    targetKind = DEFAULT_TARGET_KIND,
    targetId = null,
    onWindow = null,
    now = defaultNow,
    documentRef = element?.ownerDocument,
    segmenter = null,
    // `wordSegmenter` mirrors `segmenter` but for word (not grapheme)
    // counting. Pass an `Intl.Segmenter`-shaped object (real or fake) to
    // force `'injected'` mode; pass `false` explicitly to force the
    // whitespace-fallback path even in an environment where a real
    // `Intl.Segmenter` exists (this is how tests exercise
    // `'whitespace-fallback'` deterministically — omitting the option
    // instead auto-detects the host's real capability). Omit/leave
    // `undefined`/`null` for normal auto-detection.
    wordSegmenter,
    selectionChangeThrottleMs = DEFAULT_SELECTION_CHANGE_THROTTLE_MS,
    // Test/host injection points for the trailing-edge throttle timer — same
    // idiom as `GazeCalibrationDriver`'s `setTimer`/`clearTimer` (see
    // tests/gaze-calibration-overlay.test.js). Default to the real globals.
    setTimerFn = defaultSetTimer,
    clearTimerFn = defaultClearTimer,
    // Wall clock used for `wallTimestamp` — deliberately separate from `now`
    // above, which is a monotonic clock (`performance.now()`-shaped) used for
    // the aggregator's interval/pause accounting. `wallTimestamp` exists
    // specifically to join a window against absolute-time host records, so it
    // must stay on `Date.now()`'s epoch, not the monotonic one. Injectable
    // for deterministic tests; defaults to the real `Date.now`.
    wallClockNow = defaultWallClockNow,
  } = options;

  if (!element) throw new Error('createTypingComposerAdapter: element is required');
  if (!aggregator) throw new Error('createTypingComposerAdapter: aggregator is required');

  // `segmenter` is an injection point for tests/older runtimes. When absent,
  // fall back to a real Intl.Segmenter if the host has one, else to
  // code-point counting. `graphemeMode` records which path is actually in
  // effect so the quality block can report it.
  const resolvedSegmenter = segmenter || createDefaultSegmenter();
  const graphemeMode = segmenter
    ? 'injected'
    : (resolvedSegmenter ? 'intl-segmenter' : 'code-point-fallback');

  // `resolvedWordSegmenter` mirrors `resolvedSegmenter` above; see
  // `wordSegmenter` doc comment for the `false`-forces-fallback convention.
  const resolvedWordSegmenter = wordSegmenter === false
    ? null
    : (wordSegmenter || createDefaultWordSegmenter());
  const wordMode = wordSegmenter
    ? 'injected'
    : (resolvedWordSegmenter ? 'intl-segmenter' : 'whitespace-fallback');

  let active = false;
  let listeners = []; // [target, type, listener] — mirrors GazeCalibrationPanel's teardown bookkeeping.
  let previousGraphemes = 0;
  let previousWords = 0;
  let compositionState = 'none';
  let pendingInputType = null;
  let pendingReplacedSelection = false;
  // Boundary classification, captured at `beforeinput` — see `onBeforeInput`
  // for why it must be read there and not in `onInput`. Only the resulting
  // enum label is retained, never the characters that produced it.
  let pendingBoundaryContext = null;
  // Last caret/selection state actually handed to `aggregator.record()`, by
  // either the input path or the selectionchange path — lets the throttled
  // selectionchange handler skip firing when nothing has changed since the
  // most recent edit already reported the post-edit caret position (every
  // edit moves the caret, which would otherwise double-report as a spurious
  // `move` right after each keystroke).
  let lastReportedCaretOffset = null;
  let lastReportedSelectionLength = null;
  let selectionChangeTimerHandle = null;

  /**
   * Grapheme-cluster and word counts for the field's CURRENT value, computed
   * together so a single call site does the reading (`element.value` is
   * still read only transiently — never retained, never logged, never
   * emitted). Grapheme and word segmentation are different algorithms (a
   * grapheme `Intl.Segmenter` and a word `Intl.Segmenter` cannot share one
   * iteration), so this is two O(n) passes when both real segmenters are
   * available — not the "single pass" the whitespace-fallback branch below
   * achieves, where counting code points and splitting on whitespace really
   * can share one loop.
   *
   * KNOWN HOT SPOT (shared with the pre-existing grapheme-only comment this
   * replaces): both passes re-scan the *entire* current value on every
   * keystroke — O(n) per event, O(n^2) over a long composition or a large
   * paste. The correct fix is to segment only the changed slice (widened
   * outward to the nearest cluster/word boundaries) and diff that against
   * the cached `previousGraphemes`/`previousWords` counts, rather than
   * recomputing the whole string from scratch. Left as the simple-correct
   * version for now; revisit if profiling shows typing lag on long text.
   */
  function countGraphemesAndWords(value) {
    if (!value) return { graphemes: 0, words: 0 };

    if (!resolvedSegmenter && !resolvedWordSegmenter) {
      // Whitespace-fallback path for BOTH counts: this is the one case where
      // "single pass over the value" is actually achievable, since code-point
      // counting and whitespace/punctuation word-splitting are both cheap
      // linear scans over the same characters rather than two independent
      // segmenter algorithms.
      return countGraphemesAndWordsFallback(value);
    }

    const graphemes = resolvedSegmenter ? countGraphemeClusters(value) : [...value].length;
    const words = resolvedWordSegmenter ? countWordLikeSegments(value) : countWordsFallback(value);
    return { graphemes, words };
  }

  function countGraphemeClusters(value) {
    let count = 0;
    for (const _cluster of resolvedSegmenter.segment(value)) count += 1;
    return count;
  }

  function countWordLikeSegments(value) {
    let count = 0;
    for (const segment of resolvedWordSegmenter.segment(value)) {
      if (segment.isWordLike) count += 1;
    }
    return count;
  }

  /** `null` when the host element doesn't support a text selection (e.g. some `<input type>`s). */
  function readCaretOffset() {
    return element.selectionStart ?? null;
  }

  /** `0` (collapsed) when either endpoint is unavailable. */
  function readSelectionLength() {
    const start = element.selectionStart;
    const end = element.selectionEnd;
    if (start == null || end == null) return 0;
    return Math.abs(end - start);
  }

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

  function cancelPendingSelectionFlush() {
    if (selectionChangeTimerHandle !== null) {
      clearTimerFn(selectionChangeTimerHandle);
      selectionChangeTimerHandle = null;
    }
  }

  function onBeforeInput(event) {
    if (!active) return;
    // `beforeinput` fires before the DOM mutates, so it is the only reliable
    // moment to observe the pre-edit selection — by the time `input` fires,
    // the selection has already collapsed to the new caret position. Store
    // nothing else from the event; never read `event.data` (that would be
    // reading composer content, which is out of scope for this adapter).
    pendingInputType = event?.inputType ?? null;
    pendingReplacedSelection = element.selectionStart !== element.selectionEnd;
    // Boundary classification is ALSO a beforeinput-only reading: by `input`
    // time the caret has already moved to reflect the edit, so classifying
    // there would describe where the caret ended up, not where the edit
    // actually started. `classifyBoundaryContext` reads only the small
    // bounded window around `element.selectionStart` (see
    // BOUNDARY_CONTEXT_WINDOW) and returns a single enum label — the
    // characters themselves are never retained past this call.
    pendingBoundaryContext = classifyBoundaryContext(element.value, element.selectionStart);
  }

  function onInput() {
    if (!active) return;
    // `input` is the source of truth for content; `beforeinput` only supplies
    // hints (inputType, whether a selection was replaced, boundary context).
    const { graphemes: currentGraphemes, words: currentWords } = countGraphemesAndWords(element.value);
    const caretOffset = readCaretOffset();
    const selectionLength = readSelectionLength();
    aggregator.record({
      timestamp: now(),
      wallTimestamp: wallClockNow(),
      inputType: pendingInputType,
      previousGraphemes,
      currentGraphemes,
      previousWords,
      currentWords,
      replacedSelection: pendingReplacedSelection,
      compositionState,
      caretOffset,
      selectionLength,
      boundaryContext: pendingBoundaryContext,
    });
    previousGraphemes = currentGraphemes;
    previousWords = currentWords;
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
    pendingInputType = null;
    pendingReplacedSelection = false;
    pendingBoundaryContext = null;
    // 'end' is a one-shot tag for the input event that finalizes a
    // composition; once consumed, subsequent input events are plain typing.
    if (compositionState === 'end') compositionState = 'none';
  }

  function onCompositionStart() {
    if (!active) return;
    compositionState = 'start';
  }

  function onCompositionUpdate() {
    if (!active) return;
    compositionState = 'update';
  }

  function onCompositionEnd() {
    if (!active) return;
    compositionState = 'end';
  }

  function onVisibilityChange() {
    // Intentionally a no-op. Going hidden must NOT finalize the window: the
    // aggregator's own pause buckets already represent an idle gap from the
    // sample timestamps, and a real interaction can legitimately span a
    // tab-switch (e.g. checking another window mid-sentence). Finalization
    // is the host's explicit call via submit()/abandon().
  }

  /** Trailing-edge flush: report the SETTLED selection, not every intermediate one. */
  function flushSelectionChange() {
    selectionChangeTimerHandle = null;
    if (!active) return;
    const caretOffset = readCaretOffset();
    const selectionLength = readSelectionLength();
    // Nothing changed since the last thing we reported (typically because an
    // `input` event already reported this exact caret position) — skip; see
    // the note on `lastReportedCaretOffset` above.
    if (caretOffset === lastReportedCaretOffset && selectionLength === lastReportedSelectionLength) return;
    aggregator.record({
      timestamp: now(),
      wallTimestamp: wallClockNow(),
      inputType: null,
      previousGraphemes,
      currentGraphemes: previousGraphemes,
      previousWords,
      currentWords: previousWords,
      replacedSelection: false,
      compositionState: 'none',
      caretOffset,
      selectionLength,
      // No `beforeinput` moment applies here — the value hasn't changed and
      // the caret has already settled by the time the throttle fires, so
      // classifying live (rather than from a stashed pre-edit reading) is
      // correct, unlike the edit path in `onBeforeInput`/`onInput`.
      boundaryContext: classifyBoundaryContext(element.value, caretOffset),
    });
    lastReportedCaretOffset = caretOffset;
    lastReportedSelectionLength = selectionLength;
  }

  function onSelectionChange() {
    if (!active) return;
    // `selectionchange` fires on the DOCUMENT for any selection change on the
    // page; filter to only the selection we're authorized to observe.
    if (documentRef.activeElement !== element) return;
    if (selectionChangeTimerHandle !== null) return; // already scheduled — trailing edge reads live state at fire time.
    selectionChangeTimerHandle = setTimerFn(flushSelectionChange, selectionChangeThrottleMs);
  }

  function start() {
    if (active) return; // idempotent — do not double-attach.
    active = true;
    addListener(element, 'beforeinput', onBeforeInput);
    addListener(element, 'input', onInput);
    addListener(element, 'compositionstart', onCompositionStart);
    addListener(element, 'compositionupdate', onCompositionUpdate);
    addListener(element, 'compositionend', onCompositionEnd);
    if (documentRef) {
      addListener(documentRef, 'visibilitychange', onVisibilityChange);
      addListener(documentRef, 'selectionchange', onSelectionChange);
    }

    const initialCounts = countGraphemesAndWords(element.value);
    previousGraphemes = initialCounts.graphemes;
    previousWords = initialCounts.words;
    pendingInputType = null;
    pendingReplacedSelection = false;
    pendingBoundaryContext = null;
    compositionState = 'none';
    lastReportedCaretOffset = readCaretOffset();
    lastReportedSelectionLength = readSelectionLength();

    aggregator.start({ timestamp: now(), targetKind, targetId });
  }

  function finalize(reason) {
    if (!active) return null;
    const windowObject = aggregator.finalize({ timestamp: now(), reason });
    // Flip inactive AND detach BEFORE invoking the host's onWindow: a
    // callback that throws must never leave listeners attached — the
    // add/remove symmetry guarantee holds even when the host misbehaves —
    // and any event fired synchronously as a side effect of onWindow is
    // ignored either way (listeners are already gone, and `active` is
    // false as the backstop). The throw still propagates to the
    // submit()/abandon() caller; teardown is simply complete first.
    active = false;
    cancelPendingSelectionFlush();
    removeAllListeners();
    if (windowObject != null && typeof onWindow === 'function') onWindow(windowObject);
    return windowObject;
  }

  function submit() {
    return finalize('submitted');
  }

  function abandon() {
    return finalize('abandoned');
  }

  function dispose() {
    // Safe to call twice, and safe after submit()/abandon() — does NOT
    // finalize; just drops listeners and references.
    active = false;
    cancelPendingSelectionFlush();
    removeAllListeners();
  }

  return {
    start,
    submit,
    abandon,
    dispose,
    get active() { return active; },
    get graphemeMode() { return graphemeMode; },
    get wordMode() { return wordMode; },
  };
}

function createDefaultSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return null;
}

/**
 * Word `Intl.Segmenter`, when the host supports the `'word'` granularity.
 * Counting only `isWordLike` segments (not every segment — `Intl.Segmenter`
 * with `granularity: 'word'` also yields whitespace/punctuation segments) is
 * what makes this correct for languages without inter-word spaces (Japanese,
 * Chinese, Thai, ...), which a whitespace split cannot handle at all.
 */
function createDefaultWordSegmenter() {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  return null;
}

/**
 * Whitespace/punctuation word-count fallback for hosts without
 * `Intl.Segmenter`. Counts maximal runs of letters/numbers (Unicode-aware),
 * allowing an internal apostrophe so contractions ("don't") count as one
 * word. This is a genuine degradation, not a like-for-like substitute: it
 * has no notion of a "word" in scripts that don't separate words with
 * whitespace, so it under- or over-counts CJK/Thai text — see
 * `wordMode`/docs/TYPING.md.
 */
function countWordsFallback(value) {
  if (!value) return 0;
  const matches = value.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/**
 * Single-pass fallback used when NEITHER a grapheme nor a word
 * `Intl.Segmenter` is available: code-point counting and whitespace-based
 * word splitting are both simple linear scans, so they can share one pass
 * over `value` rather than the two independent segmenter passes the
 * primary path takes.
 */
function countGraphemesAndWordsFallback(value) {
  const codePoints = [...value];
  let words = 0;
  let inWord = false;
  for (const ch of codePoints) {
    const isWordChar = WORD_CHAR_RE.test(ch);
    if (isWordChar && !inWord) words += 1;
    inWord = isWordChar;
  }
  return { graphemes: codePoints.length, words };
}

/**
 * Classify where the caret sits, using ONLY the small bounded window of
 * characters immediately adjacent to it (`BOUNDARY_CONTEXT_WINDOW` on each
 * side) — never the whole document, and nothing beyond the returned label is
 * retained.
 *
 *   - `paragraph_boundary` — the nearest non-space/tab character before the
 *     caret is a newline (trailing spaces/tabs after the newline, e.g. an
 *     indented new paragraph, are tolerated).
 *   - `sentence_boundary`  — the nearest non-space/tab character before the
 *     caret is sentence-terminating punctuation (`.`, `!`, `?`, or their
 *     full-width equivalents `。`, `！`, `？`); trailing spaces/tabs after it
 *     are tolerated the same way.
 *   - `mid_word`           — the character immediately before AND the
 *     character immediately after the caret are both word characters.
 *   - `word_boundary`      — everything else (start/end of field, caret next
 *     to whitespace or non-sentence punctuation with no word character on
 *     both sides, etc.) — the default, catch-all case.
 *
 * `caretOffset` may be `null` (host element without a selection concept);
 * that degrades to `word_boundary`, the same "no positional info" default
 * `caretOffset: null` already has elsewhere in this adapter.
 */
function classifyBoundaryContext(value, caretOffset) {
  if (!value || caretOffset == null) return 'word_boundary';

  const before = value.slice(Math.max(0, caretOffset - BOUNDARY_CONTEXT_WINDOW), caretOffset);
  const after = value.slice(caretOffset, caretOffset + BOUNDARY_CONTEXT_WINDOW);

  const beforeStripped = before.replace(/[ \t]+$/, '');
  const lastSignificant = beforeStripped.charAt(beforeStripped.length - 1);
  if (lastSignificant === '\n') return 'paragraph_boundary';
  if (SENTENCE_END_CHARS.has(lastSignificant)) return 'sentence_boundary';

  const charBefore = before.charAt(before.length - 1);
  const charAfter = after.charAt(0);
  if (WORD_CHAR_RE.test(charBefore) && WORD_CHAR_RE.test(charAfter)) return 'mid_word';

  return 'word_boundary';
}

function defaultNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultWallClockNow() {
  return Date.now();
}

function defaultSetTimer(fn, ms) {
  return setTimeout(fn, ms);
}

function defaultClearTimer(handle) {
  clearTimeout(handle);
}
