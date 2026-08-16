// tests/server/case-versions.test.js
//
// Adversarial-review regression locks for the case version history routes
// (`GET /cases/:caseId/versions`, `POST /cases/:caseId/restore/:versionId`)
// and the snapshots POST/PUT/restore write:
//
//   1. Cross-tenant: both routes were requireAdmin but never constrained by
//      tenant, so an admin of tenant A could read tenant B's version history
//      and restore over tenant B's case. Now the case is resolved with
//      `id = ? AND tenant_id = ?` first — 404 (no disclosure) otherwise.
//   2. Snapshots held PRE-validation data: POST/PUT stored `safeConfig`
//      (clamped vitals, canonical rhythm, gender written back) in the live
//      row but passed the raw request `config` to createCaseVersion. A
//      restore then wrote the snapshot back verbatim — skipping the clamp —
//      and only re-derived patient_name/gender/age, not chief_complaint /
//      difficulty_level.
//
// Spawned-server harness (same approach as cases-denormalization).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import { openDb, closeDb, run, get, all, seedUser, asUser } from '../utils/authHttp.js';

const TENANT_B = 2;

async function withDb(dbPath, fn) {
    const db = await openDb(dbPath);
    try {
        return await fn(db);
    } finally {
        await closeDb(db);
    }
}

/** createCaseVersion() is fire-and-forget after the response — poll. */
async function waitForVersions(call, caseId, minCount, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    let last = [];
    while (Date.now() < deadline) {
        const res = await call(`/api/cases/${caseId}/versions`);
        expect(res.status).toBe(200);
        last = (await res.json()).versions;
        if (last.length >= minCount) return last;
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`expected >= ${minCount} versions, saw ${last.length}`);
}

function snapshotOf(version) {
    return JSON.parse(version.config_snapshot);
}

describe('case versions — tenant scoping + normalised snapshots + normalised restore', () => {
    let server;
    let adminA; // tenant 1
    let adminB; // tenant 2
    let caseId;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        await withDb(server.dbPath, async (db) => {
            await run(db,
                `INSERT OR IGNORE INTO tenants (id, slug, name, is_default) VALUES (?, ?, ?, 0)`,
                [TENANT_B, 'tenant-b', 'Tenant B']);
            await seedUser(db, { username: 'cv-admin-a', role: 'admin', tenantId: 1 });
            await seedUser(db, { username: 'cv-admin-b', role: 'admin', tenantId: TENANT_B });
        });
        adminA = await asUser(server.baseUrl, 'cv-admin-a');
        adminB = await asUser(server.baseUrl, 'cv-admin-b');

        const res = await adminA('/api/cases', {
            method: 'POST',
            json: {
                name: 'Version Lock Case',
                description: 'v1 description',
                system_prompt: 'be a patient',
                config: {
                    patient_name: 'Vera Version',
                    demographics: { gender: 'Female', age: 61 },
                    structuredHistory: { chiefComplaint: 'CC v1' },
                    difficulty_level: 'beginner',
                    // hr 999 is out of VITAL_RANGES (max 250) — the live row clamps it.
                    initialVitals: { hr: 999, spo2: 97, rhythm: 'Sinus Tachycardia' },
                },
            },
        });
        expect(res.status).toBe(200);
        caseId = (await res.json()).id;
        expect(typeof caseId).toBe('number');
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    // Regression lock: version snapshots hold the NORMALISED config (what was
    // stored), not the raw request body.
    it('POST /cases writes a "created" snapshot whose vitals are clamped like the live row', async () => {
        const versions = await waitForVersions(adminA, caseId, 1);
        expect(versions).toHaveLength(1);
        expect(versions[0].change_type).toBe('created');
        const snap = snapshotOf(versions[0]);
        expect(snap.config.initialVitals.hr).toBe(250);
        expect(snap.config.demographics.gender).toBe('Female');
        expect(snap.config.case_language).toBeTruthy();

        const live = await withDb(server.dbPath, (db) =>
            get(db, `SELECT config, chief_complaint FROM cases WHERE id = ?`, [caseId]));
        expect(JSON.parse(live.config).initialVitals.hr).toBe(250);
        expect(live.chief_complaint).toBe('CC v1');
        // Snapshot config equals the stored config byte-for-byte.
        expect(snap.config).toEqual(JSON.parse(live.config));
    });

    // Regression lock: cross-tenant version history is not disclosed.
    it('GET /cases/:id/versions answers 404 for another tenant\'s case, 200 for the owner tenant', async () => {
        const foreign = await adminB(`/api/cases/${caseId}/versions`);
        expect(foreign.status).toBe(404);
        const body = await foreign.json();
        expect(body).toEqual({ error: 'Case not found' });

        const own = await adminA(`/api/cases/${caseId}/versions`);
        expect(own.status).toBe(200);
        expect((await own.json()).versions.length).toBeGreaterThanOrEqual(1);
    });

    // Regression lock: cross-tenant restore is refused and leaves the row alone.
    it('POST /cases/:id/restore/:versionId answers 404 for another tenant\'s case and does not modify it', async () => {
        const [v1] = await waitForVersions(adminA, caseId, 1);
        const before = await withDb(server.dbPath, (db) =>
            get(db, `SELECT name, config, version, updated_at FROM cases WHERE id = ?`, [caseId]));

        const foreign = await adminB(`/api/cases/${caseId}/restore/${v1.id}`, { method: 'POST' });
        expect(foreign.status).toBe(404);
        expect(await foreign.json()).toEqual({ error: 'Case not found' });

        const after = await withDb(server.dbPath, (db) =>
            get(db, `SELECT name, config, version, updated_at FROM cases WHERE id = ?`, [caseId]));
        expect(after).toEqual(before);
    });

    it('PUT /cases/:id writes an "updated" snapshot of the stored (clamped) config', async () => {
        const res = await adminA(`/api/cases/${caseId}`, {
            method: 'PUT',
            json: {
                name: 'Version Lock Case',
                description: 'v2 description',
                system_prompt: 'be a patient',
                config: {
                    patient_name: 'Vera Version',
                    demographics: { gender: 'Female', age: 62 },
                    structuredHistory: { chiefComplaint: 'CC v2' },
                    difficulty_level: 'advanced',
                    initialVitals: { hr: 5, spo2: 97 }, // below min 20 → 20
                },
            },
        });
        expect(res.status).toBe(200);
        const versions = await waitForVersions(adminA, caseId, 2);
        const updated = versions.find((v) => v.change_type === 'updated');
        expect(updated).toBeTruthy();
        expect(snapshotOf(updated).config.initialVitals.hr).toBe(20);
        expect(snapshotOf(updated).description).toBe('v2 description');
    });

    // Regression lock: restore updates chief_complaint (and difficulty_level),
    // not just patient_name/gender/age.
    it('restoring the "created" version brings back chief_complaint + difficulty_level', async () => {
        const versions = await waitForVersions(adminA, caseId, 2);
        const created = versions.find((v) => v.change_type === 'created');
        const res = await adminA(`/api/cases/${caseId}/restore/${created.id}`, { method: 'POST' });
        expect(res.status).toBe(200);
        expect((await res.json()).restoredFromVersion).toBe(created.version_number);

        const row = await withDb(server.dbPath, (db) =>
            get(db, `SELECT description, chief_complaint, difficulty_level, patient_age, config FROM cases WHERE id = ?`, [caseId]));
        expect(row.description).toBe('v1 description');
        expect(row.chief_complaint).toBe('CC v1');
        expect(row.difficulty_level).toBe('beginner');
        expect(row.patient_age).toBe(61);
        expect(JSON.parse(row.config).initialVitals.hr).toBe(250);

        const after = await waitForVersions(adminA, caseId, 3);
        expect(after[0].change_type).toBe('restored');
    });

    // Regression lock: a legacy (pre-fix) snapshot holding pre-validation
    // data is normalised on restore exactly like a PUT would be.
    it('restoring a legacy snapshot with hr 999 stores 250, canonical rhythm, and re-derived columns', async () => {
        const legacyVersionId = await withDb(server.dbPath, async (db) => {
            const next = await get(db,
                `SELECT COALESCE(MAX(version_number), 0) + 1 AS n FROM case_versions WHERE case_id = ?`, [caseId]);
            const r = await run(db,
                `INSERT INTO case_versions (case_id, version_number, changed_by, change_type, changes_description, config_snapshot, tenant_id)
                 VALUES (?, ?, 1, 'updated', 'legacy pre-validation snapshot', ?, 1)`,
                [caseId, next.n, JSON.stringify({
                    name: 'Legacy Name',
                    description: 'legacy description',
                    system_prompt: 'legacy prompt',
                    config: {
                        patient_name: 'Legacy Larry',
                        demographics: { gender: 'Male', age: 77 },
                        structuredHistory: { chiefComplaint: 'Legacy CC' },
                        difficulty_level: 'intermediate',
                        initialVitals: { hr: 999, spo2: 300, rhythm: 'BradySinus' }, // alias → canonical id
                        case_language: 'de', // must NOT override the immutable stored language
                    },
                    scenario: { timeline: [{ time: 0, rhythm: 'sinus tach' }] },
                })]);
            return r.lastID;
        });

        const before = await withDb(server.dbPath, (db) =>
            get(db, `SELECT config FROM cases WHERE id = ?`, [caseId]));
        const storedLanguage = JSON.parse(before.config).case_language;

        const res = await adminA(`/api/cases/${caseId}/restore/${legacyVersionId}`, { method: 'POST' });
        expect(res.status).toBe(200);

        const row = await withDb(server.dbPath, (db) =>
            get(db, `SELECT name, config, scenario, patient_name, patient_gender, patient_age, chief_complaint, difficulty_level FROM cases WHERE id = ?`, [caseId]));
        const cfg = JSON.parse(row.config);
        expect(row.name).toBe('Legacy Name');
        expect(cfg.initialVitals.hr).toBe(250);
        expect(cfg.initialVitals.spo2).toBe(100);
        expect(cfg.initialVitals.rhythm).toBe('Sinus Bradycardia');
        expect(cfg.case_language).toBe(storedLanguage);
        expect(cfg.case_language).not.toBe('de');
        expect(JSON.parse(row.scenario).timeline[0].rhythm).toBe('Sinus Tachycardia');
        expect(row.patient_name).toBe('Legacy Larry');
        expect(row.patient_gender).toBe('Male');
        expect(row.patient_age).toBe(77);
        expect(row.chief_complaint).toBe('Legacy CC');
        expect(row.difficulty_level).toBe('intermediate');

        // The "restored" snapshot written afterwards is the normalised one.
        const versions = await waitForVersions(adminA, caseId, 5);
        const restored = versions[0];
        expect(restored.change_type).toBe('restored');
        expect(snapshotOf(restored).config.initialVitals.hr).toBe(250);
        expect(snapshotOf(restored).config).toEqual(cfg);

        const rows = await withDb(server.dbPath, (db) =>
            all(db, `SELECT tenant_id FROM case_versions WHERE case_id = ?`, [caseId]));
        expect(rows.every((r) => r.tenant_id === 1)).toBe(true);
    });

    it('restore of an unknown version in the owner tenant answers 404 Version not found', async () => {
        const res = await adminA(`/api/cases/${caseId}/restore/999999`, { method: 'POST' });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Version not found' });
    });
});
