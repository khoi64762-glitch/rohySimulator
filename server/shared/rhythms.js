/**
 * The canonical ECG rhythm vocabulary a case or scenario carries.
 *
 * Lives under `server/shared/` because BOTH sides need it: the case editor
 * and the scenario repository render these as buttons / `<option value=…>`,
 * the patient monitor keys its waveform engine on them, and
 * `cases-routes.js` canonicalises the submitted value before it is written.
 * (Server code importing from `src/` works locally and crashes in the Docker
 * image, which copies `server/` but not `src/` — hence this directory.)
 *
 * ---- the bug this module exists to prevent ----
 *
 * Three authoring surfaces each carried their own rhythm list and none of
 * them agreed with the monitor engine:
 *
 *   - the case editor stored long English labels ('Atrial Fibrillation',
 *     'Ventricular Tachycardia') as the value,
 *   - the scenario repository stored short ids ('AFib', 'VTach') plus 'PEA',
 *   - the monitor engine branched on `rhythm === 'AFib' | 'VTach' | 'VFib' |
 *     'Asystole'` and rendered EVERYTHING else — including 'Atrial
 *     Fibrillation' from the case editor and Italian free text from an
 *     imported scenario JSON — as a sinus trace at the configured HR.
 *
 * So an author who picked "Ventricular Fibrillation" in the case editor got a
 * patient with a calm sinus rhythm, and nothing said why.
 *
 * ---- ids ----
 *
 * The ids are the scenario-repository strings, because those are what the
 * monitor engine already matches on and what every stored scenario timeline
 * and persisted vitals row already contains — keeping them avoids a data
 * migration. They are ids, not prose: the eye sees `t(RHYTHM_LABEL_KEYS[id])`.
 * The long editor names, common abbreviations and every locale's label are
 * ALIASES that `resolveRhythm()` repairs on write and on read, so legacy
 * cases keep working and a translated import self-heals.
 */

/**
 * Canonical rhythm ids in authoring order (the first entry is the default).
 * `labelKey` is a key in the `monitor` i18n namespace — the monitor owns the
 * vocabulary; authoring screens call `t(labelKey, { ns: 'monitor' })`.
 */
export const RHYTHMS = [
    { id: 'NSR', labelKey: 'rhythm_nsr' },
    { id: 'Sinus Tachycardia', labelKey: 'rhythm_sinus_tach' },
    { id: 'Sinus Bradycardia', labelKey: 'rhythm_sinus_brady' },
    { id: 'AFib', labelKey: 'rhythm_afib' },
    { id: 'Atrial Flutter', labelKey: 'rhythm_aflutter' },
    { id: 'SVT', labelKey: 'rhythm_svt' },
    { id: 'VTach', labelKey: 'rhythm_vtach' },
    { id: 'VFib', labelKey: 'rhythm_vfib' },
    { id: 'Asystole', labelKey: 'rhythm_asystole' },
    { id: 'PEA', labelKey: 'rhythm_pea' },
];

/** The ids alone, in the same order. */
export const RHYTHM_IDS = RHYTHMS.map((rhythm) => rhythm.id);

/** The rhythm applied when a case names none. */
export const DEFAULT_RHYTHM = RHYTHM_IDS[0];

/**
 * Literal id → i18n key map (namespace `monitor`), for the enum-label rule:
 * never `t(\`rhythm_${x}\`)`, always a static map the parser can see.
 */
export const RHYTHM_LABEL_KEYS = Object.fromEntries(
    RHYTHMS.map((rhythm) => [rhythm.id, rhythm.labelKey]),
);

/**
 * Accepted spellings per id: the retired case-editor labels, common clinical
 * abbreviations, the pre-fix informal server list ('AFlutter', 'BradySinus'),
 * and the label each locale catalogue ships (so a scenario exported from an
 * Italian UI, or typed by hand in Finnish, resolves instead of silently
 * rendering sinus). Matching is normalised — case, whitespace, punctuation
 * and a trailing "(ABBR)" are ignored — so entries here are the human form.
 *
 * `tests/server/rhythms.test.js` reads every locale's `rhythm_*` value and
 * asserts it resolves; add the label here when you add a language.
 */
export const RHYTHM_ALIASES = {
    NSR: [
        'Normal Sinus Rhythm', 'Sinus Rhythm', 'Sinus', 'Normal',
        'Normaler Sinusrhythmus', 'Sinusrhythmus',
        'Ritmo sinusal normal', 'Ritmo sinusal',
        'Ritmo sinusale normale', 'Ritmo sinusale',
        'Normaali sinusrytmi', 'Sinusrytmi',
        'Normal sinusrytm', 'Sinusrytm',
    ],
    'Sinus Tachycardia': [
        'SinusTach', 'Sinus Tach', 'Sinustachykardie', 'Taquicardia sinusal',
        'Tachicardia sinusale', 'Sinustakykardia', 'Sinustakykardi',
    ],
    'Sinus Bradycardia': [
        'SinusBrady', 'Sinus Brady', 'BradySinus', 'Sinusbradykardie',
        'Bradicardia sinusal', 'Bradicardia sinusale', 'Sinusbradykardia',
        'Sinusbradykardi',
    ],
    AFib: [
        'Atrial Fibrillation', 'AF', 'A-Fib', 'Vorhofflimmern', 'VHF',
        'Fibrilación auricular', 'FA', 'Fibrillazione atriale', 'Eteisvärinä',
        'Förmaksflimmer', 'FF',
    ],
    'Atrial Flutter': [
        'AFlutter', 'AFL', 'Flutter', 'Vorhofflattern', 'Flúter auricular',
        'Aleteo auricular', 'Flutter atriale', 'Eteislepatus', 'Förmaksfladder',
    ],
    SVT: [
        'Supraventricular Tachycardia', 'PSVT', 'Supraventrikuläre Tachykardie',
        'Taquicardia supraventricular', 'TSV', 'Tachicardia sopraventricolare',
        'Supraventrikulaarinen takykardia', 'Supraventrikulär takykardi',
    ],
    VTach: [
        'Ventricular Tachycardia', 'VT', 'V-Tach', 'Kammertachykardie',
        'Ventrikuläre Tachykardie', 'Taquicardia ventricular', 'TV',
        'Tachicardia ventricolare', 'Kammiotakykardia', 'Kammartakykardi',
    ],
    VFib: [
        'Ventricular Fibrillation', 'VF', 'V-Fib', 'Kammerflimmern',
        'Fibrilación ventricular', 'FV', 'Fibrillazione ventricolare',
        'Kammiovärinä', 'Kammarflimmer',
    ],
    Asystole: ['Asystolie', 'Asistolia', 'Asystolia', 'Asystoli', 'Flatline'],
    PEA: [
        'Pulseless Electrical Activity', 'Pulslose elektrische Aktivität',
        'Actividad eléctrica sin pulso', 'AESP', 'Attività elettrica senza polso',
        'Sykkeetön rytmi', 'Pulslös elektrisk aktivitet',
    ],
};

/**
 * Fold a spelling to its comparison form: lower-case, no trailing
 * parenthetical, letters/digits only with single spaces. 'A-Fib' → 'afib',
 * 'Tachicardia sopraventricolare (TSV)' → 'tachicardia sopraventricolare'.
 */
function foldRhythm(value) {
    return String(value)
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

// Built once: folded id or alias → canonical id. Ids are entered first so a
// (hypothetical) alias colliding with an id can never shadow it.
const LOOKUP = new Map();
RHYTHM_IDS.forEach((id) => LOOKUP.set(foldRhythm(id), id));
Object.entries(RHYTHM_ALIASES).forEach(([id, aliases]) => {
    aliases.forEach((alias) => {
        const folded = foldRhythm(alias);
        if (!LOOKUP.has(folded)) LOOKUP.set(folded, id);
    });
});

/**
 * Resolve a submitted rhythm to its canonical id.
 *
 * Three outcomes, kept distinct on purpose (mirrors `resolvePatientGender`):
 *
 *   absent / blank      → { ok: true,  value: null }    nothing to store
 *   recognised          → { ok: true,  value: 'AFib' }  canonical id
 *   present but unknown → { ok: false, received }       caller should reject
 *
 * "Recognised" covers the ids themselves, case/whitespace/punctuation
 * variants, and every alias above.
 */
export function resolveRhythm(value) {
    if (value === null || value === undefined) return { ok: true, value: null };
    const trimmed = String(value).trim();
    if (trimmed === '') return { ok: true, value: null };
    const match = LOOKUP.get(foldRhythm(trimmed));
    return match ? { ok: true, value: match } : { ok: false, received: trimmed };
}
