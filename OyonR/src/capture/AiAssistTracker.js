/**
 * AiAssistTracker — a thin HOST-FACING emitter for the AI-suggestion cycle
 * (`modality: 'ai_assist'`). This is deliberately NOT a DOM listener: unlike
 * `TypingComposerAdapter`, there is no browser event Oyon can observe to
 * learn that a suggestion was offered, shown, accepted, rejected, or
 * dismissed — only the host (Rohy / ChatOyon) knows that, because the host is
 * the one that called the AI and rendered the result. See audio_text.md
 * §4.10 and the class doc on `AiAssistAggregator` for why this stream cannot
 * be derived and why it matters: an insertion of 200 graphemes in 40ms in the
 * typing log is an accepted AI suggestion, not fast typing, and a model
 * trained on undifferentiated `insert` events cannot tell the difference
 * without this stream.
 *
 * The host calls the seven methods below at the seven points in its own
 * suggestion-cycle code (request the AI, render the result, learner accepts/
 * rejects/dismisses it, AI turn starts/ends). Each call synthesizes exactly
 * one event object drawn from the closed, versioned `OYON_AI_ASSIST_STATES`
 * vocabulary (`src/version.js`, `ai-assist-states-v1`) and hands it to the
 * caller-supplied `onEvent` callback — mirroring `TypingAggregator`'s
 * `onEvent` contract. This class does not own a per-event log; wiring
 * emitted events into one (e.g. `SignalEventLog`) is the caller's job.
 *
 * ---- source assignment ----
 *
 * `OYON_EVENT_SOURCES` is `'user' | 'ai' | 'system'`. This class assigns:
 *   - `suggestion_request`, `suggestion_shown`, `ai_turn_start`,
 *     `ai_turn_end` -> `source: 'ai'`. These four describe the AI pipeline's
 *     own activity (asking the model, presenting what it returned, and the
 *     AI conversational turn boundary) — the learner has not yet acted.
 *   - `suggestion_accept`, `suggestion_reject`, `suggestion_dismiss` ->
 *     `source: 'user'`. These three are LEARNER decisions about a suggestion
 *     the AI already produced — accepting, explicitly rejecting, or
 *     dismissing it are all things the human writer does, not the model.
 * This is the split audio_text.md §3.6/§4.10 calls out as "the distinction
 * CoAuthor makes and the one that makes human-AI co-writing analyzable at
 * all" — collapsing all seven states to `source: 'ai'` (a literal reading of
 * the one-line summary in §4.10) would erase exactly the accept/reject signal
 * this modality exists to carry, so this class deliberately does not do that.
 *
 * ---- never the suggestion text ----
 *
 * Every method below throws if its descriptor carries a `text`, `content`,
 * `suggestion`, or `body` field. This is a REDUNDANCY rule, not a privacy
 * rule (see CLAUDE.md's "research-grade: record everything, expose
 * everything" data policy, which is explicit that Oyon is not a privacy
 * gatekeeper) — the host already stores the suggestion text as its own
 * record of the conversation, so carrying a second copy inside a signal
 * event would just be a second copy to keep consistent, for no analytic
 * gain. Compare `FORBIDDEN_TYPING_FIELDS` in
 * `src/validation/validateEmotionPayload.js`, which enforces the identical
 * rule for the composed message text.
 *
 * ---- latency measurement ----
 *
 * `latency_ms` on `suggestion_shown` is measured by THIS class, not
 * supplied by the host: `requested()` records the monotonic time per
 * `suggestion_id`, and `shown()` computes the elapsed time when the same
 * `suggestion_id` reappears. A `shown()` with no matching prior `requested()`
 * (host called `shown()` alone, or the matching request already aged out of
 * `maxPendingRequests`) degrades gracefully to `latency_ms: null` — it never
 * throws for this reason, only for the forbidden-field violation above.
 */

import { OYON_AI_ASSIST_STATES } from '../version.js';

const MODALITY = 'ai_assist';
const SOURCE_AI = 'ai';
const SOURCE_USER = 'user';

/**
 * Redundancy check, not a privacy gate — see class doc comment. Applied to
 * every method's descriptor so a host cannot smuggle the suggestion text
 * (under any of its plausible field names) into a signal event.
 */
const FORBIDDEN_DESCRIPTOR_FIELDS = ['text', 'content', 'suggestion', 'body'];

// Bounds the `_pendingRequests` map (one entry per `requested()` call whose
// `shown()`/cleanup has not yet arrived) — a transport/memory bound, not a
// privacy measure, mirroring the length caps elsewhere in this codebase
// (e.g. `TypingAggregator`'s `maxIntervals`). A host that calls `requested()`
// far more often than `shown()`/`accepted()`/`rejected()`/`dismissed()`
// (which all clear the entry) would otherwise leak memory for the life of
// the tracker.
const DEFAULT_MAX_PENDING_REQUESTS = 1000;

export function createAiAssistTracker(options = {}) {
  const resolvedOptions = {
    onEvent: null,
    now: defaultMonotonicNow,
    wallClockNow: defaultWallClockNow,
    maxPendingRequests: DEFAULT_MAX_PENDING_REQUESTS,
    ...options,
  };

  // suggestion_id -> monotonic ms at requested() time. Insertion order is
  // eviction order (oldest first) via Map's guaranteed iteration order.
  const pendingRequests = new Map();
  let disposed = false;

  function assertNoForbiddenFields(descriptor, methodName) {
    if (!descriptor || typeof descriptor !== 'object') return;
    for (const field of FORBIDDEN_DESCRIPTOR_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(descriptor, field)) {
        throw new Error(
          `AiAssistTracker.${methodName}(): descriptor must not carry "${field}" — the host already `
          + 'stores the suggestion text; Oyon only carries request/response metadata. This is a '
          + 'redundancy rule, not a privacy rule (see CLAUDE.md\'s "research-grade" data policy).',
        );
      }
    }
  }

  function rememberRequest(suggestionId) {
    if (suggestionId === null || suggestionId === undefined) return;
    pendingRequests.set(suggestionId, resolvedOptions.now());
    while (pendingRequests.size > resolvedOptions.maxPendingRequests) {
      const oldestKey = pendingRequests.keys().next().value;
      pendingRequests.delete(oldestKey);
    }
  }

  /** Consume (and remove) the pending request time for `suggestionId`, or `null` if there was none. */
  function takeLatencyMs(suggestionId) {
    if (suggestionId === null || suggestionId === undefined) return null;
    if (!pendingRequests.has(suggestionId)) return null;
    const requestedAt = pendingRequests.get(suggestionId);
    pendingRequests.delete(suggestionId);
    return Math.max(0, resolvedOptions.now() - requestedAt);
  }

  /** Drop any lingering correlation entry without computing a latency from it. */
  function forgetRequest(suggestionId) {
    if (suggestionId === null || suggestionId === undefined) return;
    pendingRequests.delete(suggestionId);
  }

  function assertKnownState(state) {
    if (!OYON_AI_ASSIST_STATES.includes(state)) {
      throw new Error(`AiAssistTracker: '${state}' is not a member of OYON_AI_ASSIST_STATES`);
    }
  }

  /** Build, dispatch (if `onEvent` is configured), and return one event. No-op after `dispose()`. */
  function dispatch(state, source, detail) {
    if (disposed) return null;
    assertKnownState(state);
    const event = {
      modality: MODALITY,
      state,
      source,
      timestamp: resolvedOptions.wallClockNow(),
      monotonic_ms: resolvedOptions.now(),
      detail,
    };
    if (typeof resolvedOptions.onEvent === 'function') resolvedOptions.onEvent(event);
    return event;
  }

  /** The host asked the AI for a suggestion. Starts the request->shown latency clock for `suggestion_id`. */
  function requested(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'requested');
    if (disposed) return null;
    const { suggestion_id = null, model = null } = descriptor;
    rememberRequest(suggestion_id);
    return dispatch('suggestion_request', SOURCE_AI, { suggestion_id, model });
  }

  /**
   * The AI's suggestion(s) were rendered to the learner. `latency_ms` is
   * measured against the matching `requested()` call for the same
   * `suggestion_id`; `null` (not a throw) when there is no match.
   */
  function shown(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'shown');
    if (disposed) return null;
    const { suggestion_id = null, options_shown = null, model = null } = descriptor;
    const latencyMs = takeLatencyMs(suggestion_id);
    return dispatch('suggestion_shown', SOURCE_AI, {
      suggestion_id,
      options_shown,
      latency_ms: latencyMs,
      model,
    });
  }

  /** The learner accepted a suggestion — a learner decision, `source: 'user'`. */
  function accepted(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'accepted');
    if (disposed) return null;
    const { suggestion_id = null, chosen_index = null, accepted_graphemes = null, model = null } = descriptor;
    forgetRequest(suggestion_id);
    return dispatch('suggestion_accept', SOURCE_USER, {
      suggestion_id,
      chosen_index,
      accepted_graphemes,
      model,
    });
  }

  /** The learner explicitly rejected a suggestion (e.g. kept typing over it) — `source: 'user'`. */
  function rejected(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'rejected');
    if (disposed) return null;
    const { suggestion_id = null, chosen_index = null, model = null } = descriptor;
    forgetRequest(suggestion_id);
    return dispatch('suggestion_reject', SOURCE_USER, { suggestion_id, chosen_index, model });
  }

  /** The learner dismissed a suggestion without engaging it (e.g. Escape, clicked away) — `source: 'user'`. */
  function dismissed(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'dismissed');
    if (disposed) return null;
    const { suggestion_id = null, model = null } = descriptor;
    forgetRequest(suggestion_id);
    return dispatch('suggestion_dismiss', SOURCE_USER, { suggestion_id, model });
  }

  /** An AI conversational turn began — `source: 'ai'`. */
  function aiTurnStart(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'aiTurnStart');
    if (disposed) return null;
    const { model = null } = descriptor;
    return dispatch('ai_turn_start', SOURCE_AI, { model });
  }

  /** An AI conversational turn ended — `source: 'ai'`. */
  function aiTurnEnd(descriptor = {}) {
    assertNoForbiddenFields(descriptor, 'aiTurnEnd');
    if (disposed) return null;
    const { model = null } = descriptor;
    return dispatch('ai_turn_end', SOURCE_AI, { model });
  }

  /** Stop emitting. Idempotent. Drops the pending-request correlation map; does not finalize anything. */
  function dispose() {
    disposed = true;
    pendingRequests.clear();
  }

  return {
    requested,
    shown,
    accepted,
    rejected,
    dismissed,
    aiTurnStart,
    aiTurnEnd,
    dispose,
    get active() { return !disposed; },
  };
}

function defaultMonotonicNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function defaultWallClockNow() {
  return Date.now();
}
