// Treatments library (Settings → Libraries → Treatments): the scoped, editable
// `treatment_effects` catalogue students order from.
//
// Locks the 0046 scope model end-to-end against the real server:
//   - an educator's POST always lands as scope 'tenant' in the caller's tenant,
//   - GET /treatment-effects shows platform rows + the caller's tenant rows only,
//   - platform rows are admin-only for PUT/DELETE (educator → 403), tenant rows
//     of another tenant are invisible (→ 404),
//   - DELETE is soft: the row leaves GET /sessions/:id/available-treatments
//     (and the default GET) but comes back via PUT /:id/restore,
//   - the global UNIQUE(treatment_name, route) surfaces as a readable 409,
//   - an invalid treatment_type / negative timing → 400 with a code.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcrypt';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';
import { validateTreatmentBody, canMutateTreatment } from '../../server/routes/treatments-library-routes.js';

const PASSWORD = 'TreatLibT1!';

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
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
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

const NEW_ROW = {
    treatment_type: 'medication',
    treatment_name: 'TL Tenantol',
    route: 'IV',
    onset_minutes: 2,
    peak_minutes: 5,
    duration_minutes: 30,
    hr_effect: -5,
    bp_sys_effect: -10,
    bp_dia_effect: -5,
    rr_effect: 0,
    spo2_effect: 0,
    temp_effect: 0,
    etco2_effect: 0,
    dose_dependent: true,
    base_dose: 5,
    base_dose_unit: 'mg',
    max_effect_multiplier: 2,
    description: 'Tenant-local beta blocker',
    rxcui: '6918',
    pk_source: 'Local protocol',
    pk_evidence_url: 'https://example.org/protocol',
};

describe('validateTreatmentBody / canMutateTreatment (pure)', () => {
    it('accepts a full row and coerces booleans/numbers', () => {
        const out = validateTreatmentBody(NEW_ROW);
        expect(out.dose_dependent).toBe(1);
        expect(out.base_dose).toBe(5);
        expect(out.treatment_name).toBe('TL Tenantol');
    });

    it.each([
        [{ ...NEW_ROW, treatment_type: 'surgery' }, 'invalid_treatment_type'],
        [{ ...NEW_ROW, treatment_name: '   ' }, 'invalid_treatment_name'],
        [{ ...NEW_ROW, onset_minutes: -1 }, 'invalid_treatment'],
        [{ ...NEW_ROW, hr_effect: 'fast' }, 'invalid_treatment'],
        [{ ...NEW_ROW, max_effect_multiplier: 0 }, 'invalid_treatment'],
        [{ ...NEW_ROW, pk_evidence_url: 'ftp://nope' }, 'invalid_pk_evidence_url'],
    ])('rejects %j with %s', (body, code) => {
        expect(() => validateTreatmentBody(body)).toThrow(expect.objectContaining({ code }));
    });

    it('keeps existing values on a partial update', () => {
        const existing = { ...validateTreatmentBody(NEW_ROW), id: 9 };
        const out = validateTreatmentBody({ hr_effect: -12 }, existing);
        expect(out.hr_effect).toBe(-12);
        expect(out.treatment_name).toBe('TL Tenantol');
        expect(out.duration_minutes).toBe(30);
    });

    it('gates platform rows to admins and tenant rows to same-tenant educators', () => {
        const platform = { scope: 'platform', tenant_id: 1 };
        const tenant2 = { scope: 'tenant', tenant_id: 2 };
        expect(canMutateTreatment({ role: 'educator', tenant_id: 1 }, platform)).toBe(false);
        expect(canMutateTreatment({ role: 'admin', tenant_id: 1 }, platform)).toBe(true);
        expect(canMutateTreatment({ role: 'educator', tenant_id: 2 }, tenant2)).toBe(true);
        expect(canMutateTreatment({ role: 'educator', tenant_id: 1 }, tenant2)).toBe(false);
        expect(canMutateTreatment({ role: 'student', tenant_id: 2 }, tenant2)).toBe(false);
    });
});

describe('treatments library routes (live server)', () => {
    let server;
    let db;
    let tokens = {};
    let platformRowId;
    let sessionId;
    let createdId;

    const call = (who, path, init = {}) => fetch(`${server.baseUrl}${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${tokens[who]}`,
            'content-type': 'application/json',
            ...(init.headers || {}),
        },
    });
    const post = (who, path, body) => call(who, path, { method: 'POST', body: JSON.stringify(body) });
    const put = (who, path, body) => call(who, path, { method: 'PUT', body: JSON.stringify(body ?? {}) });
    const del = (who, path) => call(who, path, { method: 'DELETE' });

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        db = await openDb(server.dbPath);

        await seedUser(db, { username: 'tl-admin', role: 'admin', tenant: 1 });
        await seedUser(db, { username: 'tl-educator', role: 'educator', tenant: 1 });
        await seedUser(db, { username: 'tl-educator2', role: 'educator', tenant: 2 });
        const studentId = await seedUser(db, { username: 'tl-student', role: 'student', tenant: 1 });
        await seedUser(db, { username: 'tl-student2', role: 'student', tenant: 2 });

        const p = await pRun(db,
            `INSERT INTO treatment_effects (treatment_type, treatment_name, route, description, is_active)
             VALUES ('medication', 'TL Platformol', 'IV', 'seeded platform row', 1)`);
        platformRowId = p.lastID;

        const c = await pRun(db, `INSERT INTO cases (name, tenant_id) VALUES ('TL Case', 1)`);
        const s = await pRun(db,
            `INSERT INTO sessions (case_id, user_id, tenant_id, status, start_time)
             VALUES (?, ?, 1, 'active', CURRENT_TIMESTAMP)`,
            [c.lastID, studentId]);
        sessionId = s.lastID;

        for (const u of ['tl-admin', 'tl-educator', 'tl-educator2', 'tl-student', 'tl-student2']) {
            tokens[u] = await login(server.baseUrl, u);
        }
    }, 90_000);

    afterAll(async () => {
        if (db) await closeDb(db);
        if (server) await server.close();
    });

    it('migration 0046 stamps existing rows as platform / tenant 1', async () => {
        const row = await pGet(db, `SELECT scope, tenant_id, created_by FROM treatment_effects WHERE id = ?`, [platformRowId]);
        expect(row).toEqual({ scope: 'platform', tenant_id: 1, created_by: null });
    });

    it('rejects an invalid treatment_type with 400 + code', async () => {
        const res = await post('tl-educator', '/api/treatment-effects', { ...NEW_ROW, treatment_type: 'surgery' });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'invalid_treatment_type' });
    });

    it('rejects a negative onset with 400', async () => {
        const res = await post('tl-educator', '/api/treatment-effects', { ...NEW_ROW, onset_minutes: -3 });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/onset_minutes/);
    });

    it('students cannot create rows', async () => {
        const res = await post('tl-student', '/api/treatment-effects', NEW_ROW);
        expect(res.status).toBe(403);
    });

    it('educator creates a TENANT row in their own tenant even if they ask for platform', async () => {
        const res = await post('tl-educator', '/api/treatment-effects', { ...NEW_ROW, scope: 'platform' });
        expect(res.status).toBe(201);
        const { effect } = await res.json();
        expect(effect).toMatchObject({
            treatment_name: 'TL Tenantol',
            scope: 'tenant',
            tenant_id: 1,
            is_active: 1,
            dose_dependent: 1,
            base_dose: 5,
            hr_effect: -5,
        });
        expect(effect.created_by).toBeTruthy();
        createdId = effect.id;
    });

    it('the tenant row is visible in GET /treatment-effects for the same tenant, not another', async () => {
        const mine = await (await call('tl-student', '/api/treatment-effects')).json();
        const names1 = mine.effects.map((e) => e.treatment_name);
        expect(names1).toContain('TL Tenantol');
        expect(names1).toContain('TL Platformol');
        const platformRow = mine.effects.find((e) => e.id === platformRowId);
        expect(platformRow).toMatchObject({ scope: 'platform', tenant_id: 1 });

        const other = await (await call('tl-educator2', '/api/treatment-effects')).json();
        const names2 = other.effects.map((e) => e.treatment_name);
        expect(names2).not.toContain('TL Tenantol');
        expect(names2).toContain('TL Platformol');
    });

    it('a duplicate (name, route) answers 409 with a readable message', async () => {
        const res = await post('tl-admin', '/api/treatment-effects', { ...NEW_ROW });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.code).toBe('duplicate_treatment');
        expect(body.error).toMatch(/TL Tenantol/);
        expect(body.error).not.toMatch(/constraint/i);
    });

    it('educator cannot edit a platform row (403); admin can', async () => {
        const denied = await put('tl-educator', `/api/treatment-effects/${platformRowId}`, { hr_effect: 3 });
        expect(denied.status).toBe(403);
        expect(await denied.json()).toMatchObject({ code: 'treatment_forbidden' });

        const ok = await put('tl-admin', `/api/treatment-effects/${platformRowId}`, { hr_effect: 3, description: 'admin edited' });
        expect(ok.status).toBe(200);
        const { effect } = await ok.json();
        expect(effect).toMatchObject({ id: platformRowId, hr_effect: 3, description: 'admin edited', scope: 'platform' });
        expect(effect.updated_at).toBeTruthy();
    });

    it('another tenant cannot see or edit the tenant row (404), same-tenant educator can', async () => {
        const foreign = await put('tl-educator2', `/api/treatment-effects/${createdId}`, { hr_effect: -20 });
        expect(foreign.status).toBe(404);

        const own = await put('tl-educator', `/api/treatment-effects/${createdId}`, { hr_effect: -20 });
        expect(own.status).toBe(200);
        expect((await own.json()).effect.hr_effect).toBe(-20);
    });

    it('admin creates a platform row by default', async () => {
        const res = await post('tl-admin', '/api/treatment-effects', {
            treatment_type: 'nursing', treatment_name: 'TL Reposition', route: 'position',
        });
        expect(res.status).toBe(201);
        expect((await res.json()).effect).toMatchObject({ scope: 'platform', onset_minutes: 5, duration_minutes: 60 });
    });

    it('a deactivated row disappears from available-treatments and the default GET, and restore brings it back', async () => {
        const before = await (await call('tl-student', `/api/sessions/${sessionId}/available-treatments`)).json();
        expect(before.treatments.medication.map((t) => t.treatment_name)).toContain('TL Tenantol');

        const res = await del('tl-educator', `/api/treatment-effects/${createdId}`);
        expect(res.status).toBe(200);
        expect((await res.json()).effect.is_active).toBe(0);

        const after = await (await call('tl-student', `/api/sessions/${sessionId}/available-treatments`)).json();
        expect(after.treatments.medication.map((t) => t.treatment_name)).not.toContain('TL Tenantol');

        const listed = await (await call('tl-educator', '/api/treatment-effects')).json();
        expect(listed.effects.map((e) => e.id)).not.toContain(createdId);

        const withInactive = await (await call('tl-educator', '/api/treatment-effects?include_inactive=1')).json();
        expect(withInactive.effects.find((e) => e.id === createdId)).toMatchObject({ is_active: 0 });

        // Students never get inactive rows even if they ask.
        const studentAsks = await (await call('tl-student', '/api/treatment-effects?include_inactive=1')).json();
        expect(studentAsks.effects.map((e) => e.id)).not.toContain(createdId);

        const restored = await put('tl-educator', `/api/treatment-effects/${createdId}/restore`);
        expect(restored.status).toBe(200);
        expect((await restored.json()).effect.is_active).toBe(1);

        const again = await (await call('tl-student', `/api/sessions/${sessionId}/available-treatments`)).json();
        expect(again.treatments.medication.map((t) => t.treatment_name)).toContain('TL Tenantol');
    });

    it('educator cannot deactivate a platform row', async () => {
        const res = await del('tl-educator', `/api/treatment-effects/${platformRowId}`);
        expect(res.status).toBe(403);
    });

    it('writes audit rows for every mutation', async () => {
        const rows = await new Promise((resolve, reject) =>
            db.all(`SELECT action, resource_type, resource_id FROM system_audit_log WHERE resource_type = 'treatment_effect'`,
                [], (err, r) => err ? reject(err) : resolve(r)));
        const actions = new Set(rows.map((r) => r.action));
        expect(actions).toEqual(new Set([
            'treatment_effect.create', 'treatment_effect.update',
            'treatment_effect.deactivate', 'treatment_effect.restore',
        ]));
        expect(rows.some((r) => r.resource_id === String(createdId))).toBe(true);
    });
});
