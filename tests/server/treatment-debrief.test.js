// Regression lock: treatment points/feedback were configured but never surfaced (bug report 2.9.15 #10)
//
// Teachers configure points_if_ordered, feedback_if_ordered and
// feedback_if_missed on case_treatments, and ordering fired a "+points"
// toast — but nothing anywhere summed points_awarded across a session,
// feedback_if_ordered was only ever shown for CONTRAINDICATED orders, and
// no code path computed "expected but not ordered". This suite locks the
// new GET /api/sessions/:id/treatment-debrief endpoint:
//   - total_points = SUM(points_awarded) over the session's orders,
//   - each ordered row carries its stored feedback,
//   - missed = expected+available case_treatments never ordered in the
//     session, WITH their feedback_if_missed,
//   - anti-leak gate: while the session is still active, missed is [] and
//     pending: true — the un-ordered answer key must not leave the server
//     mid-session (the consultant room is reachable before End & Debrief).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'TreatDbrf1!';

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

describe('treatment debrief endpoint (bug report 2.9.15 #10)', () => {
    let server;
    let studentToken;
    let otherToken;
    let sessionId;

    const getDebrief = (token) => fetch(
        `${server.baseUrl}/api/sessions/${sessionId}/treatment-debrief`,
        { headers: { authorization: `Bearer ${token}` } });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const studentId = await seedUser(db, { username: 'tdb-student', role: 'student' });
            await seedUser(db, { username: 'tdb-other', role: 'student' });

            await pRun(db,
                `INSERT INTO treatment_effects (treatment_type, treatment_name, route, description, is_active)
                 VALUES ('medication', 'TDB Aspirinol', 'PO', 'expected, ordered', 1),
                        ('medication', 'TDB Heparinol', 'IV', 'expected, missed', 1),
                        ('medication', 'TDB Neutralol', 'PO', 'neutral, ordered', 1)`);

            const c = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('TDB Case', 1)`);

            // Two expected treatments (one with feedback_if_missed) + one neutral.
            await pRun(db,
                `INSERT INTO case_treatments
                    (case_id, treatment_type, treatment_name, is_available, is_expected, is_contraindicated,
                     points_if_ordered, feedback_if_ordered, feedback_if_missed)
                 VALUES (?, 'medication', 'TDB Aspirinol', 1, 1, 0, 100, 'Good call — aspirin early.', 'Aspirin was indicated.'),
                        (?, 'medication', 'TDB Heparinol', 1, 1, 0, 50, 'Anticoagulation, well done.', 'Anticoagulation was expected.'),
                        (?, 'medication', 'TDB Neutralol', 1, 0, 0, 0, NULL, NULL)`,
                [c.lastID, c.lastID, c.lastID]);

            const s = await pRun(db,
                `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
                 VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)`,
                [c.lastID, studentId]);
            sessionId = s.lastID;

            studentToken = await login(server.baseUrl, 'tdb-student');
            otherToken = await login(server.baseUrl, 'tdb-other');

            // Order the first expected treatment + the neutral one through the
            // real order path so points_awarded/feedback land the way prod
            // writes them. TDB Heparinol is deliberately never ordered.
            const orderTreatment = (name) => fetch(
                `${server.baseUrl}/api/sessions/${sessionId}/order-treatment`,
                {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${studentToken}`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({ treatment_type: 'medication', treatment_name: name, dose: '300', route: 'PO' }),
                });
            const r1 = await orderTreatment('TDB Aspirinol');
            if (r1.status !== 201) throw new Error(`order TDB Aspirinol → ${r1.status}`);
            const r2 = await orderTreatment('TDB Neutralol');
            if (r2.status !== 201) throw new Error(`order TDB Neutralol → ${r2.status}`);
        } finally {
            await closeDb(db);
        }
    }, 90000);

    afterAll(async () => { if (server) await server.close(); });

    it('while the session is active: points + ordered feedback flow, missed stays sealed (pending)', async () => {
        const res = await getDebrief(studentToken);
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.pending).toBe(true);
        expect(body.total_points).toBe(100);
        expect(body.missed).toEqual([]);

        const byName = Object.fromEntries(body.ordered.map((o) => [o.treatment_item, o]));
        expect(byName['TDB Aspirinol'].points_awarded).toBe(100);
        expect(byName['TDB Aspirinol'].feedback).toBe('Good call — aspirin early.');
        expect(byName['TDB Neutralol'].points_awarded).toBe(0);
        // The un-ordered expected treatment must not leak anywhere mid-session.
        expect(JSON.stringify(body)).not.toContain('TDB Heparinol');
    });

    it('another student cannot read the debrief (session ownership)', async () => {
        const res = await getDebrief(otherToken);
        expect(res.status).toBe(403);
    });

    it('once the session is ended: missed contains exactly the un-ordered expected treatment, with its feedback', async () => {
        const db = await openDb(server.dbPath);
        try {
            await pRun(db,
                `UPDATE sessions SET status = 'completed', end_time = CURRENT_TIMESTAMP WHERE id = ?`,
                [sessionId]);
        } finally {
            await closeDb(db);
        }

        const res = await getDebrief(studentToken);
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.pending).toBe(false);
        expect(body.total_points).toBe(100);
        expect(body.missed).toEqual([
            { treatment_name: 'TDB Heparinol', feedback_if_missed: 'Anticoagulation was expected.' },
        ]);
    });
});
