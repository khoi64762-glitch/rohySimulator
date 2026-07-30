-- Oyon 3: consent v2 + the host-driven signal modalities.
--
-- Phase 4 adds signal families that are NOT camera-derived affect: typing
-- (keystroke timing on the composer), interaction (page-wide pointer / click /
-- scroll / selection / focus), discourse (per-sentence speech acts over message
-- text) and ai_assist (suggestion request/accept/reject cycles). These are new
-- CATEGORIES of personal data, not more of the same — so they cannot ride on
-- `oyon-consent-v1`, which describes camera-derived affect.
--
-- Hence a consent version bump. Two halves, both required:
--
--   1. This migration moves tenants from 'oyon-consent-v1' to 'oyon-consent-v2'
--      — but ONLY rows still sitting on the v1 default. An administrator who
--      set a custom consent version keeps it (never clobber an admin's value;
--      same rule as setSettingIfEmpty).
--   2. Per-USER acceptance is versioned. Before this, consent was a bare
--      boolean (`user_preferences.onboarding_settings.oyon_consent` plus a
--      localStorage mirror), so nothing recorded WHICH contract a learner
--      agreed to and a version bump would silently re-label their old consent.
--      `oyon_emotion_consents.accepted_version` records what was actually
--      shown and accepted; the server refuses v2-only modalities for a session
--      whose accepted version predates v2.
--
-- The gate is server-side on ingest, not merely a client prompt: a learner who
-- has not accepted v2 produces no typing/interaction/discourse/ai_assist rows
-- even if a stale client sends them. Camera modalities are unaffected — they
-- are covered by v1 and keep working for everyone.

-- What the learner actually accepted, as opposed to what the tenant currently
-- advertises. NULL = a pre-0041 row, treated as v1 (the only contract that
-- existed when it was written).
ALTER TABLE oyon_emotion_consents ADD COLUMN accepted_version TEXT;

-- Advance only tenants still on the untouched v1 default.
UPDATE oyon_settings
   SET consent_version = 'oyon-consent-v2',
       updated_at = CURRENT_TIMESTAMP
 WHERE consent_version = 'oyon-consent-v1';

-- The four host-driven modalities. Enabled at tenant level so they are ready
-- the moment a learner accepts v2 — the consent gate, not these flags, is what
-- keeps them dormant until then. Voice is deliberately absent: it gates
-- microphone HARDWARE and Rohy's VoiceService already owns the mic, so it is
-- its own follow-up rather than a flag flipped here.
ALTER TABLE oyon_settings ADD COLUMN typing_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN interaction_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN discourse_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN ai_assist_enabled INTEGER NOT NULL DEFAULT 1;
