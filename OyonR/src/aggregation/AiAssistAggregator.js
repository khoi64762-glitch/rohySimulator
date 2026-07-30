/**
 * AiAssistAggregator — aggregates the per-event stream from
 * `createAiAssistTracker` (`src/capture/AiAssistTracker.js`) into an
 * `ai-assist-v1` window, mirroring the `start()`/`record()`/`finalize()`
 * shape of `TypingAggregator` / `EngagementAggregator`.
 *
 * This class is PURE: no DOM, no timers, no globals, no host coupling. It
 * consumes exactly the event objects `AiAssistTracker` emits (`{ modality:
 * 'ai_assist', state, source, timestamp, monotonic_ms, detail }`) via
 * `record()`; all duration/latency arithmetic is done on `monotonic_ms` (or
 * on `detail.latency_ms`, which the tracker already measured on the
 * monotonic clock) — `options.now()` is used ONLY to stamp the ISO
 * `window_start`/`window_end` strings, exactly like `TypingAggregator`.
 *
 * ---- why this modality exists (read `AiAssistTracker`'s class doc too) ----
 *
 * Oyon cannot derive any of this from what it observes in the DOM: only the
 * host knows it asked the AI for a suggestion, what the AI returned, and
 * what the learner did with it. Without this stream, an insertion of 200
 * graphemes in 40ms in the typing log is indistinguishable from very fast
 * typing — it is actually an accepted AI suggestion. CoAuthor (Stanford)
 * reports 72.3% suggestion acceptance against 72.6% human-authored text; the
 * gap between those two numbers is exactly the signal this modality exists
 * to produce (see `ai_authored_graphemes` below and docs/AI_ASSIST.md).
 *
 * ---- ai_turn_start / ai_turn_end pairing ----
 *
 * Turns are tracked on a LIFO stack of open `monotonic_ms` start times: each
 * `ai_turn_start` pushes, each `ai_turn_end` pops the most recent open start
 * and folds `max(0, end - start)` into `ai_turn_total_ms`. An `ai_turn_end`
 * with nothing open (a stray/duplicate end) is counted into
 * `quality.unmatched_turn_end_count` and otherwise ignored. Any turn(s) still
 * open at `finalize()` — a turn that never got an explicit end before the
 * window closed — are closed against the `finalize()` timestamp itself, the
 * same "episode boundary closes an open span" rule `TypingAggregator` uses
 * for a trailing burst; `quality.open_ai_turns_closed_at_finalize` reports
 * how many that was, so a consumer can tell a genuinely short turn from one
 * that was cut off by the window boundary.
 *
 * ---- chosen_index_counts ----
 *
 * Tallied ONLY from `suggestion_accept` events carrying a non-negative
 * integer `chosen_index` (not from `suggestion_reject`, which may or may not
 * name an index the learner looked at but did not take) — this is
 * deliberately "which option did writers actually choose", not "which
 * option was shown most". Capped at `options.maxChosenIndexKeys` distinct
 * indices (transport bound, not a privacy measure — see
 * `quality.chosen_index_counts_truncated`); a legitimate suggestion UI
 * offering more than a few dozen ranked options would be unusual.
 */

const MODALITY = 'ai_assist';
const FEATURE_PROFILE = 'ai-assist-v1';

// Transport bound on the `chosen_index_counts` map — see class doc.
const DEFAULT_MAX_CHOSEN_INDEX_KEYS = 64;

export class AiAssistAggregator {
  constructor(options = {}) {
    this.options = {
      // Wall clock, used ONLY for the ISO window_start / window_end strings —
      // never enters any duration/latency computation (those are all on the
      // monotonic `monotonic_ms` carried by each recorded event).
      now: () => Date.now(),
      maxChosenIndexKeys: DEFAULT_MAX_CHOSEN_INDEX_KEYS,
      ...options,
    };
    this._reset();
  }

  /** True while a window is in progress (between `start()` and `finalize()`). */
  get active() {
    return this._started;
  }

  /** Begin a new aggregation window. Discards any prior unfinished window. */
  start({ timestamp, targetKind = null, targetId = null } = {}) {
    this._reset();
    this._started = true;
    this._startTimestamp = timestamp;
    this._startWallClock = this.options.now();
    this._target = (targetKind != null || targetId != null)
      ? { kind: targetKind, id: targetId }
      : null;
  }

  /**
   * Consume one event from `AiAssistTracker` (or anything shaped like its
   * output). No-op when not active, matching `TypingAggregator.record()`.
   */
  record(event) {
    if (!this._started) return;
    if (!event || typeof event !== 'object') return;

    const { state, monotonic_ms = null, detail = null } = event;

    switch (state) {
      case 'suggestion_request': {
        this._requestCount += 1;
        break;
      }
      case 'suggestion_shown': {
        this._shownCount += 1;
        const latency = detail?.latency_ms;
        if (Number.isFinite(latency)) {
          this._latenciesMs.push(latency);
        } else {
          this._unmatchedShownCount += 1;
        }
        break;
      }
      case 'suggestion_accept': {
        this._acceptCount += 1;
        const graphemes = detail?.accepted_graphemes;
        if (Number.isFinite(graphemes)) this._acceptedGraphemesTotal += graphemes;
        this._recordChosenIndex(detail?.chosen_index);
        break;
      }
      case 'suggestion_reject': {
        this._rejectCount += 1;
        break;
      }
      case 'suggestion_dismiss': {
        this._dismissCount += 1;
        break;
      }
      case 'ai_turn_start': {
        this._aiTurnCount += 1;
        this._openTurnStartsMs.push(Number.isFinite(monotonic_ms) ? monotonic_ms : this._startTimestamp);
        break;
      }
      case 'ai_turn_end': {
        if (this._openTurnStartsMs.length > 0) {
          const startMs = this._openTurnStartsMs.pop();
          const endMs = Number.isFinite(monotonic_ms) ? monotonic_ms : startMs;
          this._aiTurnTotalMs += Math.max(0, endMs - startMs);
        } else {
          this._unmatchedTurnEndCount += 1;
        }
        break;
      }
      default:
        throw new Error(`AiAssistAggregator.record(): unrecognized state '${state}'`);
    }
  }

  /** End the window and return it, or `null` if there was none. */
  finalize({ timestamp } = {}) {
    if (!this._started) return null;

    // Any AI turn still open at the window boundary closes against the
    // finalize timestamp itself — see class doc.
    let openAiTurnsClosedAtFinalize = 0;
    while (this._openTurnStartsMs.length > 0) {
      const startMs = this._openTurnStartsMs.pop();
      const endMs = Number.isFinite(timestamp) ? timestamp : startMs;
      this._aiTurnTotalMs += Math.max(0, endMs - startMs);
      openAiTurnsClosedAtFinalize += 1;
    }

    // null (not 0) when the denominator is 0 — "never measured" must stay
    // distinguishable from "measured as zero"; see class/task doc.
    const acceptanceRate = this._shownCount > 0 ? this._acceptCount / this._shownCount : null;
    const meanLatencyMs = this._latenciesMs.length > 0 ? mean(this._latenciesMs) : null;
    const medianLatencyMs = this._latenciesMs.length > 0 ? median(this._latenciesMs) : null;
    const meanAcceptedGraphemes = this._acceptCount > 0
      ? this._acceptedGraphemesTotal / this._acceptCount
      : null;

    const window = {
      modality: MODALITY,
      window_kind: 'interval',
      feature_profile: FEATURE_PROFILE,
      window_start: new Date(this._startWallClock).toISOString(),
      window_end: new Date(this.options.now()).toISOString(),
      ai_assist: {
        request_count: this._requestCount,
        shown_count: this._shownCount,
        accept_count: this._acceptCount,
        reject_count: this._rejectCount,
        dismiss_count: this._dismissCount,
        acceptance_rate: acceptanceRate,
        mean_latency_ms: meanLatencyMs,
        median_latency_ms: medianLatencyMs,
        accepted_graphemes_total: this._acceptedGraphemesTotal,
        mean_accepted_graphemes: meanAcceptedGraphemes,
        ai_turn_count: this._aiTurnCount,
        ai_turn_total_ms: this._aiTurnTotalMs,
        chosen_index_counts: { ...this._chosenIndexCounts },
        // The headline authorship figure — see docs/AI_ASSIST.md for how a
        // consumer combines this with the typing window's
        // `committed_graphemes` to reproduce CoAuthor's human-vs-AI split.
        ai_authored_graphemes: this._acceptedGraphemesTotal,
      },
      quality: {
        unmatched_shown_count: this._unmatchedShownCount,
        unmatched_turn_end_count: this._unmatchedTurnEndCount,
        open_ai_turns_closed_at_finalize: openAiTurnsClosedAtFinalize,
        chosen_index_counts_truncated: this._chosenIndexCountsTruncated,
      },
    };

    if (this._target) window.target = this._target;

    this._reset();
    return window;
  }

  // ---- internal ----

  _recordChosenIndex(chosenIndex) {
    if (!Number.isInteger(chosenIndex) || chosenIndex < 0) return;
    const key = String(chosenIndex);
    const alreadyTracked = Object.prototype.hasOwnProperty.call(this._chosenIndexCounts, key);
    if (!alreadyTracked && Object.keys(this._chosenIndexCounts).length >= this.options.maxChosenIndexKeys) {
      this._chosenIndexCountsTruncated = true;
      return;
    }
    this._chosenIndexCounts[key] = (this._chosenIndexCounts[key] || 0) + 1;
  }

  _reset() {
    this._started = false;
    this._startTimestamp = null;
    this._startWallClock = null;
    this._target = null;

    this._requestCount = 0;
    this._shownCount = 0;
    this._acceptCount = 0;
    this._rejectCount = 0;
    this._dismissCount = 0;

    this._latenciesMs = [];
    this._unmatchedShownCount = 0;

    this._acceptedGraphemesTotal = 0;
    this._chosenIndexCounts = {};
    this._chosenIndexCountsTruncated = false;

    this._aiTurnCount = 0;
    this._aiTurnTotalMs = 0;
    this._openTurnStartsMs = [];
    this._unmatchedTurnEndCount = 0;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
