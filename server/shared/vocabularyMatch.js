/**
 * Shared matching kernel for the keyed vocabularies under server/shared/
 * (rhythms.js, scenarioCategories.js): a folded id/alias → canonical-id map,
 * looked up exactly first and then by unambiguous whole-word containment.
 *
 * Why containment: legacy rows and hand-written imports carry qualified
 * prose — 'Bradicardia Sinusale Marcata', 'Emergenza Neurologica / Terapia
 * Intensiva' — that no alias list can enumerate. If exactly ONE canonical id
 * has a spelling appearing as a whole word (or word run) inside the value,
 * that id is meant. A spelling nested inside a longer matched spelling
 * ('sinus' inside 'sinus tachycardia') is the same evidence; two independent
 * spellings for different ids ('AFib to VFib', 'Cardiac / Respiratory') are
 * ambiguous, so the caller keeps the value verbatim.
 */

/**
 * Fold a spelling to its comparison form: lower-case, letters/digits only
 * with single spaces. Callers may pre-strip decorations (e.g. a trailing
 * "(ABBR)") before folding.
 * @param {unknown} value
 * @returns {string}
 */
export function foldSpelling(value) {
    return String(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/**
 * Build the folded lookup once. Ids are entered first so a (hypothetical)
 * alias colliding with an id can never shadow it.
 * @param {string[]} ids
 * @param {Record<string, string[]>} aliases  id → human spellings
 * @param {(value: unknown) => string} fold
 * @returns {Map<string, string>}
 */
export function buildLookup(ids, aliases, fold = foldSpelling) {
    const lookup = new Map();
    ids.forEach((id) => lookup.set(fold(id), id));
    Object.entries(aliases).forEach(([id, spellings]) => {
        spellings.forEach((spelling) => {
            const folded = fold(spelling);
            if (!lookup.has(folded)) lookup.set(folded, id);
        });
    });
    return lookup;
}

/**
 * Canonical id for a folded value: exact hit, else the single id whose
 * spelling occurs as a whole word run inside the value. A shorter spelling
 * that sits inside a longer matched spelling ('sinus' inside 'sinus
 * tachycardia') is the same evidence, not a rival; two independent spellings
 * for different ids ('cardiac / respiratory', 'afib to vfib') are ambiguous.
 * @param {string} folded  Output of the same fold used to build `lookup`.
 * @param {Map<string, string>} lookup
 * @returns {string|null} canonical id, or null when unknown or ambiguous
 */
export function matchVocabulary(folded, lookup) {
    if (!folded) return null;
    const exact = lookup.get(folded);
    if (exact) return exact;
    const contains = (haystack, needle) => ` ${haystack} `.includes(` ${needle} `);
    const hits = [...lookup].filter(([spelling]) => contains(folded, spelling));
    const independent = hits.filter(([spelling]) =>
        !hits.some(([other]) => other !== spelling && contains(other, spelling)));
    const ids = new Set(independent.map(([, id]) => id));
    return ids.size === 1 ? [...ids][0] : null;
}
