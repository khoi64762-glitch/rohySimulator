/**
 * InteractionAggregator — Stage 2 of the interaction (pointer/click/scroll/
 * selection/focus/visibility) pipeline. Consumes the state-labelled events
 * `InteractionTracker` emits (`src/capture/InteractionTracker.js`) and
 * produces one `interaction-v1` window per `start()`/`finalize()` span.
 *
 * PURE, like `TypingAggregator`: no DOM, no timers, no globals. All timing
 * comes in via `event.timestamp`/the `start`/`finalize` `timestamp` argument
 * — a single clock, supplied by the caller (`InteractionTracker`'s `now()`),
 * unlike `TypingAggregator`'s separate monotonic-vs-wall-clock split, which
 * this modality has no need for (there is no burst/pause math straddling two
 * different clocks here). `options.now()` exists only to default-stamp
 * `window_start`/`window_end` if a caller ever omits an explicit timestamp on
 * `start()`.
 *
 * Shape mirrors `GazeAggregator`: a `record()`/`consumeFrame()`-equivalent
 * ingestion method, a `finalize()`/`flush()`-equivalent output method, and an
 * AOI dwell/click map keyed by the SAME aoi ids `InteractionTracker`'s
 * `aoiResolver` produces (which, via `createElementAoiResolver`, are the same
 * ids `GazeAggregator`'s own `aoi_dwell_ms` uses) — mouse and gaze are
 * directly comparable streams (audio_text.md §4.9).
 *
 * ---- AOI dwell attribution (mirrors GazeAggregator's frame-timing idea,
 * simplified for a SAMPLED, not fixed-cadence, stream) ----
 *
 * `pointer_move` events are *throttled samples* (`InteractionTracker` emits
 * at most one every `pointerSampleMs`), each carrying only a POINT and an AOI
 * id, no explicit duration. Dwell time is attributed with a ONE-SAMPLE LAG:
 * when sample N+1 arrives, the gap between sample N's timestamp and sample
 * N+1's timestamp is now known, and is charged to sample N's AOI (this is
 * exactly `GazeAggregator.addFrameTiming`'s "each frame's duration is the gap
 * to the NEXT frame" rule, just computed incrementally instead of over a
 * buffered array — `InteractionAggregator` never buffers the raw sample
 * stream, so this stays O(1) memory regardless of episode length). A gap
 * larger than `maxSampleGapMs` (default: 4x `pointerSampleMs`, floored at
 * 500ms) is treated as an interruption — nothing is charged — same rationale
 * as `GazeAggregator`'s `gapLimit`: a real pause between samples must not
 * silently become fabricated AOI dwell time. The LAST pending sample (the one
 * with no successor yet, because no further `pointer_move` arrived before
 * `finalize()`) is charged a REPRESENTATIVE tail duration —
 * `min(pointerSampleMs, finalizeTimestamp - lastSampleTimestamp)` — mirroring
 * `GazeAggregator`'s "the final sample represents one typical interval,
 * never the entire tail" rule, so stop/transport latency never becomes
 * fictitious dwell.
 */

import { OYON_INTERACTION_STATES } from '../version.js';

const MODALITY = 'interaction';
const FEATURE_PROFILE = 'interaction-v1';

const DEFAULT_POINTER_SAMPLE_MS = 100;
const DEFAULT_IDLE_THRESHOLD_MS = 1500;
const DEFAULT_SCROLL_THRESHOLD_PX = 40;
const DEFAULT_MAX_SAMPLE_GAP_MS = 500;

export class InteractionAggregator {
  constructor(options = {}) {
    this.options = {
      now: () => Date.now(),
      // Recorded verbatim into `quality.thresholds` — these describe the
      // THRESHOLDS `InteractionTracker` was configured with (pass the same
      // values the tracker was constructed with so the window's quality
      // block accurately documents what produced it).
      pointerSampleMs: DEFAULT_POINTER_SAMPLE_MS,
      idleThresholdMs: DEFAULT_IDLE_THRESHOLD_MS,
      scrollThresholdPx: DEFAULT_SCROLL_THRESHOLD_PX,
      // A pointer-sample gap larger than this breaks AOI dwell attribution
      // instead of silently charging a real pause as dwell time — see class
      // doc. Defaults to 4x pointerSampleMs, floored at
      // DEFAULT_MAX_SAMPLE_GAP_MS, mirroring GazeAggregator's gapLimit rule.
      maxSampleGapMs: null,
      ...options,
    };
    this._maxSampleGapMs = Math.max(
      DEFAULT_MAX_SAMPLE_GAP_MS,
      positive(this.options.maxSampleGapMs, this.options.pointerSampleMs * 4),
    );
    this._reset();
  }

  /** True while an interval is in progress (between `start()` and `finalize()`). */
  get active() {
    return this._started;
  }

  /** Begin a new interaction window. Discards any prior unfinished one. */
  start({ timestamp } = {}) {
    this._reset();
    this._started = true;
    this._startTimestamp = Number.isFinite(timestamp) ? timestamp : this.options.now();
  }

  /** Consume one `InteractionTracker`-shaped event. No-op (never throws) when not active. */
  record(event = {}) {
    if (!this._started) return;
    const { state, detail = null, timestamp } = event;
    if (!OYON_INTERACTION_STATES.includes(state)) {
      throw new Error(`InteractionAggregator.record(): '${state}' is not a member of OYON_INTERACTION_STATES`);
    }
    const ts = Number.isFinite(timestamp) ? timestamp : this.options.now();

    switch (state) {
      case 'pointer_move':
        this._recordPointerMove(detail, ts);
        break;
      case 'pointer_idle':
        this._idleEventCount += 1;
        this._idleMs += positive(detail?.idle_ms, 0);
        break;
      case 'click':
        this._clickCount += 1;
        this._recordAoiClick(detail);
        break;
      case 'double_click':
        this._doubleClickCount += 1;
        this._recordAoiClick(detail);
        break;
      case 'scroll_down':
        this._recordScroll('down', detail);
        break;
      case 'scroll_up':
        this._recordScroll('up', detail);
        break;
      case 'select_text':
        this._recordSelection(detail);
        break;
      case 'focus_gain':
        break; // no dedicated counter — only the LOSS side is reported (see window.interaction.focus_loss_count).
      case 'focus_loss':
        this._focusLossCount += 1;
        break;
      case 'tab_hidden':
        this._hiddenSince = ts;
        break;
      case 'tab_visible':
        if (this._hiddenSince !== null) {
          this._hiddenMs += Math.max(0, ts - this._hiddenSince);
          this._hiddenSince = null;
        }
        break;
      default:
        break;
    }
  }

  /** End the window and return it, or `null` if there was none. */
  finalize({ timestamp } = {}) {
    if (!this._started) return null;
    const end = Number.isFinite(timestamp) ? timestamp : this.options.now();

    // Close out a pending pointer-dwell tail — see class doc.
    if (this._lastPointerTimestamp !== null && this._lastPointerAoi != null) {
      const tailGap = Math.min(this.options.pointerSampleMs, Math.max(0, end - this._lastPointerTimestamp));
      if (tailGap > 0) this._chargeDwell(this._lastPointerAoi, tailGap);
    }
    // Close out a pending hidden span — still hidden at window end.
    if (this._hiddenSince !== null) {
      this._hiddenMs += Math.max(0, end - this._hiddenSince);
      this._hiddenSince = null;
    }

    const durationMs = Math.max(0, end - this._startTimestamp);
    const idleRatio = durationMs > 0 ? Math.min(1, this._idleMs / durationMs) : 0;
    const selectionMeanLength = this._selectionCount > 0
      ? this._selectionLengthTotal / this._selectionCount
      : null;

    const window = {
      modality: MODALITY,
      window_kind: 'interval',
      feature_profile: FEATURE_PROFILE,
      window_start: new Date(this._startTimestamp).toISOString(),
      window_end: new Date(end).toISOString(),
      interaction: {
        pointer_path_length: this._pathLength,
        pointer_sample_count: this._pointerSampleCount,
        idle_ms: this._idleMs,
        idle_ratio: idleRatio,
        click_count: this._clickCount,
        double_click_count: this._doubleClickCount,
        scroll_events: this._scrollEvents,
        scroll_depth_max: this._scrollDepthMax,
        scroll_reversals: this._scrollReversals,
        selection_count: this._selectionCount,
        selection_mean_length: selectionMeanLength,
        focus_loss_count: this._focusLossCount,
        hidden_ms: this._hiddenMs,
        aoi_dwell_ms: { ...this._aoiDwellMs },
        aoi_click_counts: { ...this._aoiClickCounts },
      },
      quality: {
        thresholds: {
          pointer_sample_ms: this.options.pointerSampleMs,
          idle_threshold_ms: this.options.idleThresholdMs,
          scroll_threshold_px: this.options.scrollThresholdPx,
          max_sample_gap_ms: this._maxSampleGapMs,
        },
      },
    };

    this._reset();
    return window;
  }

  // ---- internal ----

  _recordPointerMove(detail, timestamp) {
    this._pointerSampleCount += 1;
    const x = Number(detail?.x);
    const y = Number(detail?.y);
    const aoi = typeof detail?.aoi === 'string' ? detail.aoi : null;
    const xFinite = Number.isFinite(x);
    const yFinite = Number.isFinite(y);

    if (this._havePointerPosition && xFinite && yFinite) {
      const dx = x - this._lastPointerX;
      const dy = y - this._lastPointerY;
      this._pathLength += Math.sqrt(dx * dx + dy * dy);
    }
    if (xFinite && yFinite) {
      this._lastPointerX = x;
      this._lastPointerY = y;
      this._havePointerPosition = true;
    }

    // Dwell attribution, one-sample lag — see class doc.
    if (this._lastPointerTimestamp !== null) {
      const gap = timestamp - this._lastPointerTimestamp;
      if (gap > 0 && gap <= this._maxSampleGapMs && this._lastPointerAoi != null) {
        this._chargeDwell(this._lastPointerAoi, gap);
      }
    }
    this._lastPointerAoi = aoi;
    this._lastPointerTimestamp = timestamp;
  }

  _chargeDwell(aoiId, ms) {
    this._aoiDwellMs[aoiId] = (this._aoiDwellMs[aoiId] || 0) + ms;
  }

  _recordAoiClick(detail) {
    const aoi = detail?.aoi;
    if (typeof aoi === 'string') {
      this._aoiClickCounts[aoi] = (this._aoiClickCounts[aoi] || 0) + 1;
    }
  }

  _recordScroll(direction, detail) {
    this._scrollEvents += 1;
    const depthRatio = Number.isFinite(detail?.depth_ratio) ? detail.depth_ratio : 0;
    if (depthRatio > this._scrollDepthMax) this._scrollDepthMax = depthRatio;
    if (this._lastScrollDirection !== null && this._lastScrollDirection !== direction) {
      this._scrollReversals += 1;
    }
    this._lastScrollDirection = direction;
  }

  _recordSelection(detail) {
    this._selectionCount += 1;
    this._selectionLengthTotal += positive(detail?.length, 0);
  }

  _reset() {
    this._started = false;
    this._startTimestamp = null;

    this._pointerSampleCount = 0;
    this._pathLength = 0;
    this._havePointerPosition = false;
    this._lastPointerX = null;
    this._lastPointerY = null;
    this._lastPointerAoi = null;
    this._lastPointerTimestamp = null;

    this._idleEventCount = 0;
    this._idleMs = 0;

    this._clickCount = 0;
    this._doubleClickCount = 0;
    this._aoiClickCounts = {};
    this._aoiDwellMs = {};

    this._scrollEvents = 0;
    this._scrollDepthMax = 0;
    this._scrollReversals = 0;
    this._lastScrollDirection = null;

    this._selectionCount = 0;
    this._selectionLengthTotal = 0;

    this._focusLossCount = 0;
    this._hiddenMs = 0;
    this._hiddenSince = null;
  }
}

function positive(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}
