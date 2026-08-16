// Shared helpers for the i18n review pipeline (status sidecar + XLIFF).
//
// Used by scripts/i18n/status.mjs, xliff-export.mjs, xliff-import.mjs and
// (for the hash only) scripts/translate-locales.mjs. Everything here is
// pure filesystem + string work — no network, no console output.
//
// Data model (docs/integrator/i18n-review.md):
//   src/locales/en/<ns>.json                 canonical English (flat key → string)
//   src/locales/<lang>/<ns>.json             target catalogues (same shape)
//   src/locales/.status/<lang>.json          committed per-string review status:
//     { "<ns>.<key>": { src, state, reviewed_at, reviewer, risk } }
//   src/locales/.en-hashes.json              translate-locales.mjs sidecar (gitignored)
//
// Every script accepts `--root=<dir>` (or ROHY_LOCALES_ROOT) so tests run
// against a throwaway copy of the tree and never touch the real catalogues.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import IntlMessageFormat from 'intl-messageformat';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_LOCALES_ROOT = join(REPO_ROOT, 'src', 'locales');
export const SOURCE_LANGUAGE = 'en';
/** Locale folders that are generated, not translated — never reviewed. */
export const GENERATED_LOCALES = new Set(['en-XA']);
export const STATUS_DIR = '.status';

export const STATES = ['new', 'machine', 'reviewed', 'approved'];
export const RISKS = ['low', 'clinical'];

/** Namespaces whose strings carry clinical meaning (dose, vitals, orders …). */
export const CLINICAL_NAMESPACES = new Set([
    'orders', 'treatments', 'monitor', 'investigations', 'examination', 'patient', 'chat',
    'authoring_meds', 'authoring_labs', 'authoring_exam', 'authoring_radiology', 'authoring_scenarios'
]);

/** Same 12-hex prefix translate-locales.mjs has always recorded in .en-hashes.json. */
export const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

export const riskForNamespace = (ns) => (CLINICAL_NAMESPACES.has(ns) ? 'clinical' : 'low');

// ---- CLI plumbing ----------------------------------------------------------

/** `--flag`, `--flag=value`, positional. Repeated flags keep the last value. */
export function parseArgs(argv) {
    const positional = [];
    const flags = {};
    for (const arg of argv) {
        if (!arg.startsWith('--')) { positional.push(arg); continue; }
        const eq = arg.indexOf('=');
        if (eq === -1) flags[arg.slice(2)] = true;
        else flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
    return { positional, flags };
}

export const resolveLocalesRoot = (flags = {}) =>
    (typeof flags.root === 'string' && flags.root) || process.env.ROHY_LOCALES_ROOT || DEFAULT_LOCALES_ROOT;

export const packageVersion = () =>
    JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;

// ---- Catalogues -------------------------------------------------------------

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export function listNamespaces(root) {
    return readdirSync(join(root, SOURCE_LANGUAGE))
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''))
        .sort();
}

/** Target languages = every locale folder except en and the generated ones. */
export function listTargetLanguages(root, requested = []) {
    const present = readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name)
        .filter(l => l !== SOURCE_LANGUAGE && !GENERATED_LOCALES.has(l))
        .sort();
    if (!requested.length) return present;
    const unknown = requested.filter(l => !present.includes(l));
    if (unknown.length) throw new Error(`Unknown locale(s): ${unknown.join(', ')} (no folder under ${root})`);
    return requested;
}

export function readCatalogue(root, lang, ns) {
    const p = join(root, lang, `${ns}.json`);
    return existsSync(p) ? readJson(p) : {};
}

/** Sorted keys, 2-space indent, trailing newline — the shape every catalogue on disk already has. */
export function writeCatalogue(root, lang, ns, obj) {
    mkdirSync(join(root, lang), { recursive: true });
    const sorted = Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
    writeFileSync(join(root, lang, `${ns}.json`), JSON.stringify(sorted, null, 2) + '\n');
}

// ---- Status sidecar ---------------------------------------------------------

export const statusPath = (root, lang) => join(root, STATUS_DIR, `${lang}.json`);

export function readStatus(root, lang) {
    const p = statusPath(root, lang);
    return existsSync(p) ? readJson(p) : {};
}

export function writeStatus(root, lang, status) {
    mkdirSync(join(root, STATUS_DIR), { recursive: true });
    const sorted = Object.fromEntries(Object.keys(status).sort().map(k => [k, normaliseEntry(status[k])]));
    writeFileSync(statusPath(root, lang), JSON.stringify(sorted, null, 2) + '\n');
}

function normaliseEntry(e) {
    return {
        src: e.src,
        state: e.state,
        reviewed_at: e.reviewed_at ?? null,
        reviewer: e.reviewer ?? null,
        risk: e.risk
    };
}

export const machineEntry = (enValue, ns) => ({
    src: hash(enValue), state: 'machine', reviewed_at: null, reviewer: null, risk: riskForNamespace(ns)
});

/**
 * Ensure every key present in the target catalogue has a status entry.
 * Missing entries are added as `machine` at the current en hash (they were
 * LLM-translated); existing entries — including per-key risk overrides —
 * are preserved untouched. Idempotent. Returns { added, total }.
 */
export function bootstrapStatus(root, lang) {
    const status = readStatus(root, lang);
    let added = 0;
    for (const ns of listNamespaces(root)) {
        const en = readCatalogue(root, SOURCE_LANGUAGE, ns);
        const target = readCatalogue(root, lang, ns);
        for (const key of Object.keys(target)) {
            if (en[key] === undefined) continue;
            const id = `${ns}.${key}`;
            if (status[id]) continue;
            status[id] = machineEntry(en[key], ns);
            added += 1;
        }
    }
    writeStatus(root, lang, status);
    return { added, total: Object.keys(status).length };
}

// ---- Classification --------------------------------------------------------

export const CLASSES = ['new', 'stale', 'machine', 'reviewed', 'approved', 'removed'];

/**
 * Compare en ↔ target ↔ status for one language. Read-only.
 * Returns { rows, byNs, totals } where each row is
 * { ns, key, id, cls, risk, src, en, target, entry } and cls ∈ CLASSES:
 *   new       in en, missing in target
 *   stale     target present but status.src ≠ current en hash
 *   machine   hash current, state machine (or no status entry yet)
 *   reviewed  hash current, state reviewed
 *   approved  hash current, state approved
 *   removed   status entry whose key no longer exists in en
 */
export function computeStatus(root, lang) {
    const status = readStatus(root, lang);
    const rows = [];
    const seen = new Set();
    for (const ns of listNamespaces(root)) {
        const en = readCatalogue(root, SOURCE_LANGUAGE, ns);
        const target = readCatalogue(root, lang, ns);
        for (const [key, enValue] of Object.entries(en)) {
            const id = `${ns}.${key}`;
            seen.add(id);
            const entry = status[id];
            const risk = entry?.risk || riskForNamespace(ns);
            const src = hash(enValue);
            let cls;
            if (target[key] === undefined) cls = 'new';
            else if (!entry) cls = 'machine';
            else if (entry.src !== src) cls = 'stale';
            else cls = ['reviewed', 'approved'].includes(entry.state) ? entry.state : 'machine';
            rows.push({ ns, key, id, cls, risk, src, en: enValue, target: target[key], entry });
        }
    }
    for (const [id, entry] of Object.entries(status)) {
        if (seen.has(id)) continue;
        const dot = id.indexOf('.');
        rows.push({ ns: id.slice(0, dot), key: id.slice(dot + 1), id, cls: 'removed', risk: entry.risk, src: entry.src, entry });
    }
    return { rows, ...tally(rows) };
}

function tally(rows) {
    const empty = () => Object.fromEntries(CLASSES.map(c => [c, 0]));
    const byNs = {};
    const totals = empty();
    for (const r of rows) {
        byNs[r.ns] ??= empty();
        byNs[r.ns][r.cls] += 1;
        totals[r.cls] += 1;
    }
    return { byNs, totals };
}

// ---- ICU + glossary validation ---------------------------------------------

/** Argument names an ICU message references ({name}, {count, plural, …}, {x, select, …}). */
export function icuArgs(message) {
    const args = new Set();
    const walk = (elements) => {
        for (const el of elements) {
            if (typeof el.value === 'string' && el.type !== 0) args.add(el.value);
            if (el.options) Object.values(el.options).forEach(opt => walk(opt.value));
            if (el.children) walk(el.children);
        }
    };
    walk(new IntlMessageFormat(message, SOURCE_LANGUAGE).getAst());
    return args;
}

/** { ok: true } or { ok: false, error } — does the message compile as ICU? */
export function icuCompile(message) {
    try {
        new IntlMessageFormat(message, SOURCE_LANGUAGE);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export const isIcu = (message) => /\{[^}]*\}/.test(message);

/** Balanced {…} ignoring ICU-quoted literals ('{' / '}'). */
export function bracesBalanced(message) {
    const stripped = message.replace(/'[{}][^']*'?/g, '');
    let depth = 0;
    for (const ch of stripped) {
        if (ch === '{') depth += 1;
        else if (ch === '}') { depth -= 1; if (depth < 0) return false; }
    }
    return depth === 0;
}

export function loadGlossary() {
    const p = process.env.ROHY_I18N_GLOSSARY || join(REPO_ROOT, 'scripts', 'i18n-glossary.json');
    const raw = readJson(p);
    return Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('_')));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Glossary terms present in an English string, as [{ term, rendering }].
 * Lower-case terms match case-insensitively at a word start and may inflect
 * (patient/patients, dose/doses); terms with capitals (BP, ECG, IV Push …)
 * must match exactly as a whole word — "bp" in prose is not the abbreviation.
 */
export function glossaryTermsIn(enText, glossaryForLang = {}) {
    return Object.entries(glossaryForLang)
        .filter(([term]) => {
            const lower = term === term.toLowerCase();
            const tail = lower ? '' : '(?![\\p{L}\\p{N}])';
            return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}${tail}`, (lower ? 'i' : '') + 'u').test(enText);
        })
        .map(([term, rendering]) => ({ term, rendering }));
}

/**
 * Does the target contain the pinned rendering? Case-insensitive; every word
 * of the rendering must appear, and words may inflect at the end (5+ letters:
 * last letter free, 7+: last two — paziente/pazienti, somministrare/
 * somministrato, verabreichen/verabreicht). A plural or a participle must not
 * fail a review that used the agreed term; a different term still does.
 */
export function targetHasRendering(target, rendering) {
    const hay = target.toLowerCase();
    return rendering.toLowerCase().split(/\s+/).filter(Boolean).every(word => {
        const cut = word.length >= 7 ? 2 : word.length >= 5 ? 1 : 0;
        return hay.includes(cut ? word.slice(0, -cut) : word);
    });
}
