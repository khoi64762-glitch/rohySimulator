-- Oyon 3: tenant control over the signal modalities.
--
-- These signals are ALREADY CAPTURING. The <oyon-app> element's own
-- DEFAULT_SETTINGS (standalone/app/src/lib/settingsStore.ts) enables
-- gaze/eye/facial/posture/respiration/heart-rate — the OPPOSITE of the library's
-- OYON_DEFAULT_SETTINGS, which has them all off. The library defaults serve
-- embedders who compose their own runtime; Rohy mounts the element, so the
-- element's defaults are what actually run. `elementSettings()` forwarded only
-- seven numeric/model keys, so Rohy had NO WAY TO TURN ANY OF THEM OFF.
--
-- That is the real gap this migration closes: not switching signals on, but
-- giving an administrator authority over signals that are already running. The
-- defaults below therefore preserve current observed behaviour rather than
-- changing it — with one deliberate exception.
--
-- posture_tracking_enabled defaults to 0, unlike the element. The MediaPipe
-- PoseLandmarker model is not vendored in ANY Oyon asset path (not
-- OyonR/scripts/download-models.sh, not `npx oyon download-models`, not
-- host-check.js, not scripts/verify-oyon-install.mjs), and the element's
-- resolveAssetPaths() has no pose entry — it redirects the tasks wasm, the face
-- landmarker, the webgazer mesh, the ONNX runtime and the emotion weights to
-- `asset-base`, but not the pose model. So with posture on, the library falls
-- back to poseLandmarkerUrlForModel() and fetches
-- storage.googleapis.com/mediapipe-models/.../pose_landmarker_lite.task —
-- violating Rohy's contract that "air-gapped deploys never touch a CDN"
-- (src/components/oyon/OyonCaptureWidget.jsx). Vendoring the model does not fix
-- it: nothing in the element can be pointed at a vendored copy without patching
-- runtime.ts and rebuilding the prebuilt dist-element bundle. Off is the honest
-- default until upstream adds pose to resolveAssetPaths; an admin who
-- deliberately accepts the CDN fetch can still enable it.
--
-- Nullable-free but all-defaulted ADD COLUMNs: existing rows get the defaults,
-- pre-migration code never selects these columns, and no existing column,
-- index or constraint changes.

-- Camera-derived signals that need no model beyond what is already vendored.
-- Defaults match the element, i.e. current behaviour.
ALTER TABLE oyon_settings ADD COLUMN facial_signals_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN heart_rate_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN respiration_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN illumination_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN eye_tracking_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oyon_settings ADD COLUMN gaze_tracking_enabled INTEGER NOT NULL DEFAULT 1;

-- Cross-window dynamical features over whatever blocks a window carries.
ALTER TABLE oyon_settings ADD COLUMN enable_dynamics INTEGER NOT NULL DEFAULT 1;

-- Off by default — see the CDN/air-gap note above.
ALTER TABLE oyon_settings ADD COLUMN posture_tracking_enabled INTEGER NOT NULL DEFAULT 0;

-- Whether a modality's aggregates ride on the emotion window (1) or arrive as
-- standalone modality-only windows (0). Migration 0039 stores both shapes, so
-- this is a data-shape preference, not a capability gate. Defaults follow the
-- element's `*_window_share: true`, which keeps a window's signals on one row.
ALTER TABLE oyon_settings ADD COLUMN signal_window_share INTEGER NOT NULL DEFAULT 1;
