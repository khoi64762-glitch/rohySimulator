#!/usr/bin/env node
// Translation status report — step 2 of the review pipeline
// (docs/integrator/i18n-review.md). Read-only unless --bootstrap.
//
// Usage:
//   npm run i18n:status                    # every target language
//   npm run i18n:status -- it de           # subset
//   npm run i18n:status -- --json          # machine-readable
//   npm run i18n:status -- --check         # exit 1 if any CLINICAL key is new or stale (release gate)
//   npm run i18n:status -- --bootstrap     # add missing status entries as `machine` (idempotent)
//   --root=<dir> / ROHY_LOCALES_ROOT       # operate on another locale tree (tests)
//
// Per key: new (in en, missing in target) · stale (status hash ≠ current en) ·
// machine / reviewed / approved (hash current) · removed (status entry whose
// key left en — pruned by the next export/import).

import {
    parseArgs, resolveLocalesRoot, listTargetLanguages, computeStatus, bootstrapStatus, CLASSES
} from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const root = resolveLocalesRoot(flags);
const langs = listTargetLanguages(root, positional);

if (flags.bootstrap) {
    for (const lang of langs) {
        const { added, total } = bootstrapStatus(root, lang);
        console.log(`${lang}: +${added} status entr${added === 1 ? 'y' : 'ies'} (${total} total)`);
    }
}

const report = Object.fromEntries(langs.map(lang => {
    const { rows, byNs, totals } = computeStatus(root, lang);
    const clinicalGaps = rows.filter(r => r.risk === 'clinical' && (r.cls === 'new' || r.cls === 'stale'));
    return [lang, { byNs, totals, clinical_gaps: clinicalGaps.map(r => ({ id: r.id, cls: r.cls })) }];
}));

if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    for (const [lang, { byNs, totals, clinical_gaps }] of Object.entries(report)) {
        console.log(`\n== ${lang} ==`);
        console.log(formatTable(byNs, totals));
        if (clinical_gaps.length) {
            console.log(`  clinical keys new/stale: ${clinical_gaps.length}` +
                (clinical_gaps.length <= 20 ? ` — ${clinical_gaps.map(g => `${g.id} (${g.cls})`).join(', ')}` : ''));
        }
    }
}

if (flags.check) {
    const failing = Object.entries(report).filter(([, r]) => r.clinical_gaps.length);
    if (failing.length) {
        console.error(`\ni18n:status --check FAILED — clinical keys awaiting translation/review: ` +
            failing.map(([lang, r]) => `${lang}=${r.clinical_gaps.length}`).join(', '));
        process.exit(1);
    }
    console.log('\ni18n:status --check passed — no clinical key is new or stale.');
}

function formatTable(byNs, totals) {
    const header = ['namespace', ...CLASSES];
    const rows = [...Object.entries(byNs).map(([ns, c]) => [ns, ...CLASSES.map(k => c[k])]), ['TOTAL', ...CLASSES.map(k => totals[k])]];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
    const line = (cells) => '  ' + cells.map((c, i) => String(c)[i === 0 ? 'padEnd' : 'padStart'](widths[i])).join('  ');
    return [line(header), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}
