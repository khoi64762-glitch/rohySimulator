// Regression lock: editor modality list drifted from radiology_database.json.
//
// The case editor used to carry its own hardcoded modality list, and it did
// not know 'DEXA' or 'Mammography' even though the master radiology database
// ships studies under both. server/shared/diagnostics.js is now the single
// vocabulary; this test pins that every modality present in the data is a
// member of it, that every member has a translated label key in every
// locale, and that the diagnostics family predicate behaves.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    MODALITIES,
    DEFAULT_MODALITY,
    DIAGNOSTIC_MODALITIES,
    MODALITY_FAMILIES,
    MODALITY_LABEL_KEYS,
    FAMILY_LABEL_KEYS,
    isDiagnosticModality,
    modalityFamily,
    matchesModalityFamily,
    modalityLabel,
} from '../../server/shared/diagnostics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));

const radiologyDatabase = readJson('server/data/radiology_database.json').studies;
const dataModalities = [...new Set(radiologyDatabase.map((study) => study.modality))].sort();

describe('shared modality vocabulary vs radiology_database.json', () => {
    it('every modality present in the data is in MODALITIES (data-drift lock)', () => {
        const missing = dataModalities.filter((modality) => !MODALITIES.includes(modality));
        expect(missing, `radiology_database.json modalities missing from MODALITIES: ${missing.join(', ')}`).toEqual([]);
    });

    it('the data actually exercises DEXA and Mammography (the two that drifted)', () => {
        expect(dataModalities).toEqual(expect.arrayContaining(['DEXA', 'Mammography', 'Cardiac']));
    });

    it('MODALITIES has no duplicates and a default that is a member', () => {
        expect(new Set(MODALITIES).size).toBe(MODALITIES.length);
        expect(MODALITIES).toContain(DEFAULT_MODALITY);
    });

    it('every modality has a label key and every diagnostic modality is a modality', () => {
        MODALITIES.forEach((modality) => {
            expect(MODALITY_LABEL_KEYS[modality], `${modality} has no label key`).toMatch(/^modality_/);
        });
        DIAGNOSTIC_MODALITIES.forEach((modality) => expect(MODALITIES).toContain(modality));
    });
});

describe('modality label keys exist in every locale', () => {
    const localesDir = join(ROOT, 'src', 'locales');
    const locales = readdirSync(localesDir).filter((entry) => !entry.startsWith('.'));
    const keys = [...Object.values(MODALITY_LABEL_KEYS), ...Object.values(FAMILY_LABEL_KEYS)];

    it.each(locales)('%s/investigations.json carries every modality + family key', (lng) => {
        const catalogue = readJson(`src/locales/${lng}/investigations.json`);
        keys.forEach((key) => {
            expect(typeof catalogue[key], `${lng}/investigations.json#${key}`).toBe('string');
            expect(catalogue[key]).not.toBe('');
        });
    });
});

describe('diagnostics family predicates', () => {
    it('Cardiac is diagnostics; imaging modalities are imaging', () => {
        expect(isDiagnosticModality('Cardiac')).toBe(true);
        expect(modalityFamily('Cardiac')).toBe('diagnostics');
        expect(modalityFamily('X-Ray')).toBe('imaging');
        expect(modalityFamily('DEXA')).toBe('imaging');
    });

    it('matchesModalityFamily filters by family and lets everything through for all', () => {
        expect(MODALITY_FAMILIES).toEqual(['all', 'imaging', 'diagnostics']);
        expect(matchesModalityFamily('Cardiac', 'all')).toBe(true);
        expect(matchesModalityFamily('Cardiac', 'diagnostics')).toBe(true);
        expect(matchesModalityFamily('Cardiac', 'imaging')).toBe(false);
        expect(matchesModalityFamily('CT', 'imaging')).toBe(true);
        expect(matchesModalityFamily('CT', 'diagnostics')).toBe(false);
        // An unknown family never hides studies.
        expect(matchesModalityFamily('CT', 'bogus')).toBe(true);
    });

    it('the Diagnostics family of the real data is exactly the Cardiac studies', () => {
        const diagnostic = radiologyDatabase.filter((study) => matchesModalityFamily(study.modality, 'diagnostics'));
        expect(diagnostic.length).toBeGreaterThan(0);
        expect(diagnostic.every((study) => study.modality === 'Cardiac')).toBe(true);
        expect(diagnostic.map((study) => study.id)).toContain('ecg_12lead');
    });

    it('modalityLabel translates known values, shows unknown values verbatim, empties as Other', () => {
        const t = (key, opts) => `${opts.ns}:${key}`;
        expect(modalityLabel(t, 'X-Ray')).toBe('investigations:modality_xray');
        expect(modalityLabel(t, 'Astrology')).toBe('Astrology');
        expect(modalityLabel(t, '')).toBe('investigations:modality_other');
        expect(modalityLabel(t, undefined)).toBe('investigations:modality_other');
    });
});
