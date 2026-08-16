-- 0046: treatment_effects becomes a scoped, editable library.
--
-- Until now the treatment catalogue students order from (`treatment_effects`,
-- 0001) was a platform-wide seed with a single read-only endpoint
-- (GET /treatment-effects). Every case in every tenant saw the same list and
-- nobody but the seeder could change a PK number, add a local protocol drug or
-- retire a row. This migration gives the table the same three-tier ownership
-- model the drug/lab catalogue already uses (server/routes/catalogue.js):
--
--   scope     'platform' (default — every existing seeded row) visible to all
--             tenants and editable by admins only; 'tenant' visible only to
--             users of `tenant_id` and editable by that tenant's educator+.
--   tenant_id owning tenant for 'tenant' rows (1 = the default tenant, so the
--             seeded platform rows carry a truthful value too).
--   created_by / updated_at — authorship, for the audit trail and the UI.
--
-- Strictly additive: four defaulted/nullable ADD COLUMNs plus one index.
-- Existing rows read scope='platform', tenant_id=1, and pre-migration code
-- (the seeder's INSERT … ON CONFLICT (treatment_name, route), the session
-- available-treatments merge, order/administer lookups) never selects the new
-- columns.
--
-- DELIBERATELY KEPT: the original `UNIQUE(treatment_name, route)` from 0001.
-- It is a table-level constraint SQLite cannot ALTER; relaxing it to
-- (tenant_id, treatment_name, route) needs a full table rebuild of a table that
-- `active_treatments.effect_id` references — deferred until a destructive
-- multi-release window. Consequence: two tenants cannot both add "Metoprolol /
-- IV" — the second gets a readable 409 from POST /treatment-effects and must
-- pick a distinct name (e.g. a local protocol suffix). The seeder's ON CONFLICT
-- keeps working unchanged.

BEGIN;

ALTER TABLE treatment_effects ADD COLUMN scope TEXT NOT NULL DEFAULT 'platform';
ALTER TABLE treatment_effects ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE treatment_effects ADD COLUMN created_by INTEGER REFERENCES users(id);
ALTER TABLE treatment_effects ADD COLUMN updated_at DATETIME;

-- The visibility predicate every read uses:
--   scope = 'platform' OR (scope = 'tenant' AND tenant_id = ?)  … AND is_active = 1
CREATE INDEX IF NOT EXISTS idx_treatment_effects_scope
    ON treatment_effects(tenant_id, scope, is_active);

COMMIT;
