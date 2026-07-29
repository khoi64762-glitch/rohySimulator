/**
 * Refresh every embedded licence from its canonical upstream source.
 *
 *   node scripts/sync-licenses.mjs           # refresh, tolerate no network
 *   node scripts/sync-licenses.mjs --strict  # refresh, FAIL on any problem
 *
 * Runs as part of `npm run build`, so a build always carries licence text
 * fetched from the canonical source rather than a copy someone hand-edited
 * months ago. The texts stay COMMITTED: the Carm licence requires that
 * redistributed copies "include the licence text itself, not only a link", so
 * the npm tarball and every offline build must contain them regardless of
 * whether a network was reachable when they were produced.
 *
 * Two failure modes, deliberately treated differently:
 *
 *  - **No network** (dev build on a plane, CI without egress). Warns, keeps
 *    the committed text, exits 0. The build output is still correct, because
 *    the committed copy is the artifact. Refusing to build offline would make
 *    licensing hygiene hostile to everyday work.
 *  - **Fetched text differs from the committed text.** Rewrites the file and
 *    says so loudly. Under `--strict` this is an ERROR instead: the release
 *    gate must never silently change the terms it is about to publish, so a
 *    drift found at release time has to be reviewed and committed by a human
 *    first. `prepublishOnly` runs the strict form.
 *
 * `--strict` also fails on a network error: at release time, "we could not
 * check" and "we checked and it matched" must never look the same.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_ENTRIES, CARM_LICENSE_VERSION } from './licenses.manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');

/*
 * Text authored here rather than fetched. Deliberately EMPTY: every licence
 * Oyon carries now comes from a canonical source, either over the network or
 * from a reviewed vendored file.
 *
 * It previously held an MIT notice for the vendored `dynajs`, complete with a
 * copyright line, because neither dynajs nor its upstreams published a licence
 * file. Hand-authoring a legal attribution on the owner's behalf was the wrong
 * shape for this: dynajs is now Carm-licensed like the rest of the ecosystem
 * and is covered by `LICENSE` directly, so there is nothing to author.
 *
 * Keep it that way. If a component needs licence text that no upstream
 * publishes, fix the upstream — do not invent the notice here.
 */
const AUTHORED = {};

/** Normalise line endings only — licence text is otherwise byte-exact. */
function normalise(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s*$/, '\n');
}

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return normalise(await response.text());
}

/** Resolve one entry's canonical text: fetched, vendored, or authored. */
async function resolveText(entry) {
  if (entry.url) return { text: await fetchText(entry.url), origin: entry.url };
  if (entry.localSource) {
    const from = resolve(ROOT, entry.localSource);
    if (!existsSync(from)) {
      throw new Error(`${entry.id}: local source missing — ${entry.localSource}`);
    }
    return { text: normalise(readFileSync(from, 'utf8')), origin: entry.localSource };
  }
  const authored = AUTHORED[entry.id];
  if (!authored) throw new Error(`${entry.id}: no url, no localSource, no authored text`);
  return { text: normalise(authored), origin: 'authored in scripts/sync-licenses.mjs' };
}

let changed = 0;
let unchanged = 0;
const problems = [];

console.log(`Syncing licences (Carm Research License v${CARM_LICENSE_VERSION})`);

for (const entry of ALL_ENTRIES) {
  const target = resolve(ROOT, entry.path);
  let resolved;
  try {
    resolved = await resolveText(entry);
  } catch (error) {
    // A missing committed copy is fatal in every mode: we would be shipping
    // a package whose licence text simply is not there.
    if (!existsSync(target)) {
      problems.push(`${entry.id}: ${error.message} AND no committed copy at ${entry.path}`);
      continue;
    }
    problems.push(`${entry.id}: ${error.message} (kept committed copy)`);
    continue;
  }

  const existing = existsSync(target) ? normalise(readFileSync(target, 'utf8')) : null;
  if (existing === resolved.text) {
    unchanged += 1;
    continue;
  }

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, resolved.text);
  changed += 1;
  console.log(
    `  ${existing === null ? 'ADDED  ' : 'UPDATED'} ${entry.path}  <- ${resolved.origin}`,
  );
}

console.log(`  ${unchanged} unchanged, ${changed} written`);

if (problems.length > 0) {
  console.warn('\nLicence sync could not verify every entry:');
  for (const problem of problems) console.warn(`  - ${problem}`);
  if (strict) {
    console.error('\n--strict: refusing to proceed with unverified licence text.');
    process.exit(1);
  }
  console.warn('  Committed copies were kept. Re-run with a network to refresh.\n');
}

if (strict && changed > 0) {
  console.error(
    '\n--strict: licence text changed during a release build.\n' +
    'Review the diff and commit it deliberately — a release must not silently\n' +
    'alter the terms it publishes.',
  );
  process.exit(1);
}
