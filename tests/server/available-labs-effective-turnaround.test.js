// Regression lock: catalogue and worklist share one turnaround truth
// (bug report 2.9.15 #4).
//
// The catalogue used to print the STORED per-test number
// (`item.turnaround_minutes`) while the worklist counted down the
// server-computed remainder derived from `available_at` — which goes through
// resolveTurnaroundMinutes({caseConfig, testDefault}). Any case-level
// override (defaultTurnaround / instantResults) made the two panels
// disagree, and a per-test "Immediate" (0) was silently discarded by the
// resolver and re-coerced by a falsy-zero `||` in the available-labs
// response.
//
// This test pins the contract end-to-end over HTTP:
//   1. GET /available-labs returns `effective_turnaround_minutes` computed
//      with the same resolver the order endpoint runs:
//        - per-test null  → case default (follow)
//        - per-test 0     → 0 (instant — the Immediate button finally works)
//        - per-test 5     → 5 (concrete value wins over the case default)
//   2. Actually ordering those labs persists an available_at whose span from
//      ordered_at equals the advertised effective value — catalogue ==
//      worklist source of truth.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const CASE_DEFAULT_TURNAROUND = 4;

const CASE_CONFIG = {
    investigations: {
        defaultLabsEnabled: false,
        defaultTurnaround: CASE_DEFAULT_TURNAROUND,
        labs: [
            {
                id: 'lab_follow',
                test_name: 'Follow Default Test',
                test_group: 'General',
                min_value: 1,
                max_value: 9,
                current_value: 5,
                unit: 'u',
                normal_samples: [],
                is_abnormal: false,
                turnaround_minutes: null,
            },
            {
                id: 'lab_instant',
                test_name: 'Instant Test',
                test_group: 'General',
                min_value: 1,
                max_value: 9,
                current_value: 5,
                unit: 'u',
                normal_samples: [],
                is_abnormal: false,
                turnaround_minutes: 0,
            },
            {
                id: 'lab_custom',
                test_name: 'Custom Wait Test',
                test_group: 'General',
                min_value: 1,
                max_value: 9,
                current_value: 5,
                unit: 'u',
                normal_samples: [],
                is_abnormal: false,
                turnaround_minutes: 5,
            },
        ],
    },
};

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
    );
}
function dbClose(db) {
    return new Promise((resolve) => db.close(() => resolve()));
}

async function loginAs(server, username, password) {
    const r = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!r.ok) throw new Error(`login failed: ${r.status} ${await r.text()}`);
    return (await r.json()).token;
}

describe('available-labs effective_turnaround_minutes == order-time truth (bug report 2.9.15 #4)', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (310, 'tat_user', 'TAT User', ?, 'tat@example.com', 'student', 'active', 1)`,
            [hash]
        );
        await dbRun(db,
            `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
             VALUES (31, 'Turnaround case', 'be a patient', ?, 1)`,
            [JSON.stringify(CASE_CONFIG)]
        );
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status)
             VALUES (410, 31, 310, 'TAT User', 'active')`);
        await dbClose(db);
        token = await loginAs(server, 'tat_user', 'correctpass');
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    it('advertises the resolver-computed effective wait per configured lab', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/410/available-labs`, {
            headers: { authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        const byName = Object.fromEntries((body.labs || []).map((lab) => [lab.test_name, lab]));

        // Unset per-test value → the case default, not a frozen 3.
        expect(byName['Follow Default Test'].turnaround_minutes).toBeNull();
        expect(byName['Follow Default Test'].effective_turnaround_minutes).toBe(CASE_DEFAULT_TURNAROUND);

        // Explicit 0 survives the response (no falsy-zero `||` coercion) and
        // resolves to instant.
        expect(byName['Instant Test'].turnaround_minutes).toBe(0);
        expect(byName['Instant Test'].effective_turnaround_minutes).toBe(0);

        // A concrete per-test value wins over the case default.
        expect(byName['Custom Wait Test'].turnaround_minutes).toBe(5);
        expect(byName['Custom Wait Test'].effective_turnaround_minutes).toBe(5);
    }, 20_000);

    it('orders persist an available_at span equal to the advertised effective value', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/410/order-labs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ lab_ids: ['lab_follow', 'lab_instant', 'lab_custom'] }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.orders?.length).toBe(3);

        const db = await openDb(server.dbPath);
        const rows = await dbAll(db,
            `SELECT ci.test_name,
                    ci.turnaround_minutes AS stored_minutes,
                    ROUND((julianday(io.available_at) - julianday(io.ordered_at)) * 24 * 60) AS span_min
             FROM investigation_orders io
             JOIN case_investigations ci ON ci.id = io.investigation_id
             WHERE io.session_id = 410`);
        await dbClose(db);

        const spanByName = Object.fromEntries(rows.map((row) => [row.test_name, row]));
        expect(spanByName['Follow Default Test'].span_min).toBe(CASE_DEFAULT_TURNAROUND);
        expect(spanByName['Instant Test'].span_min).toBe(0);
        expect(spanByName['Custom Wait Test'].span_min).toBe(5);

        // Materialized case rows carry the AUTHOR's value, never the
        // order-time resolved number: a later change to the case default
        // must keep flowing into 'Follow Default Test' for future sessions.
        expect(spanByName['Follow Default Test'].stored_minutes).toBeNull();
        expect(spanByName['Instant Test'].stored_minutes).toBe(0);
        expect(spanByName['Custom Wait Test'].stored_minutes).toBe(5);
    }, 20_000);
});
