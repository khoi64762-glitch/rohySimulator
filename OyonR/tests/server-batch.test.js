// Server batch adapter — createOyonBatchHandler (framework-neutral core) +
// createOyonExpressBatch (Express wrapper). Plain node, throws on failure.
import assert from 'node:assert/strict';
import { createOyonBatchHandler } from '../src/server/batchHandler.js';
import { createOyonExpressBatch } from '../src/server/express.js';

// Minimal event that passes validateEmotionBatch's shape check.
function evt(overrides = {}) {
  return {
    session_id: 's1',
    window_start: '2026-07-19T00:00:00.000Z',
    window_end: '2026-07-19T00:00:05.000Z',
    confidence: 0.9,
    valid_frames: 10,
    missing_face_ratio: 0.1,
    ...overrides,
  };
}

// --- construction guard ---------------------------------------------------
assert.throws(
  () => createOyonBatchHandler({}),
  /requires a persist/,
  'missing persist must throw',
);

// --- happy path: valid batch persists and returns 200 ---------------------
{
  let seen = null;
  const handle = createOyonBatchHandler({
    persist: (args) => {
      seen = args;
      return undefined; // no explicit count -> falls back to events.length
    },
  });
  const res = await handle({ body: { events: [evt(), evt()] }, sessionId: 's1' });
  assert.equal(res.status, 200, 'valid batch -> 200');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.inserted, 2, 'inserted falls back to event count');
  assert.equal(seen.events.length, 2, 'persist receives the events');
  assert.equal(seen.sessionId, 's1');
  assert.equal(seen.auth, null, 'no verifyToken -> auth null');
}

// --- persist may report its own inserted count ----------------------------
{
  const handle = createOyonBatchHandler({ persist: () => 1 });
  const res = await handle({ body: { events: [evt(), evt()] }, sessionId: 's1' });
  assert.equal(res.body.inserted, 1, 'explicit persist count is used');
}

// --- invalid shape -> 400 (no persist call) -------------------------------
{
  let called = false;
  const handle = createOyonBatchHandler({ persist: () => { called = true; } });
  const res = await handle({ body: { events: 'nope' }, sessionId: 's1' });
  assert.equal(res.status, 400, 'bad shape -> 400');
  assert.equal(res.body.error, 'invalid_batch');
  assert.ok(Array.isArray(res.body.details));
  assert.equal(called, false, 'persist not called on invalid batch');
}

// --- auth: verifyToken falsy -> 401 (no persist) --------------------------
{
  let called = false;
  const handle = createOyonBatchHandler({
    verifyToken: () => null,
    persist: () => { called = true; },
  });
  const res = await handle({ body: { events: [evt()] }, sessionId: 's1', authorization: 'Bearer x' });
  assert.equal(res.status, 401, 'falsy verifyToken -> 401');
  assert.equal(called, false, 'persist not called when unauthorized');
}

// --- auth: verifyToken truthy is passed through to persist ----------------
{
  let seenAuth;
  const handle = createOyonBatchHandler({
    verifyToken: (h) => (h === 'Bearer good' ? { userId: 'u1' } : null),
    persist: ({ auth }) => { seenAuth = auth; },
  });
  const res = await handle({ body: { events: [evt()] }, sessionId: 's1', authorization: 'Bearer good' });
  assert.equal(res.status, 200);
  assert.deepEqual(seenAuth, { userId: 'u1' }, 'auth object reaches persist');
}

// --- session pinning: mismatch -> 403 -------------------------------------
{
  let called = false;
  const handle = createOyonBatchHandler({ persist: () => { called = true; } });
  const res = await handle({ body: { events: [evt({ session_id: 'other' })] }, sessionId: 's1' });
  assert.equal(res.status, 403, 'session_id != route -> 403');
  assert.equal(res.body.error, 'session_mismatch');
  assert.equal(called, false, 'persist not called on mismatch');
}

// --- session pinning disabled -> no filtering -----------------------------
{
  let seen = null;
  const handle = createOyonBatchHandler({ pinSessionId: false, persist: (a) => { seen = a; } });
  const res = await handle({ body: { events: [evt({ session_id: 'whatever' })] }, sessionId: 's1' });
  assert.equal(res.status, 200, 'pinSessionId:false accepts mismatched session_id');
  assert.equal(seen.events.length, 1);
}

// --- persist throws -> 500 ------------------------------------------------
{
  const handle = createOyonBatchHandler({
    persist: () => { throw new Error('postgres://admin:secret@db.internal/private'); },
  });
  const res = await handle({ body: { events: [evt()] }, sessionId: 's1' });
  assert.equal(res.status, 500, 'persist throw -> 500');
  assert.deepEqual(res.body, { error: 'persist_failed' });
}

// --- Express wrapper: maps req -> handler -> res.status().json() -----------
{
  const handler = createOyonExpressBatch({ persist: () => 2 });
  const req = { body: { events: [evt(), evt()] }, params: { sessionId: 's1' }, headers: {} };
  let statusCode;
  let jsonBody;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { jsonBody = body; return this; },
  };
  await handler(req, res);
  assert.equal(statusCode, 200, 'express wrapper sets status');
  assert.equal(jsonBody.ok, true);
  assert.equal(jsonBody.inserted, 2);
}

// --- Express wrapper: custom sessionParam ---------------------------------
{
  let seen = null;
  const handler = createOyonExpressBatch({ sessionParam: 'attempt', persist: (a) => { seen = a; } });
  const req = { body: { events: [evt({ session_id: 'a9' })] }, params: { attempt: 'a9' }, headers: {} };
  const res = { status() { return this; }, json() { return this; } };
  await handler(req, res);
  assert.equal(seen.sessionId, 'a9', 'custom sessionParam is read from params');
}

console.log('server-batch.test.js passed');
