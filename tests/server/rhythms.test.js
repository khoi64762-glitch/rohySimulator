// Regression lock: the ECG rhythm vocabulary is one shared enum, and every
// rhythm string that reaches the database is a canonical id.
//
// Before server/shared/rhythms.js the case editor stored 'Atrial Fibrillation'
// while the monitor engine only branched on 'AFib' — so an author who picked
// "Ventricular Fibrillation" got a calm sinus trace, and an Italian scenario
// export ('Fibrillazione ventricolare') was accepted and rendered the same
// way. Nothing said why.
//
// Two halves:
//   1. resolveRhythm() — the pure resolver: ids, aliases, every locale's
//      catalogue label, and the honest `ok:false` for junk.
//   2. POST/PUT /cases and /scenarios canonicalise on write (alias → id) and
//      answer 400 {code:'invalid_rhythm'} for an unknown value, mirroring the
//      patient-gender guard (case-gender-i18n.test.js). Spawns the real
//      server against an empty database.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RHYTHMS,
    RHYTHM_IDS,
    RHYTHM_LABEL_KEYS,
    DEFAULT_RHYTHM,
    resolveRhythm,
} from '../../server/shared/rhythms.js';
import { startTestServer } from '../utils/startTestServer.js';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'locales');
const readNs = (lng, ns) => JSON.parse(readFileSync(join(localesDir, lng, `${ns}.json`), 'utf8'));

describe('resolveRhythm', () => {
    it('exposes ten canonical ids with NSR as the default', () => {
        expect(RHYTHM_IDS).toEqual([
            'NSR', 'Sinus Tachycardia', 'Sinus Bradycardia', 'AFib', 'Atrial Flutter',
            'SVT', 'VTach', 'VFib', 'Asystole', 'PEA',
        ]);
        expect(DEFAULT_RHYTHM).toBe('NSR');
        expect(Object.keys(RHYTHM_LABEL_KEYS)).toEqual(RHYTHM_IDS);
    });

    it.each(RHYTHM_IDS)('accepts the id %s verbatim and case-insensitively', (id) => {
        expect(resolveRhythm(id)).toEqual({ ok: true, value: id });
        expect(resolveRhythm(` ${id.toUpperCase()} `)).toEqual({ ok: true, value: id });
    });

    it.each([
        // The retired case-editor labels — the bug this module exists for.
        ['Atrial Fibrillation', 'AFib'],
        ['Ventricular Tachycardia', 'VTach'],
        ['Ventricular Fibrillation', 'VFib'],
        ['Normal Sinus Rhythm', 'NSR'],
        ['Sinus', 'NSR'],
        // The pre-fix informal server list.
        ['AFlutter', 'Atrial Flutter'],
        ['BradySinus', 'Sinus Bradycardia'],
        ['AFIB', 'AFib'],
        // Punctuation / abbreviation variants.
        ['A-Fib', 'AFib'],
        ['V-Tach', 'VTach'],
        ['pea', 'PEA'],
        // Localized free text from imported scenario JSON.
        ['Fibrillazione ventricolare', 'VFib'],
        ['Tachicardia Sinusale', 'Sinus Tachycardia'],
        ['Tachicardia sopraventricolare (TSV)', 'SVT'],
        ['Kammerflimmern', 'VFib'],
        ['Eteisvärinä', 'AFib'],
    ])('repairs the alias %s → %s', (alias, id) => {
        expect(resolveRhythm(alias)).toEqual({ ok: true, value: id });
    });

    it('treats absent and blank as absent, not as an error', () => {
        expect(resolveRhythm(undefined)).toEqual({ ok: true, value: null });
        expect(resolveRhythm(null)).toEqual({ ok: true, value: null });
        expect(resolveRhythm('')).toEqual({ ok: true, value: null });
        expect(resolveRhythm('   ')).toEqual({ ok: true, value: null });
    });

    it.each(['ASYSTOLE_TYPO', 'PVC', 'JunctionalEscape', 'banana'])(
        'reports %s as unrecognised, naming the received value', (junk) => {
            expect(resolveRhythm(junk)).toEqual({ ok: false, received: junk });
        });

    // Every catalogue label must round-trip through the resolver, or an
    // export from that UI language stops self-healing on import.
    const LOCALIZED_LABELS = ['en', 'de', 'es', 'it', 'fi', 'sv'].flatMap((locale) => {
        const monitor = readNs(locale, 'monitor');
        return RHYTHMS.map(({ id, labelKey }) => [locale, monitor[labelKey], id]);
    });

    it.each(LOCALIZED_LABELS)('%s label "%s" resolves to %s', (_locale, label, id) => {
        expect(label, 'label missing from catalogue').toBeTruthy();
        expect(resolveRhythm(label)).toEqual({ ok: true, value: id });
    });
});

describe('rhythms are canonicalised on write', () => {
    let server;
    let admin;

    beforeAll(async () => {
        server = await startTestServer({ seed: false });
        const res = await fetch(`${server.baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'admin123' }),
        });
        if (!res.ok) throw new Error(`login → ${res.status}: ${await res.text()}`);
        const { token } = await res.json();
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

    const caseBody = (name, rhythm, timelineRhythm) => JSON.stringify({
        name,
        description: 'regression lock',
        system_prompt: 'You are a patient.',
        config: {
            demographics: { gender: 'Male', age: 55 },
            patient_name: 'Test Patient',
            initialVitals: { hr: 110, spo2: 95, rhythm },
        },
        scenario: timelineRhythm === undefined ? null : {
            autoStart: false,
            timeline: [{ time: 0, params: { hr: 110 }, rhythm: timelineRhythm }],
        },
    });

    const createCase = (name, rhythm, timelineRhythm) =>
        admin('/api/cases', { method: 'POST', body: caseBody(name, rhythm, timelineRhythm) });

    it('stores the canonical id when the case editor sends the legacy long label', async () => {
        const res = await createCase('lock-alias', 'Atrial Fibrillation', 'Ventricular Tachycardia');
        expect(res.status).toBe(200);
        const { id } = await res.json();
        const stored = await (await admin(`/api/cases/${id}`)).json();
        expect(stored.config.initialVitals.rhythm).toBe('AFib');
        expect(stored.scenario.timeline[0].rhythm).toBe('VTach');
    });

    it('accepts every canonical id unchanged', async () => {
        for (const id of RHYTHM_IDS) {
            const res = await createCase(`lock-id-${id}`, id, id);
            expect(res.status, `rhythm=${id}`).toBe(200);
            const { id: caseId } = await res.json();
            const stored = await (await admin(`/api/cases/${caseId}`)).json();
            expect(stored.config.initialVitals.rhythm).toBe(id);
            expect(stored.scenario.timeline[0].rhythm).toBe(id);
        }
    });

    it('rejects an unknown initialVitals rhythm with 400 invalid_rhythm naming the value', async () => {
        const res = await createCase('lock-unknown', 'Fibrillazione ventricolare misspelt');
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload.code).toBe('invalid_rhythm');
        expect(payload.error).toContain('Fibrillazione ventricolare misspelt');
        expect(payload.error).toContain(RHYTHM_IDS.join(', '));
    });

    it('rejects an unknown rhythm inside the embedded scenario timeline', async () => {
        const res = await createCase('lock-unknown-frame', 'NSR', 'ASYSTOLE_TYPO');
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('invalid_rhythm');
    });

    it('treats an absent rhythm as absent, not as an error', async () => {
        const res = await createCase('lock-no-rhythm', undefined);
        expect(res.status).toBe(200);
    });

    it('guards PUT /cases as well as POST', async () => {
        const created = await (await createCase('lock-put', 'NSR')).json();

        const bad = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: caseBody('lock-put', 'not a rhythm'),
        });
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('invalid_rhythm');

        const good = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: caseBody('lock-put', 'Ventricular Fibrillation'),
        });
        expect(good.status).toBe(200);
        const stored = await (await admin(`/api/cases/${created.id}`)).json();
        expect(stored.config.initialVitals.rhythm).toBe('VFib');
    });

    const scenarioBody = (name, rhythms) => JSON.stringify({
        name,
        description: 'regression lock',
        duration_minutes: 10,
        category: 'Cardiac',
        is_public: true,
        timeline: rhythms.map((rhythm, i) => ({
            time: i * 60, label: `frame ${i}`, params: { hr: 90 }, rhythm,
        })),
    });

    it('POST /scenarios canonicalises localized labels frame by frame', async () => {
        const res = await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario', ['Tachicardia sinusale', 'AFlutter', 'VFib']),
        });
        expect(res.status).toBe(200);
        const { id } = await res.json();
        const stored = await (await admin(`/api/scenarios/${id}`)).json();
        expect(stored.timeline.map((frame) => frame.rhythm))
            .toEqual(['Sinus Tachycardia', 'Atrial Flutter', 'VFib']);
    });

    it('POST and PUT /scenarios reject an unknown rhythm with 400 invalid_rhythm', async () => {
        const bad = await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario-bad', ['NSR', 'JunctionalEscape']),
        });
        expect(bad.status).toBe(400);
        const payload = await bad.json();
        expect(payload.code).toBe('invalid_rhythm');
        expect(payload.error).toContain('JunctionalEscape');

        const created = await (await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario-put', ['NSR']),
        })).json();
        const badPut = await admin(`/api/scenarios/${created.id}`, {
            method: 'PUT',
            body: scenarioBody('lock-scenario-put', ['PVC']),
        });
        expect(badPut.status).toBe(400);
        expect((await badPut.json()).code).toBe('invalid_rhythm');

        const goodPut = await admin(`/api/scenarios/${created.id}`, {
            method: 'PUT',
            body: scenarioBody('lock-scenario-put', ['Atrial Fibrillation']),
        });
        expect(goodPut.status).toBe(200);
        const stored = await (await admin(`/api/scenarios/${created.id}`)).json();
        expect(stored.timeline[0].rhythm).toBe('AFib');
    });
});
