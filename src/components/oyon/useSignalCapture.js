// Lazy host for Oyon's host-driven signal capture (typing, interaction,
// discourse, ai_assist).
//
// `createSignalCapture` is the SIBLING of the camera runtime: the camera path
// is driven by the `<oyon-app>` element, which rohy loads as a served <script>
// (loadOyonElement.js) and so costs the SPA bundle nothing. There is no such
// escape here — the element bundle contains the typing ADAPTER and aggregator
// for its own demo page, but not the `createSignalCapture` orchestrator, and
// exposes no host-facing API to drive them. So this genuinely has to be a
// bundler import, which is why it is a DYNAMIC one: the chunk is fetched only
// when a tenant has a signal modality enabled and the learner has consented.
// v2 previously pulled the whole oyon library into the main bundle graph
// (see the note in OyonCaptureWidget.jsx) — the dynamic import is what keeps
// that from happening again. Measure the dist/ delta if you change it.
//
// What this owns: lifecycle only. Attaching a composer, feeding messages, and
// reporting interactions are the callers' jobs, through the returned handle.

import { useEffect, useRef, useState } from 'react';
import { createSignalTransport } from './signalTransport';
import { oyonClientLog } from './clientLogger';

// Rohy never drives Oyon's microphone path. `VoiceService` already owns the
// mic, and voice capture needs its own consent surface and a single-mic-owner
// design — so voice is forced off here rather than left to a default, which
// keeps a stray tenant flag from reaching getUserMedia.
const VOICE_ALWAYS_OFF = { voice_enabled: false };

const MODALITY_FLAGS = Object.freeze([
    'typing_enabled',
    'interaction_enabled',
    'discourse_enabled',
    'ai_assist_enabled',
]);

/** Does the tenant config turn on any modality we are prepared to capture? */
export function anyModalityEnabled(runtimeConfig) {
    const cfg = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
    return MODALITY_FLAGS.some(key => cfg[key] === true);
}

/**
 * Build the settings bag `createSignalCapture` gates construction on. Only
 * real booleans are forwarded — `createOyonSettings` merges over its own
 * defaults, and a 0/1 int from a SQLite row would be read as "no opinion"
 * rather than as off. Same trap `captureBridge.elementSettings` documents.
 */
export function captureSettings(runtimeConfig) {
    const cfg = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {};
    const out = { ...VOICE_ALWAYS_OFF };
    for (const key of MODALITY_FLAGS) {
        if (typeof cfg[key] === 'boolean') out[key] = cfg[key];
    }
    return out;
}

/**
 * Start one signal capture for the current session and tear it down cleanly.
 *
 * Returns `{ capture, error }`. `capture` is Oyon's handle — `capture.typing`,
 * `capture.interaction`, `capture.discourse`, `capture.ai_assist` — or null
 * while inactive. A modality the tenant disabled is `null` on the handle, not
 * a no-op stub, so callers should branch on it rather than call into silence.
 *
 * `caseId` and `room` are deliberately NOT in the restart condition: they are
 * read at send time by the transport. Restarting on a room hop would abandon
 * an in-flight typing episode every time the learner navigates.
 */
export function useSignalCapture({ enabled, persist, runtimeConfig, sessionId, caseId, room }) {
    const [capture, setCapture] = useState(null);
    const [error, setError] = useState(null);

    // Live context for the transport, refreshed without restarting capture.
    // Written in an effect rather than during render: a render React discards
    // must not leave its values behind in a ref, and nothing reads this until
    // a window flushes — long after commit.
    const contextRef = useRef({ persist, sessionId, caseId, room });
    useEffect(() => {
        contextRef.current = { persist, sessionId, caseId, room };
    });

    const active = Boolean(enabled && persist && sessionId && anyModalityEnabled(runtimeConfig));
    // Restart only on a real settings change, not on every parent render.
    const settingsKey = JSON.stringify(captureSettings(runtimeConfig));

    useEffect(() => {
        if (!active) return undefined;

        // Guards the async gap: an unmount or session change while the import
        // is in flight must not install a capture nobody will ever stop.
        let cancelled = false;
        let started = null;

        (async () => {
            try {
                const { createSignalCapture } = await import('oyon/signal-capture');
                // The only await in this path, so this is the only place a
                // teardown can interleave. Returning here means nothing was
                // ever constructed — no listeners, no capture to leak — which
                // is why there is no second guard further down: everything
                // below runs synchronously.
                if (cancelled) return;

                started = createSignalCapture({
                    settings: JSON.parse(settingsKey),
                    // Transport only — no IndexedDB store. The camera path keeps
                    // a local copy because the element owns one already; adding a
                    // second client-side store here would be an unasked-for copy
                    // of learner data with no reader.
                    transport: createSignalTransport(() => contextRef.current),
                    onError: (e, info) => oyonClientLog('warn', 'signal capture error', {
                        scope: info?.scope || null,
                        error: e?.message || String(e),
                    }),
                });
                started.start({ session_id: sessionId });
                setCapture(started);
                setError(null);
                oyonClientLog('debug', 'signal capture started', {
                    session_id: sessionId,
                    modalities: MODALITY_FLAGS.filter(k => JSON.parse(settingsKey)[k]),
                });
            } catch (e) {
                if (cancelled) return;
                setError(e);
                oyonClientLog('warn', 'signal capture failed to start', {
                    session_id: sessionId,
                    error: e?.message || String(e),
                });
            }
        })();

        return () => {
            cancelled = true;
            setCapture(null);
            if (!started) return;
            // stop() finalizes in-flight episodes (typing as abandoned) and
            // flushes pending writes; dispose() only after it resolves, or the
            // last windows never reach the transport.
            started.stop()
                .catch(e => oyonClientLog('warn', 'signal capture stop failed', {
                    error: e?.message || String(e),
                }))
                .finally(() => started.dispose());
        };
    }, [active, sessionId, settingsKey]);

    return { capture, error };
}
