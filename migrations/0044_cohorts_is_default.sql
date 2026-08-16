-- 0044: the default course is a FLAG, not a name.
--
-- Until now the tenant default course ("Basic course", 0031) was identified by
-- its literal English name: the boot seeder's NOT EXISTS guard, the
-- default-case / language-case links and the tests all matched
-- `name = 'Basic course'`. That made the name a functional identifier with two
-- consequences: (1) it could not be localised or renamed — PATCH /cohorts/:id
-- allows a rename, after which the next boot saw "no Basic course" and created
-- a SECOND one, so a renamed default quietly duplicated itself; (2) the Cases
-- browser rendered the raw seeded English string in every UI language.
--
-- `cohorts.is_default = 1` now marks the one default course per tenant. The
-- seeders and lookups read the flag; the name is display-only, so an admin
-- may rename it and the client may translate the untouched seeded literal.
--
-- Strictly additive: one defaulted ADD COLUMN (existing rows read 0, and
-- pre-migration code never selects it), a data step flagging the existing
-- default course — the LOWEST-id live 'Basic course' per tenant, in case a
-- tenant somehow holds two — and a partial unique index guaranteeing at most
-- one LIVE default per tenant. The index is scoped to `deleted_at IS NULL` so
-- a soft-deleted default (DELETE /cohorts/:id is allowed) keeps its history
-- while the boot seeder recreates a live one.

BEGIN;

ALTER TABLE cohorts ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

UPDATE cohorts
   SET is_default = 1
 WHERE id IN (SELECT MIN(c.id)
                FROM cohorts c
               WHERE c.name = 'Basic course'
                 AND c.deleted_at IS NULL
               GROUP BY c.tenant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cohorts_default_live
    ON cohorts(tenant_id)
    WHERE is_default = 1 AND deleted_at IS NULL;

COMMIT;
