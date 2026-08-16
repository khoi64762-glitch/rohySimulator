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
//   2. POST/PUT /cases and /scenarios canonicalise on write (alias → id).
//      Since v2.9.41 an UNRECOGNISED value is NOT rejected: legacy rows and
//      the Italian pilot's scenarios carry free text that must keep saving,
//      and the monitor already renders sinus for anything it does not know.
//      It is stored verbatim and reported in a non-fatal `warnings` array.
//      Spawns the real server against an empty database.

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

    it.each([
        // Qualified prose: exactly one id/alias appears as a whole word run.
        ['Bradicardia Sinusale Marcata', 'Sinus Bradycardia'],
        ['Sinus tachycardia with PVCs', 'Sinus Tachycardia'],
        ['Ritmo sinusale con extrasistoli', 'NSR'],
        ['AF with RVR', 'AFib'],
    ])('repairs the qualified prose %s → %s (contains exactly one known spelling)', (value, id) => {
        expect(resolveRhythm(value)).toEqual({ ok: true, value: id });
    });

    it.each(['PVC', 'JunctionalEscape', 'banana', 'AFib to VFib'])(
        'reports %s as unrecognised (unknown or ambiguous), naming the received value', (junk) => {
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

describe('rhythms are canonicalised on write, never rejected', () => {
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

    // Regression lock (v2.9.41, non-breaking release): an unknown rhythm is
    // kept as written and warned about — rejecting it broke every legacy case.
    it('keeps an unknown initialVitals rhythm VERBATIM and warns, naming the value', async () => {
        const res = await createCase('lock-unknown', 'Ritmo idioventricolare accelerato');
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.warnings).toEqual([
            expect.objectContaining({
                field: 'config.initialVitals.rhythm',
                received: 'Ritmo idioventricolare accelerato',
            }),
        ]);
        expect(payload.warnings[0].hint).toContain(RHYTHM_IDS.join(', '));
        const { id } = payload;
        const stored = await (await admin(`/api/cases/${id}`)).json();
        expect(stored.config.initialVitals.rhythm).toBe('Ritmo idioventricolare accelerato');
    });

    it('keeps an unknown rhythm inside the embedded scenario timeline, naming its frame', async () => {
        const res = await createCase('lock-unknown-frame', 'NSR', 'JunctionalEscape');
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.warnings).toEqual([
            expect.objectContaining({ field: 'timeline[0].rhythm', received: 'JunctionalEscape' }),
        ]);
        const stored = await (await admin(`/api/cases/${payload.id}`)).json();
        expect(stored.scenario.timeline[0].rhythm).toBe('JunctionalEscape');
    });

    it('answers without a warnings key when every rhythm resolves', async () => {
        const payload = await (await createCase('lock-clean-rhythms', 'NSR', 'AFib')).json();
        expect(payload.warnings).toBeUndefined();
    });

    it('treats an absent rhythm as absent, not as an error', async () => {
        const res = await createCase('lock-no-rhythm', undefined);
        expect(res.status).toBe(200);
    });

    it('canonicalises PUT /cases as well as POST, warning without rejecting', async () => {
        const created = await (await createCase('lock-put', 'NSR')).json();

        const unknown = await admin(`/api/cases/${created.id}`, {
            method: 'PUT',
            body: caseBody('lock-put', 'not a rhythm'),
        });
        expect(unknown.status).toBe(200);
        expect((await unknown.json()).warnings).toEqual([
            expect.objectContaining({ field: 'config.initialVitals.rhythm', received: 'not a rhythm' }),
        ]);

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

    it('POST /scenarios repairs qualified prose the alias list cannot enumerate', async () => {
        const res = await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario-prose', ['Bradicardia Sinusale Marcata', 'AF with RVR']),
        });
        expect(res.status).toBe(200);
        const { id, warnings } = await res.json();
        expect(warnings).toBeUndefined();
        const stored = await (await admin(`/api/scenarios/${id}`)).json();
        expect(stored.timeline.map((frame) => frame.rhythm)).toEqual(['Sinus Bradycardia', 'AFib']);
    });

    // Regression lock (v2.9.41, non-breaking release): 400 invalid_rhythm is gone.
    it('POST and PUT /scenarios keep an unknown rhythm verbatim and warn', async () => {
        const res = await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario-unknown', ['NSR', 'JunctionalEscape']),
        });
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.warnings).toEqual([
            expect.objectContaining({ field: 'timeline[1].rhythm', received: 'JunctionalEscape' }),
        ]);
        const storedPost = await (await admin(`/api/scenarios/${payload.id}`)).json();
        expect(storedPost.timeline.map((frame) => frame.rhythm)).toEqual(['NSR', 'JunctionalEscape']);

        const created = await (await admin('/api/scenarios', {
            method: 'POST',
            body: scenarioBody('lock-scenario-put', ['NSR']),
        })).json();
        const unknownPut = await admin(`/api/scenarios/${created.id}`, {
            method: 'PUT',
            body: scenarioBody('lock-scenario-put', ['PVC']),
        });
        expect(unknownPut.status).toBe(200);
        expect((await unknownPut.json()).warnings).toEqual([
            expect.objectContaining({ field: 'timeline[0].rhythm', received: 'PVC' }),
        ]);

        const goodPut = await admin(`/api/scenarios/${created.id}`, {
            method: 'PUT',
            body: scenarioBody('lock-scenario-put', ['Atrial Fibrillation']),
        });
        expect(goodPut.status).toBe(200);
        const stored = await (await admin(`/api/scenarios/${created.id}`)).json();
        expect(stored.timeline[0].rhythm).toBe('AFib');
    });
});
