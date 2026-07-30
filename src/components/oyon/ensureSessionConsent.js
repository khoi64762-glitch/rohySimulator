// One consent row per session, shared by every Oyon capture path.
//
// `POST /addons/oyon/consent` is a plain INSERT — it appends an audit row each
// time. That was fine while the camera widget was the only caller and guarded
// itself with a per-session ref. It stops being fine once host-driven signal
// capture (typing, interaction, …) also needs the row, for two reasons:
//
//   1. two independent callers would write two rows per session, turning an
//      audit trail into noise;
//   2. signal capture cannot depend on the CAMERA having started, or typing
//      analytics would silently produce nothing on a tenant that runs signals
//      with `emotion_capture_enabled` off — the server would drop every window
//      as consent_blocked, with no client-side symptom at all.
//
// A module singleton is the right shape here (same reasoning as EventLogger /
// VoiceService): the guarantee is "once per session per document", which is
// wider than any one component's lifetime.

import { apiFetch } from '../../services/apiClient';
import { OYON_CONSENT_VERSION_LS_KEY } from '../../utils/oyonConsent';
import { oyonClientLog } from './clientLogger';

// sessionId → in-flight or settled POST. Callers await the same promise, so a
// widget and a signal capture racing on mount still produce one row.
const inFlight = new Map();

/** What this browser recorded as the contract the learner was actually shown. */
function acceptedVersion() {
    try { return localStorage.getItem(OYON_CONSENT_VERSION_LS_KEY) || undefined; }
    catch { return undefined; }
}

/**
 * Record consent for `sessionId` at most once. Resolves true when the row
 * exists (now or from an earlier call), false when the POST failed — callers
 * use that to decide whether to persist, so a failure must not read as
 * success.
 *
 * A failed attempt is forgotten, so the next caller retries rather than
 * inheriting a cached rejection.
 */
export function ensureSessionConsent(sessionId, { sourcePage } = {}) {
    if (!sessionId) return Promise.resolve(false);
    const key = String(sessionId);
    if (inFlight.has(key)) return inFlight.get(key);

    const attempt = apiFetch('/addons/oyon/consent', {
        method: 'POST',
        json: {
            session_id: key,
            consent_granted: true,
            source_page: sourcePage ?? (typeof window !== 'undefined' ? window.location.pathname : null),
            // The contract this learner accepted. A client that names nothing
            // is read server-side as v1, so this can never over-grant.
            accepted_version: acceptedVersion(),
        },
    })
        .then(() => {
            oyonClientLog('info', 'consent recorded', { session_id: key });
            return true;
        })
        .catch(e => {
            inFlight.delete(key); // let the next caller retry
            oyonClientLog('warn', 'consent POST failed; capture will not persist', {
                session_id: key, error: e?.message || String(e),
            });
            return false;
        });

    inFlight.set(key, attempt);
    return attempt;
}

/** Test seam — drops the per-session memo. */
export function resetSessionConsentCache() {
    inFlight.clear();
}
