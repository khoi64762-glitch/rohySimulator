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
// imported case must get an honest 400 rather than a 500 with raw SQL in it.
//
// Spawns the real server against an empty database (real boot path).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';

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

    // The exact strings each locale's catalogue returns for demo_gender_male /
    // demo_gender_female — i.e. what the browser used to submit.
    it.each([
        ['de', 'Männlich'],
        ['es', 'Masculino'],
        ['fi', 'Mies'],
        ['it', 'Maschio'],
        ['sv', 'Kvinna'],
    ])('rejects the %s label with 400, not 500', async (locale, label) => {
        const res = await createCase(`lock-${locale}`, label);

        // The precise failure this locks out. Before the fix this was 500.
        expect(res.status).toBe(400);

        const payload = await res.json();
        expect(payload.code).toBe('invalid_patient_gender');
        expect(payload.error).toContain(label);
        expect(payload.error).toContain('Male, Female, Other');

        // And it must not leak the schema on the way out.
        expect(payload.error).not.toMatch(/SQLITE|CHECK constraint/i);
    });

    it('repairs legacy lowercase rather than rejecting it', async () => {
        // 'male' never satisfied the constraint either, so an older client or
        // an imported case would have hit the same 500. Normalised, not refused.
        const res = await createCase('lock-lowercase', 'male');
        expect(res.status).toBe(200);
        const { id } = await res.json();
        const fetched = await (await admin(`/api/cases/${id}`)).json();
        const stored = fetched.case ?? fetched;
        expect(stored.patient_gender).toBe('Male');
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
            body: body('lock-put', 'Weiblich'),
        });
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('invalid_patient_gender');

        const good = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: body('lock-put', 'Female'),
        });
        expect(good.status).toBe(200);
    });
});
