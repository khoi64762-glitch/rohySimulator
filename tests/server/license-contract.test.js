import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ALL_ENTRIES,
    CARM_LICENSE,
    CARM_LICENSE_VERSION,
    DATA_SOURCES,
    FIRST_PARTY_VENDORED,
    THIRD_PARTY,
} from '../../scripts/licenses.manifest.mjs';

/*
 * The licensing contract. Deliberately OFFLINE — every assertion reads
 * committed files, so it runs in the ordinary test chain and on a machine with
 * no network. Verifying that the embedded text still matches upstream needs a
 * network and lives in `npm run license:verify`.
 *
 * What this file protects, and how each one fails silently otherwise:
 *
 *   1. Every manifest entry has a NON-EMPTY committed file. The Carm License
 *      requires redistributed copies to "include the licence text itself, not
 *      only a link" — an empty or missing file means rohy ships in breach
 *      while every build stays green.
 *   2. Every entry is LINKED from NOTICE.md. A license embedded but never
 *      referenced is undiscoverable, which defeats the point of embedding it.
 *   3. Oyon's in-place notices really exist. NOTICE.md links OyonR's own
 *      license set rather than duplicating it; if OyonR is ever unvendored or
 *      pruned, those links rot into nothing and rohy silently loses the GPL
 *      text that WebGazer's notice requires.
 *   4. The version string agrees everywhere. It is hardcoded in prose in
 *      several files; a bump that misses one leaves rohy claiming two
 *      different licenses at once.
 *   5. The Docker image actually carries the license. A repo-root file must
 *      survive `.dockerignore` AND be explicitly COPYed in the runtime stage —
 *      directory-level COPYs miss it. This exact trap has already shipped
 *      broken images for Lab_database.json, heart.txt and CHANGELOG.md.
 *   6. A non-commercial data source stays disclosed. CALIPER is CC BY-NC-SA
 *      under a license that sells commercial use; that conflict must be stated
 *      in the notice, not just recorded in a database row.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');
const exists = (relative) => existsSync(path.join(repoRoot, relative));

const notice = read('NOTICE.md');
const manifest = JSON.parse(read('package.json'));

describe('license contract', () => {
    describe('every manifest entry has real embedded text', () => {
        it.each(ALL_ENTRIES.map((entry) => [entry.id, entry]))('%s', (_id, entry) => {
            expect(exists(entry.path), `missing embedded license at ${entry.path}`).toBe(true);
            const text = read(entry.path).trim();
            expect(
                text.length,
                `${entry.path} is ${text.length} chars — too short to be a license`,
            ).toBeGreaterThan(200);
        });
    });

    describe('NOTICE.md carries both the embedded text and a live link', () => {
        // The embedded copy is what this artifact is licensed under, frozen at
        // build time. The link is where that license lives now, so a reader can
        // reach the current version when this copy is a release behind. They
        // answer different questions and neither substitutes for the other.
        it.each(ALL_ENTRIES.map((entry) => [entry.id, entry]))('%s', (_id, entry) => {
            expect(
                notice.includes(entry.path),
                `NOTICE.md must link ${entry.path} — an embedded license nobody can find is not a notice`,
            ).toBe(true);
            expect(
                notice.includes(entry.source),
                `NOTICE.md must link ${entry.id}'s upstream source (${entry.source}) alongside its embedded text`,
            ).toBe(true);
        });

        it('records that texts are embedded, not merely linked', () => {
            // So a future editor cannot "tidy" the full texts back down to links.
            expect(notice).toMatch(/not merely\s+linked|not only a link/i);
        });
    });

    describe('the Carm license pin', () => {
        it('embeds from a version TAG, never a moving branch', () => {
            // A routine build must not be able to silently relicense rohy.
            expect(CARM_LICENSE.url).toContain(`/v${CARM_LICENSE_VERSION}/`);
            expect(CARM_LICENSE.url).not.toContain('/main/');
        });

        it('publishes an always-current pointer alongside the pin', () => {
            expect(CARM_LICENSE.latest).toBeTruthy();
            expect(CARM_LICENSE.latest).toContain('/main/');
            expect(notice).toContain(CARM_LICENSE.latest);
        });

        it('embeds the version the manifest pins', () => {
            expect(read(CARM_LICENSE.path)).toContain(
                `Carm Research License v${CARM_LICENSE_VERSION}`,
            );
        });
    });

    describe('the version string agrees in every file that names it', () => {
        it.each(['README.md', 'NOTICE.md'])('%s', (file) => {
            const mentions = read(file).match(/Carm Research License v(\d+\.\d+)/g) ?? [];
            expect(mentions.length, `${file} must name the license version`).toBeGreaterThan(0);
            for (const mention of mentions) {
                expect(mention).toBe(`Carm Research License v${CARM_LICENSE_VERSION}`);
            }
        });
    });

    describe('first-party Carm ecosystem code', () => {
        it.each(FIRST_PARTY_VENDORED.map((entry) => [entry.id, entry]))(
            '%s is declared and covered by LICENSE',
            (_id, entry) => {
                if (entry.vendoredAt) {
                    expect(
                        exists(entry.vendoredAt),
                        `manifest claims ${entry.id} is vendored at ${entry.vendoredAt}, which does not exist`,
                    ).toBe(true);
                    expect(
                        notice.includes(entry.vendoredAt),
                        `NOTICE.md must name ${entry.vendoredAt} — vendored code with no separate license is invisible unless the notice names it`,
                    ).toBe(true);
                } else {
                    // Not in-tree (dynajs is a sibling file: dependency), so
                    // there is no path to assert — only that it is disclosed.
                    expect(
                        notice.includes(entry.id),
                        `NOTICE.md must name ${entry.id}, which ships without an in-tree path`,
                    ).toBe(true);
                }

                // One component, one category.
                expect(THIRD_PARTY.some((third) => third.id === entry.id)).toBe(false);
                // First-party code is covered by LICENSE; a second copy of
                // identical terms would be a copy to keep in sync.
                expect(exists(`licenses/${entry.id}.LICENSE.txt`)).toBe(false);
            },
        );

        it('explains why first-party code carries no separate license', () => {
            expect(notice).toMatch(/no separate license file/i);
        });
    });

    describe("Oyon's in-place notices", () => {
        // NOTICE.md links these rather than duplicating them. That is only
        // sound while they are actually there.
        const oyon = FIRST_PARTY_VENDORED.find((entry) => entry.id === 'oyon');

        it.each(oyon.carriesOwnNotices)('%s exists and is linked', (noticePath) => {
            expect(exists(noticePath), `${noticePath} is referenced in place but missing`).toBe(true);
            expect(read(noticePath).trim().length).toBeGreaterThan(200);
            expect(
                notice.includes(noticePath),
                `NOTICE.md must link ${noticePath} — it is carried in place, so the link is the only pointer to it`,
            ).toBe(true);
        });

        it('carries the real GPL text, not just the notice that elects it', () => {
            // WebGazer's own LICENSE.md ends "You should have received a copy of
            // the GNU General Public License along with this program." Shipping
            // only that would leave the sentence false.
            const gpl = read('OyonR/licenses/GPL-3.0-or-later.txt');
            expect(gpl).toMatch(/GNU GENERAL PUBLIC LICENSE/);
            expect(gpl).toMatch(/TERMS AND CONDITIONS/);
            expect(gpl.length).toBeGreaterThan(30000);
        });
    });

    describe('Piper', () => {
        it('embeds the full GPL, since one image variant redistributes it', () => {
            const gpl = read('licenses/piper1-gpl.COPYING.txt');
            expect(gpl).toMatch(/GNU GENERAL PUBLIC LICENSE/);
            expect(gpl).toMatch(/TERMS AND CONDITIONS/);
            expect(gpl.length).toBeGreaterThan(30000);
        });

        it('discloses that INCLUDE_PIPER=1 redistributes GPL software', () => {
            expect(notice).toContain('INCLUDE_PIPER=1');
            expect(notice).toMatch(/GPL-3\.0/);
        });

        it('warns that voice dataset licenses vary per voice', () => {
            // The HF repo declares MIT; the corpora behind individual voices do
            // not all follow. A blanket "MIT" here would mislead a commercial
            // deployment into shipping a research-only voice.
            expect(notice).toMatch(/per-voice dataset licenses vary/i);
            expect(notice).toMatch(/MODEL_CARD/);
        });
    });

    describe('license declarations are not passed off as license texts', () => {
        // An upstream that publishes no license FILE gets its own declaration
        // embedded instead. The alternative — authoring an MIT text with a
        // copyright line we invented — is what the sync script forbids.
        const declarations = THIRD_PARTY.filter((entry) => entry.kind === 'declaration');

        it('has at least one, or this guard is dead code', () => {
            expect(declarations.length).toBeGreaterThan(0);
        });

        it('says so in NOTICE.md, so a reader is not surprised by the file', () => {
            expect(notice).toMatch(/publishes no separate license file/i);
        });
    });

    describe('non-commercial data sources stay disclosed', () => {
        const restricted = DATA_SOURCES.filter((source) => !source.commercialOk);

        it('has at least one, or this guard is dead code', () => {
            expect(restricted.length).toBeGreaterThan(0);
        });

        it.each(restricted.map((source) => [source.key, source]))('%s', (_key, source) => {
            expect(
                notice.includes(source.license),
                `NOTICE.md must state ${source.key}'s license (${source.license}) — rohy sells commercial use, this source forbids it`,
            ).toBe(true);
            expect(notice).toMatch(/non-commercial/i);
        });
    });

    describe('package metadata', () => {
        it('points at the embedded license rather than naming a stock one', () => {
            expect(manifest.license).toBe('SEE LICENSE IN LICENSE');
        });
    });

    describe('the Docker image actually carries the license', () => {
        // Two gates: a repo-root file must survive .dockerignore AND be
        // explicitly COPYed in the runtime stage. Directory-level COPYs miss
        // it. This has already shipped broken images three times.
        const dockerfile = read('deploy/docker/Dockerfile');
        const dockerignore = read('.dockerignore');

        it.each(['LICENSE', 'NOTICE.md', 'licenses'])('COPYs %s into the runtime stage', (file) => {
            expect(
                dockerfile.includes(`/workspace/rohy/${file} ./${file}`),
                `deploy/docker/Dockerfile must COPY ${file} into the runtime stage`,
            ).toBe(true);
        });

        it('re-includes NOTICE.md past the blanket *.md exclusion', () => {
            // `*.md` in .dockerignore would strip NOTICE.md from the build
            // context, so LICENSE would ship and its notice would not.
            expect(dockerignore).toContain('!NOTICE.md');
            const blanket = dockerignore.indexOf('*.md');
            const reinclude = dockerignore.indexOf('!NOTICE.md');
            expect(
                reinclude,
                'the !NOTICE.md re-include must come AFTER the *.md exclusion',
            ).toBeGreaterThan(blanket);
        });

        it('does not label the image with a license it no longer uses', () => {
            expect(dockerfile).not.toMatch(/image\.licenses="MIT"/);
            expect(dockerfile).toMatch(/image\.licenses="LicenseRef-Carm-Research-License"/);
        });
    });

    describe('manifest hygiene', () => {
        it('has no duplicate ids or paths', () => {
            const ids = ALL_ENTRIES.map((entry) => entry.id);
            expect(new Set(ids).size).toBe(ids.length);
            const paths = ALL_ENTRIES.map((entry) => entry.path);
            expect(new Set(paths).size).toBe(paths.length);
        });

        it.each(THIRD_PARTY.map((entry) => [entry.id, entry]))(
            '%s declares spdx, source and how it reaches a user',
            (_id, entry) => {
                expect(entry.spdx).toBeTruthy();
                expect(entry.source).toBeTruthy();
                expect(entry.runtime).toBeTruthy();
            },
        );
    });
});
