// Regression lock: creating or updating a case must not depend on the UI language.
//
// The editor's gender <option> elements carried a translated label and no
// `value`, so the browser submitted the label itself. That string reached the
// CHECK-constrained `cases.patient_gender` column and the driver threw, which
// the route surfaced as:
//
//   HTTP 500 {"error":"SQLITE_CONSTRAINT: CHECK constraint failed:
//             patient_gender IN ('Male', 'Female', 'Other')"}
//
// …in de, es, fi, it and sv. English passed only by coincidence, because
// t('demo_gender_male') is the word "Male".
//
// The client fix (explicit value=) is locked by patient-demographics.test.js.
// THIS file locks the server half — an API client, an old cached bundle, or an
// imported case must get an honest 400 rather than a 500 with raw SQL in it,
// and the localized labels themselves (which older exports carry) are
// accepted as aliases and stored canonically.
//
// Spawns the real server against an empty database (real boot path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

/** Run one write against the test database (rows the routes will not create). */
function dbRun(dbPath, sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, (openErr) => {
            if (openErr) return reject(openErr);
            db.run(sql, params, function done(err) {
                db.close(() => (err ? reject(err) : resolve(this)));
            });
        });
    });
}

async function login(baseUrl, username, password) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
    });
    if (!res.ok) throw new Error(`login(${username}) → ${res.status}: ${await res.text()}`);
    return (await res.json()).token;
}

describe('case authoring is language-independent', () => {
    let server;
    let admin;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const token = await login(server.baseUrl, 'admin', 'admin123');
        admin = (path, init = {}) => fetch(`${server.baseUrl}${path}`, {
            ...init,
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                ...(init.headers || {}),
            },
        });
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    const body = (name, gender) => JSON.stringify({
        name,
        description: 'regression lock',
        system_prompt: 'You are a patient.',
        config: { demographics: { gender, age: 55 }, patient_name: 'Test Patient' },
    });

    const createCase = (name, gender) =>
        admin('/api/cases', { method: 'POST', body: body(name, gender) });

    it('accepts the canonical English values', async () => {
        for (const gender of ['Male', 'Female', 'Other']) {
            const res = await createCase(`lock-${gender}`, gender);
            expect(res.status, `gender=${gender}`).toBe(200);
            const created = await res.json();
            expect(created.id).toBeGreaterThan(0);
        }
    });

    const fetchStored = async (id) => {
        const fetched = await (await admin(`/api/cases/${id}`)).json();
        return fetched.case ?? fetched;
    };

    // Regression lock: an unknown gender must be an honest 400, never the
    // 500 with raw SQL. (The localized labels used to be the trigger; now
    // that they are aliases, a value from outside every catalogue stands in.)
    it.each([
        ['French', 'Homme'],
        ['abbreviated', 'F'],
        ['typo', 'Femal'],
    ])('rejects an unrecognised (%s) value with 400, not 500', async (_kind, label) => {
        const res = await createCase(`lock-${label}`, label);
        expect(res.status).toBe(400);

        const payload = await res.json();
        expect(payload.code).toBe('invalid_patient_gender');
        expect(payload.error).toContain(label);
        expect(payload.error).toContain('Male, Female, Other');

        // And it must not leak the schema on the way out.
        expect(payload.error).not.toMatch(/SQLITE|CHECK constraint/i);
    });

    // Regression lock: the exact strings each locale's catalogue returns for
    // demo_gender_* — what pre-v2.9.15 editors stored, and therefore what an
    // exported/imported case of that vintage carries. They used to be refused
    // (400) at import; now they resolve to the canonical column value and the
    // stored config is rewritten to agree with the column.
    it.each([
        ['de', 'Weiblich', 'Female'],
        ['es', 'Masculino', 'Male'],
        ['fi', 'Mies', 'Male'],
        ['it', 'Femmina', 'Female'],
        ['sv', 'Annat', 'Other'],
    ])('accepts the %s label %s and stores it canonically as %s', async (locale, label, canonical) => {
        const res = await createCase(`lock-alias-${locale}`, label);
        expect(res.status).toBe(200);
        const created = await res.json();
        // The response echoes the config as stored — canonical, not the alias.
        expect(created.config.demographics.gender).toBe(canonical);

        const stored = await fetchStored(created.id);
        expect(stored.patient_gender).toBe(canonical);
        expect(stored.config.demographics.gender).toBe(canonical);
    });

    it('imports a case whose gender is only the top-level patient_gender column', async () => {
        // Regression lock: an export carries the denormalized `patient_gender`
        // at the top level; a hand-edited import may set only that and leave
        // `config.demographics.gender` empty. That used to land as a case
        // with no gender at all — the column was derived from the config only.
        const res = await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'lock-import-top-level',
                description: 'imported',
                system_prompt: 'You are a patient.',
                patient_gender: 'Female',
                config: { demographics: { age: 61 }, patient_name: 'Imported Patient' },
            }),
        });
        expect(res.status).toBe(200);
        const created = await res.json();
        expect(created.config.demographics.gender).toBe('Female');

        const stored = await fetchStored(created.id);
        expect(stored.patient_gender).toBe('Female');
        expect(stored.config.demographics.gender).toBe('Female');
        expect(stored.config.demographics.age).toBe(61);
    });

    it('a top-level patient_gender that is unrecognised is a 400 too', async () => {
        const res = await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'lock-import-bad-top-level',
                system_prompt: 'p',
                patient_gender: 'Homme',
                config: { demographics: { age: 61 } },
            }),
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('invalid_patient_gender');
    });

    it('config.demographics.gender wins over a stale top-level patient_gender', async () => {
        // The config is what the editor maintains; the top-level column is
        // derived from it. Only when the config says nothing does the top
        // level count.
        const res = await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'lock-import-precedence',
                system_prompt: 'p',
                patient_gender: 'Male',
                config: { demographics: { gender: 'Female', age: 30 } },
            }),
        });
        expect(res.status).toBe(200);
        const stored = await fetchStored((await res.json()).id);
        expect(stored.patient_gender).toBe('Female');
    });

    it('repairs legacy lowercase rather than rejecting it', async () => {
        // 'male' never satisfied the constraint either, so an older client or
        // an imported case would have hit the same 500. Normalised, not refused.
        const res = await createCase('lock-lowercase', 'male');
        expect(res.status).toBe(200);
        const { id } = await res.json();
        const stored = await fetchStored(id);
        expect(stored.patient_gender).toBe('Male');
        expect(stored.config.demographics.gender).toBe('Male');
    });

    it('treats an absent gender as absent, not as an error', async () => {
        const res = await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'lock-no-gender',
                system_prompt: 'p',
                config: { demographics: { age: 40 } },
            }),
        });
        expect(res.status).toBe(200);
    });

    it('guards PUT as well as POST', async () => {
        // The update path derives patient_gender the same way and writes to the
        // same column, so a fix applied only to POST would leave the 500 alive
        // behind the editor's Save button.
        const created = await (await createCase('lock-put', 'Male')).json();

        const bad = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: body('lock-put', 'Homme'),
        });
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('invalid_patient_gender');

        const good = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: body('lock-put', 'Weiblich'),
        });
        expect(good.status).toBe(200);
        const stored = await fetchStored(created.id);
        expect(stored.patient_gender).toBe('Female');
        expect(stored.config.demographics.gender).toBe('Female');
    });

    it('PUT honours a top-level patient_gender when the config carries none', async () => {
        const created = await (await createCase('lock-put-top-level', 'Male')).json();
        const res = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: 'lock-put-top-level',
                system_prompt: 'p',
                patient_gender: 'Other',
                config: { demographics: { age: 55 }, patient_name: 'Test Patient' },
            }),
        });
        expect(res.status).toBe(200);
        const stored = await fetchStored(created.id);
        expect(stored.patient_gender).toBe('Other');
        expect(stored.config.demographics.gender).toBe('Other');
    });

    it('restoring a version re-derives patient_gender, patient_name and patient_age', async () => {
        // Regression lock: restore wrote back the config snapshot only, so
        // the denormalized columns kept describing the CURRENT version's
        // patient — the case list, debrief and lab ranges disagreed with the
        // restored config until the next manual save.
        const v1 = await (await admin('/api/cases', {
            method: 'POST',
            body: JSON.stringify({
                name: 'lock-restore',
                system_prompt: 'p',
                config: { demographics: { gender: 'Female', age: 72 }, patient_name: 'Greta Original' },
            }),
        })).json();

        const v2 = await admin(`/api/cases/${v1.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: 'lock-restore',
                system_prompt: 'p',
                config: { demographics: { gender: 'Male', age: 34 }, patient_name: 'Sven Edited' },
            }),
        });
        expect(v2.status).toBe(200);
        expect((await fetchStored(v1.id)).patient_gender).toBe('Male');

        const { versions } = await (await admin(`/api/cases/${v1.id}/versions`)).json();
        const first = versions[versions.length - 1];
        const restore = await admin(`/api/cases/${v1.id}/restore/${first.id}`, { method: 'POST' });
        expect(restore.status).toBe(200);

        const stored = await fetchStored(v1.id);
        expect(stored.patient_gender).toBe('Female');
        expect(stored.patient_name).toBe('Greta Original');
        expect(stored.patient_age).toBe(72);
        expect(stored.config.demographics.gender).toBe('Female');
    });

    describe('lab reference ranges follow the resolved gender', () => {
        // Regression lock: the default-lab catalogue read
        // `caseConfig.demographics?.gender || 'Male'` raw. A config carrying a
        // localized label ('Weiblich') is not 'Female' to labDatabase, so a
        // German female patient was handed the 'Both'/first-variation range —
        // for Hemoglobin that is the MALE range, silently. Rows like that
        // predate the write-back in POST/PUT and can arrive by direct
        // import, so the order path resolves the value itself.
        const insertLegacyCase = async (id, gender) => {
            await dbRun(server.dbPath,
                `INSERT INTO cases (id, name, system_prompt, config, tenant_id)
                 VALUES (?, ?, 'be a patient', ?, 1)`,
                [id, `legacy-${gender}`, JSON.stringify({
                    demographics: { gender, age: 50 },
                    investigations: { defaultLabsEnabled: true, labs: [] },
                })]);
            await dbRun(server.dbPath,
                `INSERT INTO sessions (id, case_id, user_id, student_name, status)
                 SELECT ?, ?, id, 'admin', 'active' FROM users WHERE username = 'admin'`,
                [id, id]);
        };

        const hemoglobinCategory = async (sessionId) => {
            const res = await admin(`/api/sessions/${sessionId}/available-labs`);
            expect(res.status).toBe(200);
            const { labs } = await res.json();
            return labs.find((lab) => lab.test_name === 'Hemoglobin')?.gender_category;
        };

        it.each([
            [9101, 'Weiblich', 'Female'],
            [9102, 'Maschio', 'Male'],
            [9103, 'female', 'Female'],
        ])('session %s with config gender %s gets the %s range', async (id, gender, expected) => {
            await insertLegacyCase(id, gender);
            expect(await hemoglobinCategory(id)).toBe(expected);
        });
    });
});
