// Regression lock: a scenario carries its own language, and its category is a
// keyed enum — not free text translated through a computed t() key.
//
// Two defects this pins:
//   1. `scenarios` had no language column, so an Italian pilot's scenarios sat
//      in the same list as English ones with nothing to filter or match them
//      against a case's `config.case_language` (migration 0045).
//   2. `scenarios.category` was free text, and the repository UI translated it
//      with `t(\`category_${id.toLowerCase()}\`, id)` — a COMPUTED key the i18n
//      parser cannot see, so nothing guaranteed a catalogue entry existed and
//      any string at all could be stored ('Emergenza Neurologica / Terapia
//      Intensiva'), matching no filter and rendering raw in every language.
//
// The fix is NON-BREAKING by contract (v2.9.41): recognised values are
// canonicalised, unrecognised ones are stored VERBATIM and reported in a
// non-fatal `warnings` array — legacy rows must keep saving. Language is the
// one strict field: it is new, nothing existing sends it, so an unknown code
// is an honest 400 `invalid_language`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES, DEFAULT_LANGUAGE } from '../../server/shared/languages.js';
import {
    SCENARIO_CATEGORIES,
    SCENARIO_CATEGORY_IDS,
    SCENARIO_CATEGORY_LABEL_KEYS,
    DEFAULT_SCENARIO_CATEGORY,
    resolveScenarioCategory,
} from '../../server/shared/scenarioCategories.js';
import { startTestServer } from '../utils/startTestServer.js';

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'locales');
const readNs = (lng, ns) => JSON.parse(readFileSync(join(localesDir, lng, `${ns}.json`), 'utf8'));

describe('resolveScenarioCategory', () => {
    it('exposes ten canonical ids with General as the default', () => {
        expect(SCENARIO_CATEGORY_IDS).toEqual([
            'Cardiac', 'Respiratory', 'Sepsis', 'Metabolic', 'Neurological',
            'Trauma', 'Toxicology', 'General', 'Recovery', 'Pediatric',
        ]);
        expect(DEFAULT_SCENARIO_CATEGORY).toBe('General');
        expect(Object.keys(SCENARIO_CATEGORY_LABEL_KEYS)).toEqual(SCENARIO_CATEGORY_IDS);
    });

    it.each(SCENARIO_CATEGORY_IDS)('accepts the id %s verbatim and case-insensitively', (id) => {
        expect(resolveScenarioCategory(id)).toEqual({ ok: true, value: id });
        expect(resolveScenarioCategory(` ${id.toUpperCase()} `)).toEqual({ ok: true, value: id });
    });

    it.each([
        // Localized labels — the whole point of the keyed enum.
        ['Cardiologico', 'Cardiac'],
        ['cardiac', 'Cardiac'],
        ['Kardial', 'Cardiac'],
        ['Neurologisch', 'Neurological'],
        ['Toksikologia', 'Toxicology'],
        ['Återhämtning', 'Recovery'],
        // The retired seed spellings.
        ['Cardiovascular', 'Cardiac'],
        ['Allergic', 'General'],
        // Qualified prose: exactly one known spelling inside the value.
        ['Emergenza Neurologica / Terapia Intensiva', 'Neurological'],
        ['Trauma cranico', 'Trauma'],
        ['Shock settico', 'Sepsis'],
    ])('repairs %s → %s', (value, id) => {
        expect(resolveScenarioCategory(value)).toEqual({ ok: true, value: id });
    });

    it('treats absent and blank as absent, not as an error', () => {
        expect(resolveScenarioCategory(undefined)).toEqual({ ok: true, value: null });
        expect(resolveScenarioCategory(null)).toEqual({ ok: true, value: null });
        expect(resolveScenarioCategory('   ')).toEqual({ ok: true, value: null });
    });

    it.each(['Emergenza generica', 'Cardiac / Respiratory', 'banana'])(
        'reports %s as unrecognised (unknown or ambiguous), naming the received value', (junk) => {
            expect(resolveScenarioCategory(junk)).toEqual({ ok: false, received: junk });
        });

    // Every catalogue label must round-trip, or a scenario authored in that UI
    // language stops resolving on import.
    const LOCALIZED_LABELS = Object.keys(LANGUAGES).flatMap((locale) => {
        const ns = readNs(locale, 'authoring_scenarios');
        return SCENARIO_CATEGORIES.map(({ id, labelKey }) => [locale, ns[labelKey], id]);
    });

    it.each(LOCALIZED_LABELS)('%s label "%s" resolves to %s', (_locale, label, id) => {
        expect(label, 'label missing from catalogue').toBeTruthy();
        expect(resolveScenarioCategory(label)).toEqual({ ok: true, value: id });
    });

    // Regression lock: scenario category was a computed t() key + free text.
    it('every canonical id has a literal catalogue key in every language', () => {
        Object.keys(LANGUAGES).forEach((locale) => {
            const ns = readNs(locale, 'authoring_scenarios');
            SCENARIO_CATEGORIES.forEach(({ labelKey }) => {
                expect(ns[labelKey], `${locale}:${labelKey}`).toBeTruthy();
            });
        });
    });
});

describe('scenario language + category on the wire', () => {
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

    const scenarioBody = (fields) => JSON.stringify({
        name: 'lock-scenario',
        description: 'regression lock',
        duration_minutes: 10,
        timeline: [{ time: 0, label: 'start', params: { hr: 90 }, rhythm: 'NSR' }],
        is_public: true,
        ...fields,
    });

    const create = (fields) => admin('/api/scenarios', { method: 'POST', body: scenarioBody(fields) });
    const read = async (id) => (await admin(`/api/scenarios/${id}`)).json();

    it('stores and returns the language a scenario was created with', async () => {
        const res = await create({ name: 'lock-lang-it', language: 'it', category: 'Cardiac' });
        expect(res.status).toBe(200);
        const { id } = await res.json();
        expect((await read(id)).language).toBe('it');

        const list = await (await admin('/api/scenarios')).json();
        expect(list.scenarios.find((s) => s.id === id).language).toBe('it');
    });

    it('defaults an unspecified language to the registry default', async () => {
        const { id } = await (await create({ name: 'lock-lang-default' })).json();
        expect((await read(id)).language).toBe(DEFAULT_LANGUAGE);
    });

    it('rejects an unknown language with 400 invalid_language naming the value', async () => {
        const res = await create({ name: 'lock-lang-bad', language: 'klingon' });
        expect(res.status).toBe(400);
        const payload = await res.json();
        expect(payload.code).toBe('invalid_language');
        expect(payload.error).toContain('klingon');
        expect(payload.error).toContain(Object.keys(LANGUAGES).join(', '));
    });

    it('canonicalises a localized category label on create', async () => {
        const { id } = await (await create({ name: 'lock-cat-it', category: 'Cardiologico' })).json();
        expect((await read(id)).category).toBe('Cardiac');

        const lower = await (await create({ name: 'lock-cat-lower', category: 'cardiac' })).json();
        expect((await read(lower.id)).category).toBe('Cardiac');
    });

    // Regression lock: scenario category was a computed t() key + free text.
    it('keeps an unrecognised category VERBATIM and warns instead of rejecting', async () => {
        const legacy = 'Emergenza generica del pronto soccorso';
        const res = await create({ name: 'lock-cat-legacy', category: legacy });
        expect(res.status).toBe(200);
        const payload = await res.json();
        expect(payload.warnings).toEqual([
            expect.objectContaining({ field: 'category', received: legacy }),
        ]);
        expect((await read(payload.id)).category).toBe(legacy);
    });

    it('answers without a warnings key when everything resolves', async () => {
        const payload = await (await create({ name: 'lock-clean', category: 'Sepsis', language: 'de' })).json();
        expect(payload.warnings).toBeUndefined();
    });

    it('PUT canonicalises the category, updates the language, and keeps the stored one when absent', async () => {
        const { id } = await (await create({ name: 'lock-put', category: 'Cardiac', language: 'it' })).json();

        const updated = await admin(`/api/scenarios/${id}`, {
            method: 'PUT',
            body: scenarioBody({ name: 'lock-put', category: 'Neurologico', language: 'de' }),
        });
        expect(updated.status).toBe(200);
        let stored = await read(id);
        expect(stored.category).toBe('Neurological');
        expect(stored.language).toBe('de');

        // An older client that sends no language must not reset the row.
        await admin(`/api/scenarios/${id}`, {
            method: 'PUT',
            body: scenarioBody({ name: 'lock-put', category: 'Cardiac' }),
        });
        stored = await read(id);
        expect(stored.language).toBe('de');

        const bad = await admin(`/api/scenarios/${id}`, {
            method: 'PUT',
            body: scenarioBody({ name: 'lock-put', category: 'Cardiac', language: 'xx' }),
        });
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('invalid_language');
    });

    it('filters the list by ?language= and rejects an unknown filter code', async () => {
        await create({ name: 'lock-filter-it', language: 'it' });
        await create({ name: 'lock-filter-sv', language: 'sv' });

        const italian = await (await admin('/api/scenarios?language=it')).json();
        expect(italian.scenarios.length).toBeGreaterThan(0);
        expect(italian.scenarios.every((s) => s.language === 'it')).toBe(true);
        expect(italian.scenarios.some((s) => s.name === 'lock-filter-it')).toBe(true);
        expect(italian.scenarios.some((s) => s.name === 'lock-filter-sv')).toBe(false);

        const bad = await admin('/api/scenarios?language=klingon');
        expect(bad.status).toBe(400);
        expect((await bad.json()).code).toBe('invalid_language');
    });

    it('stamps the seeded built-ins with the default language and canonical categories', async () => {
        const seeded = await admin('/api/scenarios/seed', { method: 'POST', body: '{}' });
        expect(seeded.status).toBe(200);

        const list = await (await admin('/api/scenarios')).json();
        const builtIns = list.scenarios.filter((s) => s.created_by === null);
        expect(builtIns.length).toBeGreaterThan(0);
        builtIns.forEach((scenario) => {
            expect(scenario.language).toBe(DEFAULT_LANGUAGE);
            expect(SCENARIO_CATEGORY_IDS).toContain(scenario.category);
        });
    });
});
