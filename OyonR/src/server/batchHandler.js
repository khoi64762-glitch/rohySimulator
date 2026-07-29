import { validateEmotionBatch } from '../validation/validateEmotionPayload.js';

/**
 * createOyonBatchHandler — framework-neutral receiver for Oyon window batches.
 *
 * This is the server-side other half of the client transport. It encapsulates
 * the generic batch contract once so every backend (Express, Fastify, Hono,
 * Next.js route handler, plain Node http) shares the same auth → shape-check →
 * session-pin → persist pipeline. You supply only the two host-specific pieces:
 * `persist` (write to YOUR store) and, optionally, `verifyToken` (validate YOUR
 * platform's auth). Oyon never imports a DB client — the anti-coupling boundary
 * in docs/ARCHITECTURE.md forbids it — so the persistence call is always yours.
 *
 * Contract (matches the client HttpEmotionTransport):
 *   POST body  { events: [ <window payload>, … ] }
 *   200        { ok: true, inserted }
 *   400        { error: 'invalid_batch', details }   — failed shape/size check
 *   401        { error: 'unauthorized' }             — verifyToken returned falsy
 *   403        { error: 'session_mismatch' }         — an event's session_id ≠ route
 *   500        { error: 'persist_failed' }           — persist() threw
 *
 * The returned handler is transport-agnostic: it takes a plain
 * `{ body, sessionId, authorization }` and returns a plain `{ status, body }`.
 * Wrap it for your framework (see `createOyonExpressBatch`) or call it directly.
 *
 * @param {object} options
 * @param {(args: { events: object[], sessionId: string|null, auth: unknown }) =>
 *          (number|void|Promise<number|void>)} options.persist
 *          REQUIRED. Idempotently write the events to your store (dedupe on
 *          session_id + record_id — the client retries failed batches). Return
 *          the inserted count if you have it; otherwise the event count is used.
 * @param {(authorization: string|null) => (unknown|Promise<unknown>)} [options.verifyToken]
 *          Validate the Authorization header. Return a truthy auth object to
 *          allow, falsy to 401. Omit entirely for local/no-auth backends.
 * @param {number} [options.maxBatchEvents=64] max events per batch (shape guard).
 * @param {boolean} [options.pinSessionId=true] reject batches whose events carry
 *          a session_id different from the route's. This enforces route/payload
 *          consistency; `verifyToken` or host middleware must separately
 *          authorize the caller for that route session. Disable only if you
 *          route without a session id.
 * @returns {(req: { body: unknown, sessionId?: string|null, authorization?: string|null })
 *            => Promise<{ status: number, body: object }>}
 */
export function createOyonBatchHandler(options = {}) {
  const {
    persist,
    verifyToken,
    maxBatchEvents = 64,
    pinSessionId = true,
  } = options;

  if (typeof persist !== 'function') {
    throw new TypeError('createOyonBatchHandler requires a persist(...) function.');
  }

  return async function handleOyonBatch({ body, sessionId = null, authorization = null } = {}) {
    // 1. Auth — only when the host opted in with verifyToken.
    let auth = null;
    if (typeof verifyToken === 'function') {
      auth = await verifyToken(authorization);
      if (!auth) return { status: 401, body: { error: 'unauthorized' } };
    }

    // 2. Shape/size sanity — mirrors the client deny-list (no frames/landmarks/
    //    raw points). Transport hygiene, NOT a research-signal gate.
    const result = validateEmotionBatch(body, { maxBatchEvents });
    if (!result.ok) {
      return { status: 400, body: { error: 'invalid_batch', details: result.errors } };
    }

    // 3. Pin the payload's session_id to the route. This prevents a body/route
    //    mismatch; authorization for that route session remains the host's job.
    let events = body.events;
    if (pinSessionId && sessionId != null) {
      const pinned = events.filter((event) => event.session_id === sessionId);
      if (pinned.length !== events.length) {
        return { status: 403, body: { error: 'session_mismatch' } };
      }
      events = pinned;
    }

    // 4. Persist — host's idempotent write.
    try {
      const inserted = await persist({ events, sessionId, auth });
      return {
        status: 200,
        body: { ok: true, inserted: typeof inserted === 'number' ? inserted : events.length },
      };
    } catch {
      return {
        status: 500,
        body: { error: 'persist_failed' },
      };
    }
  };
}
