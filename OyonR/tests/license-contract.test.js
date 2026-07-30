import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  ALL_ENTRIES,
  CARM_LICENSE,
  CARM_LICENSE_VERSION,
  FIRST_PARTY_VENDORED,
  THIRD_PARTY,
} from '../scripts/licenses.manifest.mjs';

/*
 * The licensing contract. Deliberately OFFLINE — every assertion here reads
 * committed files, so it runs in the ordinary test chain and on a machine
 * with no network. Verifying that the embedded text still matches upstream
 * needs a network and lives in `scripts/sync-licenses.mjs --strict`, which
 * runs in `prepublishOnly`.
 *
 * What this file protects, and why each one fails silently otherwise:
 *
 *   1. Every manifest entry has a NON-EMPTY committed file. The Carm License
 *      requires redistributed copies to "include the licence text itself, not
 *      only a link" — an empty or missing file means the package ships in
 *      breach while every build stays green.
 *   2. Every entry is LINKED from NOTICE.md. A license embedded but never
 *      referenced is undiscoverable, which defeats the point of embedding it.
 *   3. A `requires` companion is present. WebGazer's LICENSE.md is the GPL
 *      *notice*, ending "You should have received a copy of the GNU General
 *      Public License along with this program" — ship it without the full
 *      text and that sentence is false.
 *   4. The version string agrees everywhere. It is hardcoded in prose in
 *      several files; a bump that misses one leaves the product claiming two
 *      different licenses at once.
 *   5. `licenses/` is in the package `files[]`. Otherwise every text above is
 *      present in the repo and absent from the published tarball — the one
 *      place it legally matters most.
 */

const notice = readFileSync('NOTICE.md', 'utf8');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));

// ---- 1. Every entry has real, non-empty embedded text ----
for (const entry of ALL_ENTRIES) {
  assert.ok(existsSync(entry.path), `${entry.id}: missing embedded license at ${entry.path}`);
  const text = readFileSync(entry.path, 'utf8').trim();
  assert.ok(
    text.length > 200,
    `${entry.id}: ${entry.path} is ${text.length} chars — too short to be a license text`,
  );
}

// ---- 2. NOTICE.md links every embedded license ----
for (const entry of ALL_ENTRIES) {
  assert.ok(
    notice.includes(entry.path),
    `NOTICE.md must link ${entry.path} — an embedded license nobody can find is not a notice`,
  );
}

// NOTICE must state the embed-not-link obligation it exists to satisfy, so a
// future editor cannot "tidy" the full texts back down to links.
assert.match(
  notice,
  /not merely linked|not only a link/i,
  'NOTICE.md must record that license texts are embedded, not just linked',
);

/*
 * ---- Embedded text AND a live link, for every component ----
 *
 * The embedded copy is what this artifact is licensed under, frozen at build
 * time. The link is where that licence lives now, so a reader can reach the
 * current version when this copy is a release behind. They answer different
 * questions and neither substitutes for the other — so NOTICE must carry both.
 */
for (const entry of ALL_ENTRIES) {
  assert.ok(
    notice.includes(entry.source),
    `NOTICE.md must link ${entry.id}'s upstream source (${entry.source}) alongside its ` +
      'embedded text — the embedded copy says what this build uses, the link says where ' +
      'the licence lives now',
  );
}

// The Carm licence is the one place pinned and latest genuinely differ: the
// build embeds a version TAG, so the always-current pointer has to be
// published too or a reader has no way to see they are behind.
assert.ok(CARM_LICENSE.latest, 'the Carm licence must declare an always-current URL');
assert.ok(
  CARM_LICENSE.latest.includes('/main/'),
  'the Carm "latest" pointer must track main, not a pinned tag',
);
assert.ok(
  !CARM_LICENSE.url.includes('/main/'),
  'the Carm EMBEDDED text must come from a version tag, never main',
);
assert.ok(
  notice.includes(CARM_LICENSE.latest),
  'NOTICE.md must publish the always-current Carm licence URL',
);

// ---- 3. Companion texts required by a notice are present ----
for (const entry of THIRD_PARTY) {
  if (!entry.requires) continue;
  const companion = ALL_ENTRIES.find((candidate) => candidate.id === entry.requires);
  assert.ok(companion, `${entry.id} requires '${entry.requires}', which is not in the manifest`);
  assert.ok(
    existsSync(companion.path),
    `${entry.id} requires ${companion.path}, which is missing`,
  );
}

// The GPL is the one license here whose full text is legally load-bearing:
// assert it is the real thing, not another copy of the short notice.
const gpl = readFileSync('licenses/GPL-3.0-or-later.txt', 'utf8');
assert.match(gpl, /GNU GENERAL PUBLIC LICENSE/, 'the GPL file must contain the GPL');
assert.match(gpl, /TERMS AND CONDITIONS/, 'the GPL file must contain the full terms, not the notice');
assert.ok(gpl.length > 30000, `the GPL text is ${gpl.length} chars — the full license is ~34k`);

// ---- 4. The version string agrees everywhere ----
const license = readFileSync(CARM_LICENSE.path, 'utf8');
assert.ok(
  license.includes(`Carm Research License v${CARM_LICENSE_VERSION}`),
  `LICENSE must be Carm Research License v${CARM_LICENSE_VERSION} (the manifest's pin)`,
);
assert.ok(
  CARM_LICENSE.url.includes(`/v${CARM_LICENSE_VERSION}/`),
  'the Carm license must be fetched from its VERSION TAG, not a moving branch — ' +
    'a routine build must not be able to silently relicense the product',
);

const VERSIONED_PROSE = [
  'README.md',
  'NOTICE.md',
  'standalone/app/src/routes/about.tsx',
];
for (const file of VERSIONED_PROSE) {
  const text = readFileSync(file, 'utf8');
  const stale = text.match(/Carm Research License v(\d+\.\d+)/g) ?? [];
  assert.ok(stale.length > 0, `${file} must name the license version`);
  for (const mention of stale) {
    assert.equal(
      mention,
      `Carm Research License v${CARM_LICENSE_VERSION}`,
      `${file} names "${mention}" but the manifest pins v${CARM_LICENSE_VERSION}`,
    );
  }
}

// ---- 5. The published package actually contains the licenses ----
assert.ok(
  manifest.files.includes('licenses'),
  "package.json files[] must include 'licenses' — otherwise every embedded " +
    'license is in the repo and absent from the tarball, which is the one ' +
    'place redistribution obligations actually bite',
);
assert.ok(manifest.files.includes('LICENSE'), "package.json files[] must include 'LICENSE'");
assert.ok(manifest.files.includes('NOTICE.md'), "package.json files[] must include 'NOTICE.md'");

// ---- Manifest hygiene ----
const ids = ALL_ENTRIES.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length, 'manifest has a duplicate entry id');
const paths = ALL_ENTRIES.map((entry) => entry.path);
assert.equal(new Set(paths).size, paths.length, 'two manifest entries write the same path');
for (const entry of THIRD_PARTY) {
  assert.ok(entry.spdx, `${entry.id}: every third-party entry needs an SPDX identifier`);
  assert.ok(entry.source, `${entry.id}: every third-party entry needs an upstream source URL`);
  assert.ok(entry.runtime, `${entry.id}: state HOW this component reaches a user`);
}

/*
 * ---- First-party vendored code ----
 *
 * These carry NO separate license file, because the Carm License at LICENSE
 * already covers the whole Carm ecosystem. That makes them the easiest thing
 * in this file to lose: nothing breaks when a vendored directory goes
 * unmentioned, which is exactly how dynajs stayed absent from NOTICE.md until
 * 2026-07-26. So the listing itself is what gets asserted.
 */
for (const entry of FIRST_PARTY_VENDORED) {
  assert.ok(entry.vendoredAt, `${entry.id}: must record where it is vendored`);
  assert.ok(
    existsSync(entry.vendoredAt),
    `${entry.id}: manifest claims it is vendored at ${entry.vendoredAt}, which does not exist`,
  );
  assert.ok(
    notice.includes(entry.vendoredAt),
    `NOTICE.md must name ${entry.vendoredAt} — vendored code with no separate license is ` +
      'invisible unless the notice names it',
  );
  // It must NOT also be claimed as third-party: one component, one category.
  assert.ok(
    !THIRD_PARTY.some((third) => third.id === entry.id),
    `${entry.id} is listed as both first-party and third-party`,
  );
  assert.ok(
    !existsSync(`licenses/${entry.id}.LICENSE.txt`),
    `licenses/${entry.id}.LICENSE.txt should not exist — first-party code is covered by ` +
      'LICENSE, and a second copy of identical terms is a copy to keep in sync',
  );
}

// NOTICE must say WHY first-party code has no separate license, so a future
// reader does not "fix" the omission by inventing a license file for it.
assert.match(
  notice,
  /covered by \[`LICENSE`\]|applies to\s*\n?\s*"Carm and all associated products/,
  'NOTICE.md must explain that first-party vendored code is covered by LICENSE',
);

console.log(
  `license-contract.test.js — ${ALL_ENTRIES.length} licenses embedded and linked, ` +
    `${FIRST_PARTY_VENDORED.length} first-party vendored component(s) declared`,
);
