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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

// ---------------------------------------------------------------------------
// Regression lock: a default course RENAMED before the 0044 upgrade came out of
// 0044 with is_default = 0 (0044 flagged by name), so the boot seeder created a
// duplicate 'Basic course' beside it. 0047 flags the lowest-id live
// auto_enroll = 1 cohort in every tenant that has no live default.
//
// Simulates a v2.9.12-shaped database: migrations up to 0043 (a temp copy of
// the migrations folder without 0044+), the seeded 'Basic course' with
// auto_enroll = 1 (0031 + 0033), renamed by an admin — THEN 0044..0047 apply
// (the real files, so checksums match) and the boot seeder runs against it via
// a fresh import of the singleton modules.
describe('renamed-before-upgrade default course (0047 backfill)', () => {
    const RENAMED_BEFORE_UPGRADE = 'Cardiology 101';
    let stagedDb;
    let stagedAdapter;
    let stagedEnsureBasicCourses;
    let stagedSeedStemiCourse;
    let stagedSeedLanguageCases;

    beforeAll(async () => {
        const [{ default: fs }, { default: os }, { default: path }, { default: sqlite3 }, { runMigrations }] = await Promise.all([
            import('node:fs'), import('node:os'), import('node:path'), import('sqlite3'),
            import('../../server/migrationRunner.js')
        ]);
        const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
        const fullDir = path.join(repo, 'migrations');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rohy-0047-'));
        const partialDir = path.join(dir, 'migrations-upto-0043');
        fs.mkdirSync(partialDir);
        for (const f of fs.readdirSync(fullDir)) {
            if (/^\d+_.+\.sql$/.test(f) && f.split('_', 1)[0] <= '0043') fs.copyFileSync(path.join(fullDir, f), path.join(partialDir, f));
        }
        const dbPath = path.join(dir, 'db.sqlite');
        const raw = new (sqlite3.verbose().Database)(dbPath);
        const run = (sql, params = []) => new Promise((res, rej) => raw.run(sql, params, function done(err) { err ? rej(err) : res(this); }));
        const all = (sql, params = []) => new Promise((res, rej) => raw.all(sql, params, (err, rows) => err ? rej(err) : res(rows || [])));

        await runMigrations(raw, { migrationsDir: partialDir });
        expect((await all(`PRAGMA table_info(cohorts)`)).some((c) => c.name === 'is_default')).toBe(false);

        // v2.9.12 shape: an admin, the seeded default course (auto_enroll = 1)
        // and a teacher-made cohort — then the admin renames the default.
        const { lastID: adminId } = await run(
            `INSERT INTO users (username, name, email, password_hash, role, tenant_id, status)
             VALUES ('upgrade-admin', 'upgrade-admin', 'upgrade-admin@example.com', 'x', 'admin', 1, 'active')`
        );
        const { lastID: basicId } = await run(
            `INSERT INTO cohorts (name, owner_user_id, tenant_id, description, auto_enroll)
             VALUES ('Basic course', ?, 1, 'Default class — every user is enrolled and receives the default case.', 1)`,
            [adminId]
        );
        await run(`INSERT INTO cohorts (name, owner_user_id, tenant_id, auto_enroll) VALUES ('Semester 2 group', ?, 1, 0)`, [adminId]);
        await run(`UPDATE cohorts SET name = ? WHERE id = ?`, [RENAMED_BEFORE_UPGRADE, basicId]);

        // The upgrade: 0044 (by name — misses the renamed course) … 0047.
        await runMigrations(raw, { migrationsDir: fullDir });
        await new Promise((res) => raw.close(() => res()));

        // Boot the seeder against the upgraded DB through fresh singleton
        // modules (db.js binds ROHY_DB at import time).
        vi.resetModules();
        process.env.ROHY_DB = dbPath;
        ({ default: stagedAdapter } = await import('../../server/dbAdapter.js'));
        const { dbReady } = await import('../../server/db.js');
        await dbReady;
        ({ ensureBasicCourses: stagedEnsureBasicCourses, seedStemiCourse: stagedSeedStemiCourse } = await import('../../server/seedStemiCourse.js'));
        ({ seedLanguageCases: stagedSeedLanguageCases } = await import('../../server/seedLanguageCases.js'));
        stagedDb = { dir, dbPath, cleanup: () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } } };
    }, 60_000);

    afterAll(() => stagedDb?.cleanup());

    it('0047 flags the renamed course as the default; the boot seeder creates no second Basic course', async () => {
        const before = await stagedAdapter.all(
            `SELECT id, name, is_default, auto_enroll FROM cohorts WHERE tenant_id = 1 AND deleted_at IS NULL ORDER BY id ASC`
        );
        expect(before.map((c) => [c.name, c.is_default])).toEqual([[RENAMED_BEFORE_UPGRADE, 1], ['Semester 2 group', 0]]);

        await stagedEnsureBasicCourses();
        await stagedSeedStemiCourse();
        await stagedSeedLanguageCases();
        await stagedEnsureBasicCourses();

        const defaults = await stagedAdapter.all(
            `SELECT id, name FROM cohorts WHERE tenant_id = 1 AND is_default = 1 AND deleted_at IS NULL`
        );
        expect(defaults).toHaveLength(1);
        expect(defaults[0].id).toBe(before[0].id);
        expect(defaults[0].name).toBe(RENAMED_BEFORE_UPGRADE);
        const live = await stagedAdapter.all(`SELECT name FROM cohorts WHERE tenant_id = 1 AND deleted_at IS NULL`);
        expect(live.some((c) => c.name === 'Basic course')).toBe(false);
        expect(live.filter((c) => c.name === RENAMED_BEFORE_UPGRADE)).toHaveLength(1);
    });

    it('0047 is recorded and does not touch a tenant that already has a live default', async () => {
        const rows = await stagedAdapter.all(`SELECT version FROM schema_migrations WHERE version IN ('0044', '0047') ORDER BY version`);
        expect(rows.map((r) => r.version)).toEqual(['0044', '0047']);
        // The teacher-made cohort (auto_enroll = 0) was never a candidate.
        const other = await stagedAdapter.get(`SELECT is_default FROM cohorts WHERE name = 'Semester 2 group'`);
        expect(other.is_default).toBe(0);
    });
});
