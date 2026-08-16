// The tenant default course is identified by `cohorts.is_default = 1`
// (migration 0044), never by its name.
//
// Regression lock: renaming the default course created a duplicate on next boot.
// Until 0044 the boot seeder's guard was `NOT EXISTS (… c.name = 'Basic course')`,
// and PATCH /cohorts/:id allows a rename — so an admin who localised the name
// ("Corso base") got a SECOND "Basic course" the next time the server started,
// and the default-case / language-case links followed the new one. These
// tests run the real migrations on a throwaway sqlite file, point the
// dbAdapter singleton at it, rename the seeded default, run the boot seeders
// again, and assert that exactly one default course exists, that it kept its
// custom name, that seed links + auto-enrolment target the RENAMED course, and
// that the partial unique index rejects a second live default per tenant.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from '../utils/seedDb.js';

const RENAMED = 'Corso base';

let testDb;
let dbAdapter;
let ensureBasicCourses;
let seedStemiCourse;
let seedLanguageCases;
let ensureAutoEnrollMemberships;
let DEFAULT_COURSE_NAME;

beforeAll(async () => {
    // Migrated temp DB with the minimal admin user (tenant 1) the seeder needs
    // as the default course's owner. ROHY_DB must be set BEFORE the singleton
    // modules are imported — db.js reads it at module load.
    testDb = await createTestDb({ seed: true, label: 'default-course' });
    process.env.ROHY_DB = testDb.dbPath;
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'default-course-flag-tests';

    ({ default: dbAdapter } = await import('../../server/dbAdapter.js'));
    const { dbReady } = await import('../../server/db.js');
    await dbReady;
    ({ ensureBasicCourses, seedStemiCourse } = await import('../../server/seedStemiCourse.js'));
    ({ seedLanguageCases } = await import('../../server/seedLanguageCases.js'));
    ({ ensureAutoEnrollMemberships } = await import('../../server/routes/_helpers.js'));
    ({ DEFAULT_COURSE_NAME } = await import('../../server/shared/defaultCourse.js'));
}, 60_000);

afterAll(async () => {
    await testDb?.cleanup();
});

const liveDefaults = () => dbAdapter.all(
    `SELECT id, name, is_default, auto_enroll FROM cohorts
      WHERE tenant_id = 1 AND is_default = 1 AND deleted_at IS NULL ORDER BY id ASC`
);
const liveCohorts = () => dbAdapter.all(
    `SELECT id, name, is_default FROM cohorts WHERE tenant_id = 1 AND deleted_at IS NULL ORDER BY id ASC`
);

describe('default course is a flag, not a name (0044)', () => {
    it('migration adds cohorts.is_default and the partial unique index', async () => {
        const cols = await dbAdapter.all(`PRAGMA table_info(cohorts)`);
        const col = cols.find((c) => c.name === 'is_default');
        expect(col).toBeTruthy();
        expect(col.notnull).toBe(1);
        expect(String(col.dflt_value)).toBe('0');

        const idx = await dbAdapter.get(
            `SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_cohorts_default_live'`
        );
        expect(idx?.sql).toMatch(/UNIQUE/i);
        expect(idx?.sql).toMatch(/is_default = 1 AND deleted_at IS NULL/);
    });

    it('boot seeder creates ONE default course flagged is_default=1 under the seeded English name', async () => {
        await ensureBasicCourses();
        const defaults = await liveDefaults();
        expect(defaults).toHaveLength(1);
        expect(defaults[0].name).toBe(DEFAULT_COURSE_NAME);
        expect(defaults[0].name).toBe('Basic course');
        expect(defaults[0].auto_enroll).toBe(1);

        // Idempotent on a second run — nothing new.
        await ensureBasicCourses();
        expect(await liveDefaults()).toHaveLength(1);
    });

    // Regression lock: renaming the default course created a duplicate on next boot.
    it('renaming the default course does NOT create a second one on the next boot', async () => {
        const [before] = await liveDefaults();
        await dbAdapter.run(`UPDATE cohorts SET name = ? WHERE id = ?`, [RENAMED, before.id]);
        const cohortsBefore = await liveCohorts();

        // The full boot seed path, twice, exactly as two restarts would run it.
        await ensureBasicCourses();
        await seedStemiCourse();
        await seedLanguageCases();
        await ensureBasicCourses();
        await seedStemiCourse();
        await seedLanguageCases();

        const defaults = await liveDefaults();
        expect(defaults).toHaveLength(1);
        expect(defaults[0].id).toBe(before.id);
        expect(defaults[0].name).toBe(RENAMED); // the rename stuck

        const cohortsAfter = await liveCohorts();
        expect(cohortsAfter.map((c) => c.id)).toEqual(cohortsBefore.map((c) => c.id));
        expect(cohortsAfter.some((c) => c.name === 'Basic course')).toBe(false);
    });

    it('seeded language cases are linked into the RENAMED default course', async () => {
        const [def] = await liveDefaults();
        const links = await dbAdapter.all(
            `SELECT ca.case_code FROM cohort_cases cc
               JOIN cases ca ON ca.id = cc.case_id AND ca.deleted_at IS NULL
              WHERE cc.cohort_id = ? AND cc.deleted_at IS NULL`,
            [def.id]
        );
        // seedLanguageCases inserts the de/es/it cases and links them by
        // is_default, not by name — so the renamed course still receives them.
        const prefixes = links.map((l) => String(l.case_code || '').slice(0, 2)).sort();
        expect(prefixes).toEqual(expect.arrayContaining(['DE', 'ES', 'IT']));
    });

    it('auto-enrolment on login/register still targets the renamed default course', async () => {
        const { lastID: userId } = await dbAdapter.run(
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('dc-student', 'dc-student', 'dc-student@example.com', 'x', 'student', 1, 'active')`
        );
        await ensureAutoEnrollMemberships(userId, 1);
        const memberships = await dbAdapter.all(
            `SELECT co.id, co.name, co.is_default FROM cohort_members cm
               JOIN cohorts co ON co.id = cm.cohort_id
              WHERE cm.user_id = ? AND cm.deleted_at IS NULL`,
            [userId]
        );
        expect(memberships).toHaveLength(1);
        expect(memberships[0].name).toBe(RENAMED);
        expect(memberships[0].is_default).toBe(1);
    });

    it('rejects a second live default course in the same tenant (partial unique index)', async () => {
        const [def] = await liveDefaults();
        await expect(
            dbAdapter.run(
                `INSERT INTO cohorts (name, owner_user_id, tenant_id, is_default)
                 SELECT 'Another default', owner_user_id, tenant_id, 1 FROM cohorts WHERE id = ?`,
                [def.id]
            )
        ).rejects.toThrow(/UNIQUE|constraint/i);

        // A soft-deleted default does not block a live one (boot recreates
        // the default after an admin deletes it).
        await dbAdapter.run(`UPDATE cohorts SET deleted_at = datetime('now') WHERE id = ?`, [def.id]);
        await ensureBasicCourses();
        const defaults = await liveDefaults();
        expect(defaults).toHaveLength(1);
        expect(defaults[0].id).not.toBe(def.id);
        expect(defaults[0].name).toBe(DEFAULT_COURSE_NAME);
    });
});
