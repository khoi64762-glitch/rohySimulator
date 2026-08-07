-- 0042: agent arrival is instant by default.
--
-- Background. `case_agents.response_time_min/max` (MINUTES) were never
-- honoured as written. The page handler computed:
--
--   minSec = Math.max(60, Math.min(180, configuredMinSec || 60))
--   maxSec = Math.max(minSec, Math.min(180, configuredMaxSec || 180))
--
-- so every configured value collapsed into a random 60–180 second band:
-- 0 is falsy, so `|| 60` rewrote "instant" to one minute, and Math.max
-- floored it there again regardless. An author who set 0/0 — the
-- setting that asks for NO wait — got the WIDEST wait in the system.
--
-- Because no stored value ever produced the behaviour it described,
-- these columns hold no meaningful author intent. They are seed
-- artifacts. Resetting them to 0 is therefore not discarding
-- configuration; it is discarding numbers that never did anything
-- except pick a band the author did not choose.
--
-- Two halves, both needed so a fresh install and an upgraded one behave
-- identically (the fresh-install side is server/db.js DEFAULT_AGENTS):
--
--   1. Zero every case_agents wait window.
--   2. Rewrite the seeded consultant template's config.response_time
--      from {min:2,max:5} to {min:0,max:0}, so cases created AFTER this
--      migration don't re-provision the old delay. `POST /cases/:id/
--      agents/defaults` copies config.response_time into new rows, so
--      leaving the template alone would let the 2–5 minute wait crawl
--      back one new case at a time.
--
-- Additive in the schema sense: no column is added, dropped or
-- retyped, and every write is idempotent. It IS a behaviour change —
-- paging an agent now returns them immediately instead of after 1–3
-- minutes. That is the point; see docs/design/agent-behaviour-model.md
-- for how to opt a case back into a deliberate delay (set the minutes
-- on the case's agent — the value is now honoured literally).
--
-- Not touched: `availability_type`. An 'on-call' consultant still has
-- to be paged; only the wait after paging goes away. Deciding to ask
-- for help stays a decision the learner makes.

UPDATE case_agents
   SET response_time_min = 0,
       response_time_max = 0
 WHERE COALESCE(response_time_min, 0) <> 0
    OR COALESCE(response_time_max, 0) <> 0;

-- json_set() rather than a blanket overwrite: an admin may have edited
-- the prompt, voice, dos/donts or availability on this template, and
-- only the wait window is being corrected. Guarded on the exact 2/5
-- pair so a deliberate non-default value an admin typed themselves is
-- left alone — they may have meant it, and after this release the
-- number finally does what it says.
UPDATE agent_templates
   SET config = json_set(config, '$.response_time.min', 0, '$.response_time.max', 0)
 WHERE is_default = 1
   AND config IS NOT NULL
   AND json_valid(config)
   AND json_extract(config, '$.response_time.min') = 2
   AND json_extract(config, '$.response_time.max') = 5;
