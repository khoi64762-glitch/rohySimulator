-- Oyon 3: storage for the new signal modalities.
--
-- Oyon 3's window batch contract (`oyon-window-batch-v4`) adds a `modality`
-- discriminator and admits episode-shaped windows. Enabling any new modality
-- produces THREE event shapes, and pre-0039 Rohy mishandles all three:
--
--   1. Blocks riding on the emotion window. Every `*_window_share` setting
--      defaults TRUE, so `facial` / `posture` / `heart_rate` / `respiration` /
--      `illumination` normally arrive as extra keys on the ordinary emotion
--      window. `insertEmotionRecord` has no columns for them, so they are
--      SILENTLY DROPPED — the exact defect 0028 records about v1 dropping
--      `gaze` and `engagement`, repeated for the v3 signals. This is the
--      dominant path, hence the ADD COLUMNs at the bottom of this migration.
--   2. Standalone modality-only windows. With `*_window_share = false` (and on
--      stop/flush), `EmotionRuntime` emits `{facial_only|posture_only|
--      heart_rate_only: true, <modality>: {…}}` events carrying NO emotion
--      data. Their `valid_frames` lives INSIDE the modality block, so the
--      top-level bind is undefined → NULL into `oyon_emotion_records.
--      valid_frames NOT NULL` → the insert throws and the WHOLE batch 500s,
--      losing the emotion windows travelling with it.
--   3. Episode windows (typing, voice, interaction, discourse, ai_assist) that
--      do not share the camera's fixed cadence, so they cannot use the
--      `(tenant_id, session_id, window_start, window_end)` identity at all.
--
-- Shapes 2 and 3 get the new table below; shape 1 gets new nullable columns on
-- `oyon_emotion_records`, keeping a window's own data on its own row.
--
-- Shapes 2 and 3 go to a SEPARATE TABLE rather than gaining a `modality` column
-- on `oyon_emotion_records`. A discriminator column there would mean auditing
-- every existing query for a `WHERE modality = 'emotion'` clause — dozens of
-- chances to miss one, each a silent-corruption bug. With a separate table the
-- isolation is structural: legacy SQL cannot address these rows at all.
--
-- The only change to `oyon_emotion_records` is the six nullable ADD COLUMNs for
-- shape 1 at the bottom. Nullable additions cannot change the meaning of an
-- existing query; no existing column, index or constraint is altered.
--
-- No CHECK constraint on `modality` or `capture_mode`: SQLite cannot ALTER a
-- CHECK, so encoding an enum that upstream may extend would make the next
-- modality a table rebuild (see 0038's note on `users.status`). Both are
-- validated in app code against Oyon's own exported `OYON_MODALITIES` /
-- `OYON_WINDOW_KINDS`, which stay in lockstep with the vendored version.
--
-- Aggregates only. `payload_json` carries the modality block verbatim as Oyon
-- emitted it; the batch validator already rejects raw frames, images, video,
-- pixels and landmarks (`FORBIDDEN_RAW_MEDIA_FIELDS`), and that policy is
-- unchanged here — same contract as 0028's gaze/engagement blocks.

CREATE TABLE IF NOT EXISTS oyon_signal_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  student_id TEXT,
  session_id TEXT NOT NULL,
  case_id TEXT,
  record_id TEXT,
  course_id TEXT,
  cohort_id TEXT,

  -- Denormalised labels, mirroring oyon_emotion_records so the new dashboards
  -- can name a row without joining back to mutable tables.
  student_name_snapshot TEXT,
  student_role_snapshot TEXT,
  case_title_snapshot TEXT,
  case_category_snapshot TEXT,
  course_title_snapshot TEXT,
  cohort_title_snapshot TEXT,
  session_type TEXT,
  attempt_number INTEGER,
  started_from_page TEXT,
  room TEXT,

  -- The v4 discriminators. `modality` is any OYON_MODALITIES value except
  -- 'emotion' (those keep going to oyon_emotion_records); `window_kind` is
  -- 'interval' for camera cadence or 'episode' for host-bounded spans.
  modality TEXT NOT NULL,
  window_kind TEXT NOT NULL DEFAULT 'interval',

  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  duration_ms INTEGER,

  -- The modality block, verbatim. Shape is owned by Oyon's aggregator for that
  -- modality and varies per modality by design, so it stays JSON rather than
  -- being projected into per-modality columns.
  payload_json TEXT,
  dynamics_json TEXT,

  model_profile TEXT,
  settings_hash TEXT,
  settings_snapshot_json TEXT,

  capture_mode TEXT NOT NULL DEFAULT 'local-browser',
  capture_status TEXT NOT NULL DEFAULT 'captured',

  -- Same per-role visibility stamping as oyon_emotion_records, resolved at
  -- write time from the tenant's oyon_settings.
  student_consent_enabled INTEGER NOT NULL DEFAULT 0,
  student_can_view INTEGER NOT NULL DEFAULT 0,
  admin_can_view INTEGER NOT NULL DEFAULT 1,
  educator_can_view INTEGER NOT NULL DEFAULT 0,
  consent_version TEXT NOT NULL,
  consent_recorded_at DATETIME,

  -- Provenance: every v3 window detail carries these, and pinning them per row
  -- lets a later analysis tell which engine produced a signal.
  oyon_version TEXT,
  contract_version TEXT,
  schema_version TEXT,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent ingest. Dedup key includes `modality` because a facial_only window
-- and its sibling emotion window share the same (session, start, end) bounds —
-- without modality in the key, retrying a mixed batch would drop real rows.
-- Rows without a record_id fall outside the partial index and behave as plain
-- INSERTs, matching oyon_emotion_records' behaviour.
CREATE UNIQUE INDEX IF NOT EXISTS idx_oyon_signal_windows_dedup
  ON oyon_signal_windows(tenant_id, session_id, modality, record_id)
  WHERE record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_oyon_signal_windows_tenant_session_time
  ON oyon_signal_windows(tenant_id, session_id, window_start);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_windows_tenant_user_time
  ON oyon_signal_windows(tenant_id, user_id, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_windows_tenant_modality_time
  ON oyon_signal_windows(tenant_id, modality, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_oyon_signal_windows_tenant_case_time
  ON oyon_signal_windows(tenant_id, case_id, window_start DESC);

-- Shape 1 (above): the window-shared blocks. Exactly the remedy 0028 applied to
-- `gaze` / `engagement`, extended to the v3 signals. Nullable ADD COLUMNs, so
-- pre-migration rows read NULL and no existing query changes meaning — the only
-- visible effect is extra keys on `SELECT r.*`, which EmotionWindow's open index
-- signature already tolerates (see src/components/oyon/serverWindows.js).
--
-- Aggregates only, same policy as 0028: head pose / action-unit means, posture
-- ratios, rPPG BPM estimates, breathing rate, ambient luma. No pixels, frames or
-- landmarks — the batch validator rejects those outright.
ALTER TABLE oyon_emotion_records ADD COLUMN facial_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN posture_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN heart_rate_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN respiration_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN illumination_json TEXT;
ALTER TABLE oyon_emotion_records ADD COLUMN capture_quality_json TEXT;
