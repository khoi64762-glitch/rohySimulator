// Regression lock: available-treatments leaked the grading key and hidden rows to students; PUT stored conflicting flags (bug report 2.9.15 #7/#8/#9)
//
// GET /api/sessions/:id/available-treatments used to merge every
// case_treatments column into the payload for any authenticated caller:
// is_expected, is_contraindicated, points_if_ordered, feedback_if_ordered,
// feedback_if_missed — the whole answer key, readable in DevTools — and it
// never filtered is_available, so "hidden" treatments were still sent (#7,
// #9). PUT /api/cases/:id/treatments wrote the three BOOLEAN flags
// independently, so conflicting rows like {is_available: 0, is_expected: 1}
// were storable (#8). This suite locks:
//   - students get no grading fields and no is_available:0 rows,
//   - educators keep the full rows for case preview,
//   - the PUT normalises flags: hidden wins; on expected+contraindicated
//     the safety flag (contraindicated) wins.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const PASSWORD = 'TreatVisT1!';
const GRADING_FIELDS = [
    'is_expected',
    'is_contraindicated',
    'points_if_ordered',
    'feedback_if_ordered',
    'feedback_if_missed',
];

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
function pAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
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

// Flatten the grouped {medication, iv_fluid, oxygen, nursing} payload.
function flatten(body) {
    return Object.values(body.treatments).flat();
}

describe('case treatments visibility + flag normalisation (bug report 2.9.15 #7/#8/#9)', () => {
    let server;
    let studentToken;
    let educatorToken;
    let sessionId;
    let putCaseId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const db = await openDb(server.dbPath);
        try {
            const studentId = await seedUser(db, { username: 'ctv-student', role: 'student' });
            await seedUser(db, { username: 'ctv-educator', role: 'educator' });

            // Master catalogue rows this suite owns (names are unique to it).
            await pRun(db,
                `INSERT INTO treatment_effects (treatment_type, treatment_name, route, description, is_active)
                 VALUES ('medication', 'CTV Expectol', 'PO', 'expected in the case', 1),
                        ('medication', 'CTV Dangerol', 'IV', 'contraindicated in the case', 1),
                        ('medication', 'CTV Secretol', 'PO', 'hidden in the case', 1),
                        ('medication', 'CTV Neutralol', 'PO', 'not configured at all', 1)`);

            const c = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('CTV Case', 1)`);
            const c2 = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('CTV Put Case', 1)`);
            putCaseId = c2.lastID;

            await pRun(db,
                `INSERT INTO case_treatments
                    (case_id, treatment_type, treatment_name, is_available, is_expected, is_contraindicated,
                     points_if_ordered, feedback_if_ordered, feedback_if_missed)
                 VALUES (?, 'medication', 'CTV Expectol', 1, 1, 0, 10, 'well done', 'you missed it'),
                        (?, 'medication', 'CTV Dangerol', 1, 0, 1, 0, 'dangerous choice', NULL),
                        (?, 'medication', 'CTV Secretol', 0, 0, 0, 0, NULL, NULL)`,
                [c.lastID, c.lastID, c.lastID]);

            const s = await pRun(db,
                `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
                 VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)`,
                [c.lastID, studentId]);
            sessionId = s.lastID;

            studentToken = await login(server.baseUrl, 'ctv-student');
            educatorToken = await login(server.baseUrl, 'ctv-educator');
        } finally {
            await closeDb(db);
        }
    }, 90000);

    afterAll(async () => { if (server) await server.close(); });

    const getTreatments = (token) => fetch(
        `${server.baseUrl}/api/sessions/${sessionId}/available-treatments`,
        { headers: { authorization: `Bearer ${token}` } });

    it('student payload carries no grading fields and no hidden rows (#7, #9)', async () => {
        const res = await getTreatments(studentToken);
        expect(res.status).toBe(200);
        const rows = flatten(await res.json());
        expect(rows.length).toBeGreaterThanOrEqual(3);

        const names = rows.map((r) => r.treatment_name);
        expect(names).toContain('CTV Expectol');
        expect(names).toContain('CTV Dangerol');
        expect(names).toContain('CTV Neutralol');
        // The hidden treatment is dropped entirely, not just flagged.
        expect(names).not.toContain('CTV Secretol');

        rows.forEach((row) => {
            GRADING_FIELDS.forEach((field) => {
                expect(row, `${row.treatment_name} leaked ${field}`).not.toHaveProperty(field);
            });
            // No is_available:0 rows survive the filter.
            expect(!!row.is_available).toBe(true);
        });
    });

    it('educator payload keeps the grading fields and the hidden row, flagged (#7 preview path)', async () => {
        const res = await getTreatments(educatorToken);
        expect(res.status).toBe(200);
        const rows = flatten(await res.json());
        const byName = Object.fromEntries(rows.map((r) => [r.treatment_name, r]));

        expect(!!byName['CTV Expectol'].is_expected).toBe(true);
        expect(byName['CTV Expectol'].points_if_ordered).toBe(10);
        expect(byName['CTV Expectol'].feedback_if_missed).toBe('you missed it');
        expect(!!byName['CTV Dangerol'].is_contraindicated).toBe(true);
        expect(byName['CTV Secretol']).toBeTruthy();
        expect(!!byName['CTV Secretol'].is_available).toBe(false);
    });

    it('PUT normalises conflicting flags: hidden wins; contraindicated beats expected (#8)', async () => {
        const res = await fetch(`${server.baseUrl}/api/cases/${putCaseId}/treatments`, {
            method: 'PUT',
            headers: {
                authorization: `Bearer ${educatorToken}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                treatments: [
                    // Hidden + expected → hidden wins, grading flags cleared.
                    { treatment_type: 'medication', treatment_name: 'CTV Expectol', is_available: false, is_expected: true, points_if_ordered: 5 },
                    // Expected + contraindicated → the safety flag wins.
                    { treatment_type: 'medication', treatment_name: 'CTV Dangerol', is_expected: true, is_contraindicated: true },
                ],
            }),
        });
        expect(res.status).toBe(200);

        const db = await openDb(server.dbPath);
        try {
            const rows = await pAll(db,
                `SELECT treatment_name, is_available, is_expected, is_contraindicated
                 FROM case_treatments WHERE case_id = ? ORDER BY treatment_name`,
                [putCaseId]);
            const byName = Object.fromEntries(rows.map((r) => [r.treatment_name, r]));

            expect(byName['CTV Expectol']).toMatchObject({
                is_available: 0, is_expected: 0, is_contraindicated: 0,
            });
            expect(byName['CTV Dangerol']).toMatchObject({
                is_available: 1, is_expected: 0, is_contraindicated: 1,
            });
        } finally {
            await closeDb(db);
        }
    });
});
