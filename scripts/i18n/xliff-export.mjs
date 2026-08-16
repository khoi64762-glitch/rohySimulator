#!/usr/bin/env node
// XLIFF 1.2 export — step 3 of the review pipeline (docs/integrator/i18n-review.md).
//
// Usage:
//   npm run i18n:xliff:export -- it                         # everything not yet reviewed/approved
//   npm run i18n:xliff:export -- it --only=new,stale        # narrower
//   npm run i18n:xliff:export -- it --ns=orders,treatments  # some namespaces
//   npm run i18n:xliff:export -- it --out=path.xlf --date=YYYYMMDD
//   --root=<dir> / ROHY_LOCALES_ROOT                        # other locale tree (tests)
//
// Writes i18n/xliff/<lang>/rohy-<lang>-<YYYYMMDD>.xlf (folder is gitignored —
// exports are transient; the committed truth is the JSON + .status sidecar).
// One <file> per namespace, one <trans-unit> per key. Incremental by
// construction: --only defaults to new,stale,machine. Also prunes `removed`
// status entries (keys that left en) and adds missing entries as `machine`.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import {
    REPO_ROOT, parseArgs, resolveLocalesRoot, listTargetLanguages, computeStatus, readStatus, writeStatus,
    machineEntry, loadGlossary, packageVersion, icuArgs, isIcu, SOURCE_LANGUAGE, CLASSES
} from './lib.mjs';
import { escapeText, escapeAttr } from './xml.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
if (positional.length !== 1) {
    console.error('Usage: i18n:xliff:export <lang> [--only=new,stale,machine] [--ns=a,b] [--out=path] [--date=YYYYMMDD]');
    process.exit(2);
}
const root = resolveLocalesRoot(flags);
const [lang] = listTargetLanguages(root, positional);
const only = String(flags.only || 'new,stale,machine').split(',').map(s => s.trim()).filter(Boolean);
const badOnly = only.filter(c => !CLASSES.includes(c) || c === 'removed');
if (badOnly.length) { console.error(`--only: unknown class(es) ${badOnly.join(', ')}`); process.exit(2); }
const nsFilter = flags.ns ? new Set(String(flags.ns).split(',').map(s => s.trim())) : null;
const date = flags.date ? String(flags.date) : new Date().toISOString().slice(0, 10).replace(/-/g, '');
if (!/^\d{8}$/.test(date)) { console.error('--date must be YYYYMMDD'); process.exit(2); }
const outPath = flags.out ? resolve(String(flags.out)) : join(REPO_ROOT, 'i18n', 'xliff', lang, `rohy-${lang}-${date}.xlf`);

// ---- Status housekeeping (prune removed, register untracked machine keys) ----
const { rows } = computeStatus(root, lang);
const status = readStatus(root, lang);
let pruned = 0;
let registered = 0;
for (const r of rows) {
    if (r.cls === 'removed') { delete status[r.id]; pruned += 1; }
    else if (r.cls === 'machine' && !r.entry) { status[r.id] = machineEntry(r.en, r.ns); registered += 1; }
}
if (pruned || registered) writeStatus(root, lang, status);

// ---- XLIFF ------------------------------------------------------------------
const XLIFF_STATE = { new: 'new', stale: 'needs-review-translation', machine: 'needs-review-translation', reviewed: 'translated', approved: 'signed-off' };
const glossary = loadGlossary()[lang] || {};
const version = packageVersion();
const isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`;

const selected = rows.filter(r => r.cls !== 'removed' && only.includes(r.cls) && (!nsFilter || nsFilter.has(r.ns)));
const byNs = new Map();
for (const r of selected) { if (!byNs.has(r.ns)) byNs.set(r.ns, []); byNs.get(r.ns).push(r); }

const glossaryNote = Object.keys(glossary).length
    ? `Pinned clinical glossary (en → ${lang}), use EXACTLY these renderings: ` +
      Object.entries(glossary).map(([en, tr]) => `"${en}" → "${tr}"`).join('; ')
    : `No pinned glossary for ${lang}.`;

function safeIcuArgs(message) {
    try { return [...icuArgs(message)]; } catch { return []; }
}

const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">'];
for (const [ns, units] of byNs) {
    out.push(`  <file original="${ns}.json" source-language="${SOURCE_LANGUAGE}" target-language="${escapeAttr(lang)}" datatype="plaintext" product-name="rohy" product-version="${escapeAttr(version)}" date="${isoDate}">`);
    out.push('    <header>');
    out.push(`      <note>${escapeText(glossaryNote)}</note>`);
    out.push('      <note>Target states: new = untranslated; needs-review-translation = machine translation or English changed since review; translated = reviewed; signed-off = approved. ICU MessageFormat is plain text in this phase — every {argument} listed in the icu-args note must survive verbatim.</note>');
    out.push('    </header>');
    out.push('    <body>');
    for (const r of units) {
        const approved = r.cls === 'approved' ? 'yes' : 'no';
        const target = r.cls === 'new' ? '' : r.target;
        out.push(`      <trans-unit id="${escapeAttr(r.key)}" resname="${escapeAttr(r.key)}" approved="${approved}">`);
        out.push(`        <source xml:space="preserve">${escapeText(r.en)}</source>`);
        out.push(`        <target state="${XLIFF_STATE[r.cls]}" xml:space="preserve">${escapeText(target)}</target>`);
        out.push(`        <note from="rohy">risk=${r.risk}; icu=${isIcu(r.en) ? 'yes' : 'no'}; src=${r.src}</note>`);
        if (isIcu(r.en)) {
            const args = safeIcuArgs(r.en);
            if (args.length) out.push(`        <note from="rohy">icu-args=${escapeText(args.join(', '))}</note>`);
        }
        out.push('      </trans-unit>');
    }
    out.push('    </body>');
    out.push('  </file>');
}
out.push('</xliff>', '');

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out.join('\n'));

const perNs = [...byNs].map(([ns, units]) => `${ns}=${units.length}`).join(', ');
console.log(`${lang}: ${selected.length} unit(s) in ${byNs.size} file(s) → ${outPath}` + (perNs ? `\n  ${perNs}` : ''));
if (pruned || registered) console.log(`  status: pruned ${pruned} removed entr${pruned === 1 ? 'y' : 'ies'}, registered ${registered} untracked key(s) as machine`);
