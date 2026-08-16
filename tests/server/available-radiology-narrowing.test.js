// Regression lock: educators can narrow the radiology catalogue
// (bug report 2.9.15 #5).
//
// `/available-radiology` used to return the full 74-study master DB
// unconditionally — the labs side has `investigations.defaultLabsEnabled`,
// radiology had no counterpart, so an educator could not keep a first-year
// case from offering a PET-CT. This pins the new contract end-to-end over
// HTTP:
//   1. Flag absent / true → full catalogue + custom studies, and the
//      response says so (`defaultRadiologyEnabled: true`) — every
//      pre-existing case is unchanged.
//   2. Flag false → only master studies configured on the case (matched by
//      studyId OR legacy name) plus custom studies; the response says
//      `defaultRadiologyEnabled: false`.
//   3. Ordering a hidden master study under a narrowed catalogue is refused
//      with 409 `RADIOLOGY_UNAVAILABLE` and nothing is inserted; ordering a
//      configured or custom study still works.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const MASTER_TOTAL = 74;

const NARROWED_CONFIG = {
    investigations: { defaultRadiologyEnabled: false },
    radiology: [
        // by id
        { studyId: 'xray_chest_pa', studyName: 'Chest X-Ray (PA/Lateral)', modality: 'X-Ray', findings: 'Cardiomegaly' },
        // legacy entry: no studyId, matched by name
        { studyName: 'Abdominal X-Ray (KUB)', modality: 'X-Ray', findings: 'Normal bowel gas' },
        // custom study — always offered
        { isCustom: true, studyId: 'custom_bedside_echo', studyName: 'Bedside echo', modality: 'Cardiac', turnaroundMinutes: 5 },
    ],
};

const OPEN_CONFIG = {
    radiology: [
        { isCustom: true, studyId: 'custom_bedside_echo', studyName: 'Bedside echo', modality: 'Cardiac', turnaroundMinutes: 5 },
    ],
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
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
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

describe('radiology catalogue narrowing (bug report 2.9.15 #5)', () => {
    let server;
    let token;

    beforeAll(async () => {
        server = await startTestServer();
        const db = await openDb(server.dbPath);
        const hash = await bcrypt.hash('correctpass', 4);
        await dbRun(db,
            `INSERT INTO users (id, username, name, password_hash, email, role, status, tenant_id)
             VALUES (320, 'rad_user', 'Rad User', ?, 'rad@example.com', 'student', 'active', 1)`,
            [hash]
        );
        await dbRun(db,
            `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
             VALUES (32, 'Narrowed radiology case', 'be a patient', ?, 1)`,
            [JSON.stringify(NARROWED_CONFIG)]
        );
        await dbRun(db,
            `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
             VALUES (33, 'Open radiology case', 'be a patient', ?, 1)`,
            [JSON.stringify(OPEN_CONFIG)]
        );
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status)
             VALUES (420, 32, 320, 'Rad User', 'active')`);
        await dbRun(db,
            `INSERT INTO sessions (id, case_id, user_id, student_name, status)
             VALUES (421, 33, 320, 'Rad User', 'active')`);
        await dbClose(db);
        token = await loginAs(server, 'rad_user', 'correctpass');
    }, 90_000);

    afterAll(async () => { await server?.close(); });

    const auth = () => ({ authorization: `Bearer ${token}` });

    it('flag absent → full master catalogue + custom studies (pre-existing cases unchanged)', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/421/available-radiology`, { headers: auth() });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.defaultRadiologyEnabled).toBe(true);
        expect(body.total).toBe(MASTER_TOTAL + 1);
        const ids = body.studies.map((s) => s.id);
        expect(ids).toContain('xray_chest_pa');
        expect(ids).toContain('ct_head_noncon');
        expect(ids).toContain('custom_bedside_echo');
    }, 20_000);

    it('flag false → only configured (by id or legacy name) + custom studies', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/420/available-radiology`, { headers: auth() });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.defaultRadiologyEnabled).toBe(false);
        const ids = body.studies.map((s) => s.id).sort();
        expect(ids).toEqual(['custom_bedside_echo', 'xray_abdomen', 'xray_chest_pa']);
        expect(body.total).toBe(3);
        expect(body.groups).toEqual(['Cardiac', 'X-Ray']);
    }, 20_000);

    it('ordering a hidden master study is refused with 409 RADIOLOGY_UNAVAILABLE and inserts nothing', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/420/order-radiology`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...auth() },
            body: JSON.stringify({ radiology_ids: ['xray_chest_pa', 'ct_head_noncon'] }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe('RADIOLOGY_UNAVAILABLE');
        expect(body.unavailable_ids).toEqual(['ct_head_noncon']);

        const db = await openDb(server.dbPath);
        const row = await dbGet(db, 'SELECT COUNT(*) AS n FROM investigation_orders WHERE session_id = 420');
        await dbClose(db);
        expect(row.n).toBe(0); // all-or-nothing: the visible study was not ordered either
    }, 20_000);

    it('ordering configured + custom studies under a narrowed catalogue still works', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/420/order-radiology`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...auth() },
            body: JSON.stringify({ radiology_ids: ['xray_chest_pa', 'xray_abdomen', 'custom_bedside_echo'] }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.orders?.length).toBe(3);
    }, 20_000);

    it('an open catalogue never refuses a master study', async () => {
        const res = await fetch(`${server.baseUrl}/api/sessions/421/order-radiology`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...auth() },
            body: JSON.stringify({ radiology_ids: ['ct_head_noncon'] }),
        });
        expect(res.status).toBe(200);
        expect((await res.json()).orders?.length).toBe(1);
    }, 20_000);
});
