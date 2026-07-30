/**
 * DiscourseAggregator — per-sentence speech-act classification plus
 * `text-v1` metrics for the `discourse` modality, mirroring the
 * `analyze()`/`finalize()` lifecycle of the other episode-shaped aggregators
 * (`TypingAggregator`, `AiAssistAggregator` — see
 * `src/aggregation/TypingAggregator.js`).
 *
 * This class is PURE: no DOM, no timers, no globals. All classification work
 * is delegated to `src/analytics/TextAnalyzer.js` (`splitSentences`,
 * `classifySentence`, `extractWords`, `computeTextMetrics`); this class only
 * owns the ACCUMULATION across possibly-multiple `analyze()` calls and the
 * per-event dispatch.
 *
 * ---- lifecycle ----
 *
 * There is no separate `start()` — the FIRST `analyze()` call that produces
 * at least one sentence implicitly opens the episode (stamping
 * `window_start` from `wallTimestamp`, else `options.now()`). Every
 * subsequent `analyze()` call folds its sentences into the same running
 * accumulators, so one episode can span several messages/turns (e.g. a whole
 * conversation) or exactly one (a single message) — the caller decides how
 * many times to call `analyze()` before calling `finalize()`. An `analyze()`
 * call with empty/whitespace-only text is a no-op: it emits nothing and does
 * not open the episode by itself.
 *
 * ---- per-sentence events ----
 *
 * `analyze()` emits exactly one event per sentence, IN ORDER, via
 * `options.onEvent`: `{ modality: 'discourse', state: <act>, source:
 * 'user', timestamp, monotonic_ms, detail: { index, words, matched } }`.
 * `state` is drawn from the closed `OYON_DISCOURSE_STATES` vocabulary
 * (`discourse-states-v1`, `src/version.js`) — asserted before every dispatch,
 * exactly like `TypingAggregator`'s `assertKnownState`. `detail.index` is a
 * running counter across the WHOLE episode (not reset per `analyze()` call),
 * `detail.words` is that sentence's word count, and `detail.matched` is
 * `classifySentence`'s audit-trail marker.
 *
 * **The sentence text itself is NEVER included in the event or the window.**
 * This is a REDUNDANCY rule, not a privacy rule — exactly the same framing
 * `TypingAggregator`/`AiAssistAggregator` use for the composer text/AI
 * suggestion text (see `FORBIDDEN_TYPING_FIELDS` /
 * `FORBIDDEN_AI_ASSIST_FIELDS` in `src/validation/validateEmotionPayload.js`
 * and CLAUDE.md's data policy, which is explicit that Oyon is not a privacy
 * gatekeeper): the host already stores the message the sentence came from,
 * so carrying a second copy here would just be a second copy to keep
 * consistent, for no analytic gain — `index` + `matched` is enough to locate
 * and audit the classification against the host's own record.
 *
 * ---- finalize() ----
 *
 * `finalize()` computes the `text-v1` metrics block (via
 * `computeTextMetrics`) over EVERY sentence/word accumulated since the
 * episode opened (across all `analyze()` calls), resets the accumulators,
 * and returns:
 *
 *   { modality: 'discourse', window_kind: 'episode', feature_profile:
 *     'text-v1', window_start, window_end, text: <metrics>, quality: {...} }
 *
 * `quality` carries `lang`, whether the hedge/directive lists were the
 * built-in defaults or a caller override, and `precedence_version`
 * (`OYON_DISCOURSE_STATES_VERSION` — the vocabulary is defined IN precedence
 * order, so its version identifier doubles as the precedence-order version;
 * see `src/version.js`'s doc comment on `OYON_DISCOURSE_STATES`).
 */

import { OYON_DISCOURSE_STATES, OYON_DISCOURSE_STATES_VERSION } from '../version.js';
import {
  splitSentences,
  classifySentence,
  extractWords,
  computeTextMetrics,
  countParagraphs,
} from '../analytics/TextAnalyzer.js';

const MODALITY = 'discourse';
const FEATURE_PROFILE = 'text-v1';
const EVENT_SOURCE = 'user';

export class DiscourseAggregator {
  constructor(options = {}) {
    this.options = {
      onEvent: null,
      // Wall clock, used to stamp window_start/window_end and as the
      // fallback wall-clock reading for events when the caller doesn't
      // supply `wallTimestamp` — never enters any metric computation.
      now: () => Date.now(),
      lang: 'en',
      // `null` (default) means "use TextAnalyzer's built-in defaults";
      // supplying either REPLACES the corresponding default list (see
      // `src/analytics/TextAnalyzer.js`'s module doc comment on `hedges`).
      hedges: null,
      directives: null,
      ...options,
    };
    this._reset();
  }

  /** True once the first non-empty `analyze()` call has opened the episode. */
  get active() {
    return this._started;
  }

  /**
   * Classify every sentence in `text` and emit one event per sentence, in
   * order. No-op (returns `[]`) for empty/whitespace-only text. `timestamp`
   * is a monotonic ms (mirrors `TypingAggregator.record()`'s convention);
   * `wallTimestamp` is an optional real `Date.now()` reading, used to stamp
   * `window_start` on the FIRST call that opens the episode and as each
   * event's approximate wall-clock `timestamp`.
   */
  analyze(text, { timestamp, wallTimestamp } = {}) {
    if (typeof text !== 'string' || text.trim().length === 0) return [];

    if (!this._started) {
      this._started = true;
      this._startWallClock = Number.isFinite(wallTimestamp) ? wallTimestamp : this.options.now();
    }

    const classifyOptions = this._classifyOptions();
    const rawSentences = splitSentences(text, classifyOptions);
    const wallMs = Number.isFinite(wallTimestamp) ? wallTimestamp : this.options.now();
    const monotonicMs = Number.isFinite(timestamp) ? timestamp : wallMs;

    const emitted = [];
    for (const sentenceText of rawSentences) {
      const { act, matched } = classifySentence(sentenceText, classifyOptions);
      const tokens = extractWords(sentenceText, classifyOptions);
      const index = this._sentenceIndex;
      this._sentenceIndex += 1;

      this._sentenceActs.push({ act, matched });
      for (const token of tokens) this._words.push(token);

      assertKnownState(act);
      const event = {
        modality: MODALITY,
        state: act,
        source: EVENT_SOURCE,
        timestamp: wallMs,
        monotonic_ms: monotonicMs,
        // See class doc: index/words/matched only — never the sentence text.
        detail: { index, words: tokens.length, matched },
      };
      if (typeof this.options.onEvent === 'function') this.options.onEvent(event);
      emitted.push(event);
    }

    this._paragraphCount += countParagraphs(text);
    return emitted;
  }

  /** End the episode and return its window, or `null` if it never opened. */
  finalize({ timestamp } = {}) {
    if (!this._started) return null;

    const metrics = computeTextMetrics({
      sentenceActs: this._sentenceActs,
      words: this._words,
      paragraphCount: this._paragraphCount,
      lang: this.options.lang,
    });

    const window = {
      modality: MODALITY,
      window_kind: 'episode',
      feature_profile: FEATURE_PROFILE,
      window_start: new Date(this._startWallClock).toISOString(),
      window_end: new Date(this.options.now()).toISOString(),
      text: metrics,
      quality: {
        lang: this.options.lang,
        hedges: this.options.hedges ? 'custom' : 'default',
        directives: this.options.directives ? 'custom' : 'default',
        precedence_version: OYON_DISCOURSE_STATES_VERSION,
      },
    };

    this._reset();
    return window;
  }

  _classifyOptions() {
    const opts = { lang: this.options.lang };
    if (this.options.hedges) opts.hedges = this.options.hedges;
    if (this.options.directives) opts.directives = this.options.directives;
    return opts;
  }

  _reset() {
    this._started = false;
    this._startWallClock = null;
    this._sentenceIndex = 0;
    this._sentenceActs = [];
    this._words = [];
    this._paragraphCount = 0;
  }
}

/**
 * Defensive check that every emitted state is a member of the closed,
 * versioned `OYON_DISCOURSE_STATES` vocabulary (`src/version.js`,
 * `discourse-states-v1`) — mirrors `TypingAggregator`'s `assertKnownState`.
 */
function assertKnownState(state) {
  if (!OYON_DISCOURSE_STATES.includes(state)) {
    throw new Error(`DiscourseAggregator: '${state}' is not a member of OYON_DISCOURSE_STATES`);
  }
}
