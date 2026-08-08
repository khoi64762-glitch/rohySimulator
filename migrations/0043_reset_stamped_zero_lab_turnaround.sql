-- 0043: reset stamped-zero lab turnarounds to NULL ("follow the case default").
--
-- Background (bug report 2.9.15 #4). Until this release, an explicit
-- per-test turnaround of 0 ("Immediate" in the authoring editor) was
-- silently discarded by resolveTurnaroundMinutes() — positiveMinutes()
-- rejected 0, so the value fell through to the case default. From this
-- release on, 0 is honoured literally: an explicit per-test 0 means
-- "results are instant".
--
-- That contract change makes existing 0 rows dangerous, because none of
-- them were written by an author whose 0 ever worked:
--
--   1. The order-labs endpoint used to MATERIALIZE config-JSON and
--      default-database labs into case_investigations stamped with the
--      order-time RESOLVED turnaround — including a student's
--      "Order instantly" override of 0. Those rows are shared across
--      every session of the case; honouring their 0 would make the test
--      instant for all future learners because one student once clicked
--      the instant button.
--   2. An author's Immediate saved through the bulk-replace endpoint
--      stored 0, but the resolver ignored it — the case never actually
--      behaved instantly, so no configured case depends on it.
--
-- Since a stamped 0 and an authored 0 are indistinguishable in the data
-- and neither ever produced instant behaviour, the truthful reset is
-- NULL: "no per-test value — follow the case default at order time".
-- An educator who wants Immediate re-picks it in the editor, and from
-- this release the button finally does what it says.
--
-- (Migration 0023 already clamped pre-2026 sub-1-minute values to 1, so
-- every 0 in this table postdates the stamping paths described above.)
--
-- Additive: no schema change, idempotent write, old code reads NULL as
-- "use the default" via COALESCE / the resolver's unset branch.

UPDATE case_investigations
   SET turnaround_minutes = NULL
 WHERE turnaround_minutes = 0;
