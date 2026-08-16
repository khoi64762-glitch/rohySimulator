// Regression lock: order-treatment accepted hidden and free-text treatments and replayed points; the debrief graded against the LIVE rubric (adversarial review of v2.9.37)
//
// POST /api/sessions/:id/order-treatment used to:
//   - accept a treatment the educator HID for the case (case_treatments
//     is_available = 0) — the student panel never listed it, but the
//     endpoint inserted it happily;
//   - insert ANY treatment_name — catalogue row or not — so a free-text
//     order landed in the MAR;
//   - award points_if_ordered on EVERY repeat of an expected treatment,
//     and the debrief summed all rows → unlimited point replay.
// And GET /api/sessions/:id/treatment-debrief read expected / missed from
// the LIVE case_treatments rows, so an educator editing the rubric after a
// session ran rewrote that session's history.
//
// This suite locks:
//   - hidden treatment → 409 TREATMENT_UNAVAILABLE,
//   - unknown treatment → 404 TREATMENT_UNKNOWN,
//   - a treatment picked from GET available-treatments still orders (201),
//   - a repeat orders (201) with repeat: true and points_awarded 0, and the
//     debrief total does not move,
//   - the rubric is pinned at session start: editing case_treatments after
//     the session started changes neither the debrief nor what the order
//     path grades,
//   - a session written before the snapshot existed falls back to the live
//     rows (the historical behaviour).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'OrdGuard1!';

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
function pGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
    );
}
async function withDb(dbPath, work) {
    const db = await openDb(dbPath);
    try { return await work(db); } finally { await closeDb(db); }
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

describe('order-treatment guards + snapshot-pinned treatment rubric', () => {
    let server;
    let studentToken;
    let studentId;
    let caseId;
    let sessionId; // created through POST /sessions → carries the rubric snapshot

    const api = (path, { method = 'GET', body } = {}) => fetch(`${server.baseUrl}/api${path}`, {
        method,
        headers: {
            authorization: `Bearer ${studentToken}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const order = (sid, treatment_name, extra = {}) => api(`/sessions/${sid}/order-treatment`, {
        method: 'POST',
        body: { treatment_type: 'medication', treatment_name, dose: '1 mg', route: 'IV', ...extra },
    });
    const debrief = (sid) => api(`/sessions/${sid}/treatment-debrief`);
    const endSession = (sid) => withDb(server.dbPath, (db) => pRun(db,
        `UPDATE sessions SET status = 'completed', end_time = CURRENT_TIMESTAMP WHERE id = ?`, [sid]));

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        await withDb(server.dbPath, async (db) => {
            studentId = await seedUser(db, { username: 'og-student', role: 'student' });

            await pRun(db,
                `INSERT INTO treatment_effects (treatment_type, treatment_name, route, description, is_active)
                 VALUES ('medication', 'OG Aspirinol', 'PO', 'expected 100', 1),
                        ('medication', 'OG Heparinol', 'IV', 'expected 50', 1),
                        ('medication', 'OG Hiddenol', 'IV', 'hidden for this case', 1),
                        ('medication', 'OG Neutralol', 'PO', 'catalogue, no rubric row', 1)`);

            const c = await pRun(db, `INSERT INTO cases (name, tenant_id, is_available, is_default) VALUES ('OG Case', 1, 1, 1)`);
            caseId = c.lastID;

            await pRun(db,
                `INSERT INTO case_treatments
                    (case_id, treatment_type, treatment_name, is_available, is_expected, is_contraindicated,
                     points_if_ordered, feedback_if_ordered, feedback_if_missed)
                 VALUES (?, 'medication', 'OG Aspirinol', 1, 1, 0, 100, 'Good — aspirin.', 'Aspirin was indicated.'),
                        (?, 'medication', 'OG Heparinol', 1, 1, 0, 50, 'Good — heparin.', 'Heparin was expected.'),
                        (?, 'medication', 'OG Hiddenol', 0, 0, 0, 0, NULL, NULL)`,
                [caseId, caseId, caseId]);
        });

        studentToken = await login(server.baseUrl, 'og-student');

        // Real session start so the rubric snapshot is written.
        const start = await api('/sessions', { method: 'POST', body: { case_id: caseId } });
        if (start.status !== 200) throw new Error(`POST /sessions → ${start.status}`);
        sessionId = (await start.json()).id;
    }, 90000);

    afterAll(async () => { if (server) await server.close(); });

    it('session start pins the case_treatments rubric into session_settings.settings_snapshot (server-only, not case_snapshot)', async () => {
        const row = await withDb(server.dbPath, (db) => pGet(db,
            'SELECT settings_snapshot FROM session_settings WHERE session_id = ?', [sessionId]));
        const snap = JSON.parse(row.settings_snapshot);
        expect(Array.isArray(snap.case_treatments)).toBe(true);
        expect(snap.case_treatments.map((t) => t.treatment_name).sort())
            .toEqual(['OG Aspirinol', 'OG Heparinol', 'OG Hiddenol']);
        expect(snap.case_treatments_snapshot_at).toBeTruthy();

        // The answer key must NOT ride along in the learner-visible session row.
        const res = await api(`/sessions/${sessionId}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(JSON.stringify(body)).not.toContain('Aspirin was indicated.');
        expect(JSON.stringify(body)).not.toContain('points_if_ordered');
    });

    it('a treatment hidden for the case is rejected: 409 TREATMENT_UNAVAILABLE', async () => {
        const res = await order(sessionId, 'OG Hiddenol');
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe('TREATMENT_UNAVAILABLE');
        expect(typeof body.error).toBe('string');
    });

    it('a name in no catalogue is rejected: 404 TREATMENT_UNKNOWN', async () => {
        const res = await order(sessionId, 'OG Madeupol 500 mg');
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.code).toBe('TREATMENT_UNKNOWN');

        // Nothing landed in the MAR.
        const mar = await (await api(`/sessions/${sessionId}/treatment-orders`)).json();
        expect((mar.orders || []).length).toBe(0);
    });

    it('a treatment picked from GET available-treatments still orders (201), free-text dose/route kept', async () => {
        const list = await (await api(`/sessions/${sessionId}/available-treatments`)).json();
        const meds = list.treatments.medication;
        const names = meds.map((t) => t.treatment_name);
        expect(names).toContain('OG Aspirinol');
        expect(names).toContain('OG Neutralol'); // catalogue-only, no rubric row
        expect(names).not.toContain('OG Hiddenol'); // hidden rows never reach students

        const picked = meds.find((t) => t.treatment_name === 'OG Neutralol');
        const res = await order(sessionId, picked.treatment_name, { dose: '2 tabs', route: 'sublingual (custom)' });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.repeat).toBe(false);
        expect(body.points_awarded).toBe(0);
        expect(body.is_expected).toBe(false);

        const mar = await (await api(`/sessions/${sessionId}/treatment-orders`)).json();
        const row = mar.orders.find((o) => o.treatment_item === 'OG Neutralol');
        expect(row.dose).toBe('2 tabs');
        expect(row.route).toBe('sublingual (custom)');
    });

    it('an expected treatment awards points once; a repeat is 201 with repeat: true and points_awarded 0, debrief total unchanged', async () => {
        const first = await order(sessionId, 'OG Aspirinol');
        expect(first.status).toBe(201);
        const b1 = await first.json();
        expect(b1.repeat).toBe(false);
        expect(b1.is_expected).toBe(true);
        expect(b1.points_awarded).toBe(100);

        const second = await order(sessionId, 'OG Aspirinol');
        expect(second.status).toBe(201);
        const b2 = await second.json();
        expect(b2.repeat).toBe(true);
        expect(b2.points_awarded).toBe(0);
        // Formative feedback still flows on the repeat — only the score is one-shot.
        expect(b2.is_expected).toBe(true);

        const third = await order(sessionId, 'OG Aspirinol');
        expect((await third.json()).points_awarded).toBe(0);

        const d = await (await debrief(sessionId)).json();
        expect(d.total_points).toBe(100);
        // The MAR keeps every order (three rows), the score does not replay.
        const mar = await (await api(`/sessions/${sessionId}/treatment-orders`)).json();
        expect(mar.orders.filter((o) => o.treatment_item === 'OG Aspirinol').length).toBe(3);
    });

    it('editing the rubric AFTER the session started changes neither the order grading nor the debrief (snapshot wins)', async () => {
        // Educator rewrites the case: heparin no longer expected, aspirin worth 999,
        // a brand-new expected treatment appears, and hidden-ol becomes visible.
        await withDb(server.dbPath, async (db) => {
            await pRun(db, `UPDATE case_treatments SET is_expected = 0, feedback_if_missed = NULL WHERE case_id = ? AND treatment_name = 'OG Heparinol'`, [caseId]);
            await pRun(db, `UPDATE case_treatments SET points_if_ordered = 999 WHERE case_id = ? AND treatment_name = 'OG Aspirinol'`, [caseId]);
            await pRun(db, `UPDATE case_treatments SET is_available = 1 WHERE case_id = ? AND treatment_name = 'OG Hiddenol'`, [caseId]);
            await pRun(db,
                `INSERT INTO case_treatments (case_id, treatment_type, treatment_name, is_available, is_expected, points_if_ordered, feedback_if_missed)
                 VALUES (?, 'medication', 'OG Neutralol', 1, 1, 77, 'Added after the fact.')`, [caseId]);
        });

        // Order path still grades against the pinned rubric: hidden stays hidden…
        const hidden = await order(sessionId, 'OG Hiddenol');
        expect(hidden.status).toBe(409);
        expect((await hidden.json()).code).toBe('TREATMENT_UNAVAILABLE');
        // …and the listing the learner sees agrees with it.
        const list = await (await api(`/sessions/${sessionId}/available-treatments`)).json();
        expect(list.treatments.medication.map((t) => t.treatment_name)).not.toContain('OG Hiddenol');

        await endSession(sessionId);
        const d = await (await debrief(sessionId)).json();
        expect(d.pending).toBe(false);
        expect(d.total_points).toBe(100); // not 999, not +77
        // Missed = the pinned rubric's un-ordered expected row (heparin), with
        // its pinned feedback; the after-the-fact Neutralol expectation is not
        // held against a session that already ordered it under the old rubric
        // (and it WAS ordered anyway), and heparin's live un-expecting is ignored.
        expect(d.missed).toEqual([
            { treatment_name: 'OG Heparinol', feedback_if_missed: 'Heparin was expected.' },
        ]);
    });

    it('a session written before the snapshot existed falls back to the LIVE rubric', async () => {
        // Legacy session: inserted directly, no session_settings row.
        const legacyId = await withDb(server.dbPath, async (db) => {
            const s = await pRun(db,
                `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
                 VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)`, [caseId, studentId]);
            return s.lastID;
        });

        // Live rubric now: Hiddenol visible → orderable; Neutralol expected 77.
        const h = await order(legacyId, 'OG Hiddenol');
        expect(h.status).toBe(201);
        const n = await order(legacyId, 'OG Neutralol');
        expect(n.status).toBe(201);
        expect((await n.json()).points_awarded).toBe(77);

        await endSession(legacyId);
        const d = await (await debrief(legacyId)).json();
        expect(d.total_points).toBe(77);
        // Live expected = Aspirinol (999) + Neutralol (77); only Aspirinol un-ordered.
        expect(d.missed).toEqual([
            { treatment_name: 'OG Aspirinol', feedback_if_missed: 'Aspirin was indicated.' },
        ]);
    });
});
