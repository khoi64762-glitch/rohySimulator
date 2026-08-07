// The patient-demographic vocabulary contract.
//
// Regression lock: a localized <option> label used to be stored as the value
// itself, so saving a case in German/Italian/Finnish/Swedish/Spanish returned
// HTTP 500 — `CHECK constraint failed: patient_gender IN ('Male','Female','Other')`.
// English passed only because t('demo_gender_male') is the word "Male".
//
// Two halves, and the second is the one that stops it recurring:
//   1. resolvePatientGender()/bodyMapGender() behave as documented.
//   2. A STATIC SCAN of the JSX: any <option> whose label comes from t() must
//      carry an explicit `value`. Nothing else in the test suite can catch a
//      new dropdown added without one — it renders fine, passes review, and
//      only fails for users who are not reading the app in English.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_PERSONA_TYPE,
    MARITAL_STATUSES,
    PATIENT_GENDERS,
    PERSONA_TYPES,
    bodyMapGender,
    resolvePatientGender,
} from '../../server/shared/patientDemographics.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = join(repoRoot, 'src');

function jsxFiles(dir, found = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            if (entry === 'node_modules') continue;
            jsxFiles(full, found);
        } else if (entry.endsWith('.jsx') && !entry.endsWith('.test.jsx')) {
            found.push(full);
        }
    }
    return found;
}

/**
 * Strip block comments before scanning.
 *
 * Not incidental tidying: the comment explaining THIS RULE, in ConfigPanel.jsx,
 * quotes an option tag as prose — and the scanner duly matched it and reported
 * the correctly-fixed dropdown beneath it as an offender. A source scanner that
 * reads comments as code produces false positives precisely where someone has
 * taken the trouble to document the hazard.
 *
 * Line comments are left alone: `//` appears inside every JSX URL string, and
 * removing them would do more damage than the case it would cover.
 *
 * Blanked to spaces rather than deleted, so byte offsets and line numbers still
 * point at the real source — an offender reported at the wrong line is barely
 * better than one not reported at all.
 */
const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

/** Every option element in the client source, with its attributes and label. */
function allOptions() {
    const options = [];
    for (const file of jsxFiles(srcDir)) {
        const source = stripComments(readFileSync(file, 'utf8'));
        const re = /<option\b([^>]*)>([\s\S]*?)<\/option>/g;
        let match;
        while ((match = re.exec(source))) {
            const line = source.slice(0, match.index).split('\n').length;
            options.push({
                file: relative(repoRoot, file),
                line,
                attrs: match[1],
                label: match[2],
            });
        }
    }
    return options;
}

describe('patient demographic vocabularies', () => {
    describe('resolvePatientGender', () => {
        it('passes canonical values through', () => {
            for (const gender of PATIENT_GENDERS) {
                expect(resolvePatientGender(gender)).toEqual({ ok: true, value: gender });
            }
        });

        it('repairs casing and whitespace rather than rejecting it', () => {
            // 'male' was never valid against the CHECK either — rejecting a
            // legacy or API client over capitalisation would be pedantry.
            expect(resolvePatientGender('male')).toEqual({ ok: true, value: 'Male' });
            expect(resolvePatientGender('  FEMALE  ')).toEqual({ ok: true, value: 'Female' });
        });

        it('treats absent and blank as "nothing to store", not as an error', () => {
            for (const empty of [null, undefined, '', '   ']) {
                expect(resolvePatientGender(empty)).toEqual({ ok: true, value: null });
            }
        });

        it.each([
            ['de', 'Männlich'],
            ['it', 'Maschio'],
            ['fi', 'Mies'],
            ['sv', 'Kvinna'],
            ['es', 'Masculino'],
        ])('rejects the %s label instead of letting it reach the CHECK', (_locale, label) => {
            expect(resolvePatientGender(label)).toEqual({ ok: false, received: label });
        });
    });

    describe('bodyMapGender', () => {
        it('maps female, and defaults everything else to male', () => {
            expect(bodyMapGender('Female')).toBe('female');
            expect(bodyMapGender('female')).toBe('female');
            expect(bodyMapGender('Male')).toBe('male');
            // 'Other' has no anatomical asset — documented male fallback.
            expect(bodyMapGender('Other')).toBe('male');
            expect(bodyMapGender(undefined)).toBe('male');
        });

        it('no longer silently mislabels a translated value as male', () => {
            // Regression lock: the old `gender.toLowerCase() === 'female'` test
            // rendered a MALE body map for a German female patient, with no
            // error. The value is still unrecognised — but it is now
            // unrecognised in exactly one documented place, and the server
            // rejects it at write time so it cannot be stored at all.
            expect(resolvePatientGender('Weiblich').ok).toBe(false);
        });
    });

    describe('the editor submits stored values, not translated labels', () => {
        const options = allOptions();

        it('finds options to check (guards against a broken scan)', () => {
            expect(options.length).toBeGreaterThan(20);
        });

        it('every translated <option> carries an explicit value', () => {
            const offenders = options
                .filter((option) => /\bt\(/.test(option.label))
                .filter((option) => !/\bvalue\s*=/.test(option.attrs))
                .map((option) => `${option.file}:${option.line} → ${option.label.trim()}`);

            expect(
                offenders,
                'An <option> without a `value` submits its TEXT CONTENT. With a t() label '
                + 'that means the stored value changes with the UI language — which is how '
                + 'saving a case came to return HTTP 500 in every non-English locale. '
                + 'Add an explicit English value; see server/shared/patientDemographics.js.',
            ).toEqual([]);
        });

        it.each([
            ['gender', PATIENT_GENDERS],
            ['marital status', MARITAL_STATUSES],
            ['persona', PERSONA_TYPES],
        ])('offers exactly the canonical %s values', (_name, vocabulary) => {
            const values = new Set(
                options
                    .map((option) => /\bvalue\s*=\s*"([^"]*)"/.exec(option.attrs)?.[1])
                    .filter((value) => value),
            );
            for (const canonical of vocabulary) {
                expect(
                    values.has(canonical),
                    `no <option value="${canonical}"> anywhere in src/ — the vocabulary and the `
                    + 'editor have drifted apart',
                ).toBe(true);
            }
        });
    });

    describe('vocabulary hygiene', () => {
        it('the persona default is a real persona', () => {
            expect(PERSONA_TYPES).toContain(DEFAULT_PERSONA_TYPE);
        });

        it('has no duplicates', () => {
            for (const vocabulary of [PATIENT_GENDERS, MARITAL_STATUSES, PERSONA_TYPES]) {
                expect(new Set(vocabulary).size).toBe(vocabulary.length);
            }
        });

        it('mirrors the cases.patient_gender CHECK constraint exactly', () => {
            // If this list changes, the constraint needs a migration — the two
            // are one contract split across two files.
            expect(PATIENT_GENDERS).toEqual(['Male', 'Female', 'Other']);
            const initial = readFileSync(join(repoRoot, 'migrations', '0001_initial.sql'), 'utf8');
            expect(initial).toContain("patient_gender IN ('Male', 'Female', 'Other')");
        });
    });
});
