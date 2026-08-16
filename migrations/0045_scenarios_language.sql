-- 0045: a scenario carries the language it is written in.
--
-- Scenario names, descriptions and timeline step labels ("Worsening
-- ischemia", "Peggioramento dell'ischemia") are prose the student sees on the
-- monitor timeline, and the repository is now authored in six UI languages.
-- Until now nothing recorded WHICH language a scenario was written in, so the
-- list showed an Italian pilot's scenarios next to English ones with no way
-- to tell them apart, filter, or pick the one that matches the case's own
-- dialogue language (`config.case_language`).
--
-- `scenarios.language` holds a registry code from server/shared/languages.js
-- (the same registry cases use). POST/PUT /scenarios validate it and reject
-- unknown codes with 400 `invalid_language`; GET /scenarios accepts
-- `?language=xx`. Every scenario written before this migration — the seeded
-- built-ins and every hand-authored row — was English-labelled or of unknown
-- language, so the backfill is the default 'en' and an author corrects the
-- rare non-English row from the editor's new language select.
--
-- Strictly additive: one defaulted ADD COLUMN (existing rows read 'en',
-- pre-migration code never selects it) and one index for the list filter.

BEGIN;

ALTER TABLE scenarios ADD COLUMN language TEXT NOT NULL DEFAULT 'en';

CREATE INDEX IF NOT EXISTS idx_scenarios_tenant_language
    ON scenarios(tenant_id, language);

COMMIT;
