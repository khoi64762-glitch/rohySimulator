-- 0047: flag the default course for tenants whose default was RENAMED before 0044.
--
-- 0044 introduced `cohorts.is_default` and back-filled it by name: the
-- lowest-id live cohort called 'Basic course' per tenant. That misses every
-- tenant whose admin had already renamed the default course before the
-- upgrade (PATCH /cohorts/:id allows it — that is the very bug 0044 fixed).
-- Such a tenant comes out of 0044 with NO flagged default, so the boot
-- seeder (server/seedStemiCourse.js ensureBasicCourses, keyed on is_default)
-- creates a fresh 'Basic course' next to the renamed one — the duplicate
-- 0044 set out to prevent, now on the upgrade path itself.
--
-- The renamed course is still recognisable: 0033 stamped `auto_enroll = 1`
-- on the seeded default and a rename does not clear it. So: for every tenant
-- with no live `is_default = 1` cohort, flag the lowest-id live cohort with
-- `auto_enroll = 1`. Tenants that already have a live default are untouched.
--
-- Strictly additive: one UPDATE that only writes rows in tenants where the
-- flag is currently unset everywhere (a no-op on any tenant that already
-- passed 0044 with a default). The 0044 partial unique index guarantees the
-- MIN(id) pick can never produce a second live default.

BEGIN;

UPDATE cohorts
   SET is_default = 1
 WHERE id IN (SELECT MIN(c.id)
                FROM cohorts c
               WHERE c.auto_enroll = 1
                 AND c.deleted_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM cohorts d
                                  WHERE d.tenant_id = c.tenant_id
                                    AND d.is_default = 1
                                    AND d.deleted_at IS NULL)
               GROUP BY c.tenant_id);

COMMIT;
