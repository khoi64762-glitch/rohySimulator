#!/usr/bin/env node
/**
 * Report whether the canonical Carm License has moved past the version rohy
 * pins in `scripts/licenses.manifest.mjs`.
 *
 * The pin exists so a routine build cannot silently relicense the product
 * (see the manifest header). The cost of a pin is that it can rot quietly —
 * this script is the counterweight. It NEVER edits anything and never fails
 * the build; bumping is a deliberate decision, and this only makes sure the
 * decision is visible when it is due.
 *
 *   npm run license:latest
 */

import { CARM_LICENSE_VERSION } from './licenses.manifest.mjs';

const README = 'https://raw.githubusercontent.com/mohsaqr/carm-license/main/README.md';

let readme;
try {
    const response = await fetch(README, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    readme = await response.text();
} catch (error) {
    console.warn(`Could not reach the canonical licence repo: ${error.message}`);
    console.warn(`rohy pins v${CARM_LICENSE_VERSION}; currency not checked.`);
    process.exit(0);
}

// The README's version table marks exactly one row "Current".
const current = /\[v([0-9]+\.[0-9]+)\][^|]*\|\s*Current/i.exec(readme)?.[1] ?? null;

if (current === null) {
    console.warn('Could not parse a "Current" version from the canonical README.');
    console.warn(`rohy pins v${CARM_LICENSE_VERSION}.`);
    process.exit(0);
}

if (current === CARM_LICENSE_VERSION) {
    console.log(`Carm Research License v${CARM_LICENSE_VERSION} is current.`);
    process.exit(0);
}

console.log(
    `Carm Research License v${current} is now current; rohy pins v${CARM_LICENSE_VERSION}.\n`
    + '\nTo adopt it:\n'
    + '  1. set CARM_LICENSE_VERSION in scripts/licenses.manifest.mjs\n'
    + '  2. npm run license:sync            (rewrites LICENSE from the new tag)\n'
    + '  3. update the version string in README.md and NOTICE.md — the contract\n'
    + '     test lists every file that names it\n'
    + '  4. review the LICENSE diff before committing — the terms are changing\n'
    + '\nEarlier copies remain governed by the version in force when they were\n'
    + 'obtained, so this is not urgent, but it should be a decision rather than\n'
    + 'an oversight.',
);
