/**
 * The radiology / diagnostics modality vocabulary.
 *
 * Lives under `server/shared/` because BOTH sides need it: the case editor
 * renders modalities as `<option value=…>` for custom studies, the student
 * ordering screen groups the catalogue by modality, and the server derives
 * the runtime groups from `server/data/radiology_database.json`. (Server code
 * importing from `src/` works locally and crashes in the Docker image, which
 * copies `server/` but not `src/` — hence this directory.)
 *
 * ---- the bug this module exists to prevent ----
 *
 * The case editor carried its own hardcoded modality list which had drifted
 * from the data: `radiology_database.json` ships 'DEXA' and 'Mammography'
 * studies, but an author could not pick either modality for a custom study,
 * and the editor's colour maps didn't know them. Meanwhile the "Radiology"
 * room quietly held the 12-lead ECG, Holter, echo and cath studies under the
 * 'Cardiac' modality — nothing on the student side said "diagnostic tests
 * live here too", so learners looking for an ECG never opened the room.
 *
 * ---- values vs labels ----
 *
 * The modality strings ('X-Ray', 'Cardiac', …) are STORED VALUES: they are
 * what `radiology_database.json`, every saved case's `config.radiology[]`
 * row and every persisted radiology order already contain. They stay in
 * English for data compatibility. Only the LABELS are translated — the eye
 * sees `t(MODALITY_LABEL_KEYS[modality], { ns: 'investigations' })`, the
 * database sees the English string.
 */

/**
 * Canonical modality values in authoring order (the first entry is the
 * default for a new custom study). Must be a superset of every `modality`
 * present in `server/data/radiology_database.json` — a server test locks
 * that (tests/server/diagnostics-modalities.test.js).
 */
export const MODALITIES = [
    'X-Ray',
    'CT',
    'MRI',
    'Ultrasound',
    'Nuclear Medicine',
    'Fluoroscopy',
    'Mammography',
    'DEXA',
    'Cardiac',
    'Other',
];

/** The modality applied when a custom study names none. */
export const DEFAULT_MODALITY = MODALITIES[0];

/**
 * Modalities that are diagnostic TESTS rather than imaging — the studies the
 * "Diagnostics" filter chip surfaces in both the student ordering UI and the
 * case editor. Today that is the 'Cardiac' group (12-lead ECG, Holter,
 * stress test, echo, cath). Future candidates once the data carries them:
 * 'Neuro' (EEG, EMG, nerve conduction), 'Pulmonary' (spirometry, PFTs).
 */
export const DIAGNOSTIC_MODALITIES = ['Cardiac'];

/**
 * Filter families for the All | Imaging | Diagnostics segment. Values are
 * ids, not prose; labels come from `FAMILY_LABEL_KEYS`.
 */
export const MODALITY_FAMILIES = ['all', 'imaging', 'diagnostics'];

/** Static i18n keys (namespace `investigations`) for the family chips. */
export const FAMILY_LABEL_KEYS = {
    all: 'filter_family_all',
    imaging: 'filter_family_imaging',
    diagnostics: 'filter_family_diagnostics',
};

/**
 * Static i18n keys (namespace `investigations`) for the modality labels.
 * Every entry of `MODALITIES` has one; the parser cannot see `t(map[x])`,
 * so the catalogue entries are maintained by hand (keepRemoved is on).
 */
export const MODALITY_LABEL_KEYS = {
    'X-Ray': 'modality_xray',
    'CT': 'modality_ct',
    'MRI': 'modality_mri',
    'Ultrasound': 'modality_ultrasound',
    'Nuclear Medicine': 'modality_nuclear_medicine',
    'Fluoroscopy': 'modality_fluoroscopy',
    'Mammography': 'modality_mammography',
    'DEXA': 'modality_dexa',
    'Cardiac': 'modality_cardiac',
    'Other': 'modality_other',
};

/**
 * True when a modality belongs to the diagnostics family.
 * @param {string} modality  Stored modality value.
 * @returns {boolean}
 */
export function isDiagnosticModality(modality) {
    return DIAGNOSTIC_MODALITIES.includes(modality);
}

/**
 * The family a modality belongs to: 'diagnostics' or 'imaging'.
 * @param {string} modality  Stored modality value.
 * @returns {'diagnostics'|'imaging'}
 */
export function modalityFamily(modality) {
    return isDiagnosticModality(modality) ? 'diagnostics' : 'imaging';
}

/**
 * Filter predicate for the All | Imaging | Diagnostics segment.
 * @param {string} modality  Stored modality value.
 * @param {'all'|'imaging'|'diagnostics'} family
 * @returns {boolean}
 */
export function matchesModalityFamily(modality, family) {
    if (family === 'all' || !MODALITY_FAMILIES.includes(family)) return true;
    return modalityFamily(modality) === family;
}

/**
 * The translated label for a stored modality value.
 *
 * Known values render through `MODALITY_LABEL_KEYS`; an unknown value (a
 * legacy custom study whose modality was free text) renders VERBATIM rather
 * than being folded into "Other" — hiding what the author typed would be
 * worse than showing it untranslated. An empty value renders as "Other".
 * @param {(key: string, opts?: object) => string} t  i18next translator.
 * @param {string} modality  Stored modality value.
 * @returns {string}
 */
export function modalityLabel(t, modality) {
    const key = MODALITY_LABEL_KEYS[modality];
    if (key) return t(key, { ns: 'investigations' });
    return modality || t(MODALITY_LABEL_KEYS.Other, { ns: 'investigations' });
}
