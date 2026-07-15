// Shared HTTP + user-seeding helpers for server tests.
//
// Sixteen server test files each hand-roll the same four functions (open the
// sqlite file, insert a user with a bcrypt hash, POST /auth/login, build a
// fetch wrapper that carries the bearer token). This module is that boilerplate,
// once. It does NOT replace the copies already living in those files — it is
// here so new suites stop adding to the pile.
//
// Pairs with startTestServer(): the server owns the DB file, and these helpers
// write to it directly, which is deliberate. Seeding a user over HTTP would run
// through the very registration policy several of these suites exist to test.
//
//   const server = await startTestServer();
//   const db = await openDb(server.dbPath);
//   await seedUser(db, { username: 'alice', role: 'student' });
//   const alice = await asUser(server.baseUrl, 'alice');
//   const res = await alice('/api/cases');

import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';

/** The password every seeded user gets. Satisfies the platform policy
 *  (>=8 chars, upper, lower, digit) so a login test never fails for the
 *  wrong reason. */
export const TEST_PASSWORD = 'TestPassw0rd';

export function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => (err ? reject(err) : resolve(db)));
    });
}

export function closeDb(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

export function run(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) {
            if (err) reject(err); else resolve(this);
        })
    );
}

export function get(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
    );
}

export function all(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))
    );
}

/**
 * Insert an active user straight into the DB and return its id.
 * bcrypt cost 4 — these hashes are thrown away when the temp DB is deleted,
 * and cost 10 × dozens of users is most of a suite's runtime.
 */
export async function seedUser(db, opts = {}) {
    const {
        username,
        role = 'student',
        tenantId = 1,
        status = 'active',
        password = TEST_PASSWORD,
        email = `${username}@example.com`,
    } = opts;

    const hash = await bcrypt.hash(password, 4);
    const r = await run(
        db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [username, username, email, hash, role, tenantId, status]
    );
    return r.lastID;
}

/** POST /auth/login and return the raw JWT. Throws with the body on failure,
 *  so a broken login shows up as a readable error instead of `undefined token`. */
export async function login(baseUrl, username, password = TEST_PASSWORD) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
        throw new Error(`login(${username}) -> ${res.status}: ${await res.text()}`);
    }
    return (await res.json()).token;
}

/**
 * A fetch bound to one user's bearer token. Paths are absolute-from-root
 * (`/api/cases`); JSON bodies may be passed as objects.
 *
 *   const admin = authed(baseUrl, token);
 *   await admin('/api/registration-invites', { method: 'POST', json: { role: 'student' } });
 */
export function authed(baseUrl, token) {
    return (path, init = {}) => {
        const { json, headers: extra, ...rest } = init;
        const headers = { authorization: `Bearer ${token}`, ...(extra || {}) };
        let body = rest.body;
        if (json !== undefined) {
            body = JSON.stringify(json);
            headers['content-type'] = headers['content-type'] || 'application/json';
        } else if (body && !headers['content-type']) {
            headers['content-type'] = 'application/json';
        }
        return fetch(`${baseUrl}${path}`, { ...rest, headers, body });
    };
}

/** login() + authed() in one step — the shape almost every test wants. */
export async function asUser(baseUrl, username, password = TEST_PASSWORD) {
    const token = await login(baseUrl, username, password);
    const call = authed(baseUrl, token);
    call.token = token;
    return call;
}

/** Register over HTTP. Returns {status, body} rather than throwing, because
 *  the interesting registration tests are the ones that get a 4xx. */
export async function register(baseUrl, payload) {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    let body = null;
    try { body = await res.json(); } catch { /* empty or non-JSON body */ }
    return { status: res.status, body };
}
