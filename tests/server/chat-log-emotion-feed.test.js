// Regression lock: log feeds queried nonexistent el.created_at; allP swallowed the error (bug report 2.9.15 #19)
//
// emotion_logs has a `timestamp` column (0001_initial.sql), not `created_at`.
// Both admin log feeds (/api/chat-log/feed and /api/system-log/feed) selected
// `el.created_at`, the per-source query errored, and the allP helper resolved
// the error to [] — so self-reported emotions were stored but appeared
// nowhere. This suite seeds a real emotion_logs row and asserts it surfaces
// in both feeds, and that GET /api/emotion-logs is tenant-scoped.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'EmotionFeedT1!';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function closeDb(db) { return new Promise((r) => db.close(() => r())); }
function pRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
async function seedUser(db, { username, role, tenant = 1 }) {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pRun(db,
        `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [username, username, `${username}@example.com`, hash, role, tenant]);
    return r.lastID;
}
async function login(baseUrl, username) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: PASSWORD }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}`);
    return (await res.json()).token;
}

describe('emotion_logs in the admin log feeds (bug report 2.9.15 #19)', () => {
    let server;
    let adminToken;
    let sessionId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            await seedUser(db, { username: 'ef-admin', role: 'admin' });
            const studentId = await seedUser(db, { username: 'ef-student', role: 'student' });
            const t2Student = await seedUser(db, { username: 'ef-t2-student', role: 'student', tenant: 2 });

            const c = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('Emotion Case', 1)`);
            const s = await pRun(db,
                `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
                 VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)`,
                [c.lastID, studentId]);
            sessionId = s.lastID;

            // The row under test: a tenant-1 self-reported emotion.
            await pRun(db,
                `INSERT INTO emotion_logs (session_id, user_id, case_id, emotion, tenant_id)
                 VALUES (?, ?, ?, 'anxious-t1', 1)`,
                [sessionId, studentId, c.lastID]);
            // A tenant-2 row that must NOT leak into tenant-1 reads.
            await pRun(db,
                `INSERT INTO emotion_logs (session_id, user_id, case_id, emotion, tenant_id)
                 VALUES (NULL, ?, NULL, 'leaky-t2', 2)`,
                [t2Student]);

            adminToken = await login(server.baseUrl, 'ef-admin');
        } finally {
            await closeDb(db);
        }
    }, 90000);

    afterAll(async () => { if (server) await server.close(); });

    const get = (path) => fetch(`${server.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${adminToken}` },
    });

    it('chat-log feed returns the stored emotion row (el.timestamp, not el.created_at)', async () => {
        const res = await get('/api/chat-log/feed?limit=200');
        expect(res.status).toBe(200);
        const body = await res.json();
        const emotionRows = body.events.filter((e) => e.source === 'emotion');
        expect(emotionRows.length).toBeGreaterThanOrEqual(1);
        const row = emotionRows.find((e) => e.content === 'anxious-t1');
        expect(row).toBeTruthy();
        expect(row.ts).toBeTruthy();               // aliased from el.timestamp
        expect(row.session_id).toBe(sessionId);
        expect(row.username).toBe('ef-student');
        expect(body.sources.emotion).toBeGreaterThanOrEqual(1);
        // Tenant scoping of the feed itself.
        expect(body.events.some((e) => e.content === 'leaky-t2')).toBe(false);
    });

    it('system-log feed returns the stored emotion row', async () => {
        const res = await get('/api/system-log/feed?limit=200');
        expect(res.status).toBe(200);
        const body = await res.json();
        const row = (body.events || []).find(
            (e) => e.component === 'emotion' && e.event === 'anxious-t1');
        expect(row).toBeTruthy();
        expect(row.ts).toBeTruthy();
        expect((body.events || []).some((e) => e.event === 'leaky-t2')).toBe(false);
    });

    it('GET /api/emotion-logs is tenant-scoped', async () => {
        const res = await get('/api/emotion-logs');
        expect(res.status).toBe(200);
        const rows = await res.json();
        expect(rows.some((r) => r.emotion === 'anxious-t1')).toBe(true);
        expect(rows.some((r) => r.emotion === 'leaky-t2')).toBe(false);
    });

    it('POST /api/emotion-logs stamps the caller tenant', async () => {
        const post = await fetch(`${server.baseUrl}/api/emotion-logs`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${adminToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ session_id: sessionId, emotion: 'posted-t1' }),
        });
        expect(post.status).toBe(200);
        const rows = await (await get('/api/emotion-logs')).json();
        expect(rows.some((r) => r.emotion === 'posted-t1')).toBe(true);
    });
});
