// End-to-end lock for the host-driven signal chain, with the REAL Oyon
// library — no mock of createSignalCapture anywhere in this file.
//
// Every other test in this area pins one link: the transport's envelope, the
// hook's lifecycle, the gate's conditions. This one drives actual DOM events
// through `createSignalCapture` and asserts what lands at `apiFetch`, which is
// the only way to catch a break in the JOINS between them — a settings key
// Oyon renamed, a window shape the batch validator rejects, an envelope field
// the server needs that nothing stamps.
//
// Interaction is the modality used here because it needs no host wiring at
// all: SignalCapture constructs the tracker from documentRef/windowRef itself,
// so enabling the tenant flag is the whole integration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEmotionBatch, isModalityOnlyEvent } from 'oyon/validation';

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const { createSignalCapture } = await import('oyon/signal-capture');
const { createSignalTransport } = await import('./signalTransport.js');
const { captureSettings } = await import('./useSignalCapture.js');

const CONTEXT = { persist: true, sessionId: 'rohy-session-1', caseId: 'case-7', room: 'chat' };

function postedBatches() {
    return apiFetch.mock.calls
        .filter(([url]) => url === '/addons/oyon/emotion-records')
        .map(([, opts]) => opts.json);
}

beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
});

describe('signal pipeline (real Oyon → rohy transport)', () => {
    it('turns real DOM activity into a batch the ingest accepts', async () => {
        const capture = createSignalCapture({
            settings: captureSettings({ interaction_enabled: true }),
            transport: createSignalTransport(() => CONTEXT),
        });
        capture.start({ session_id: CONTEXT.sessionId });

        // The tracker is page-wide by design, so plain document events are the
        // realistic input — no adapter to attach.
        expect(capture.interaction).not.toBeNull();
        document.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 20 }));
        document.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 60 }));
        window.dispatchEvent(new Event('scroll'));

        await capture.stop();

        const batches = postedBatches();
        expect(batches).toHaveLength(1);
        const [batch] = batches;

        // The joins: routed as a signal window, accepted by the validator, and
        // stamped with rohy's envelope rather than the capture library's.
        expect(batch.events.every(isModalityOnlyEvent)).toBe(true);
        const validation = validateEmotionBatch(batch);
        expect(validation.errors ?? []).toEqual([]);

        const event = batch.events[0];
        expect(event.modality).toBe('interaction');
        expect(event.window_kind).toBe('interval');
        expect(event.session_id).toBe('rohy-session-1');
        expect(event.case_id).toBe('case-7');
        expect(event.room).toBe('chat');
        expect(event.capture_mode).toBe('local-browser');
        expect(event.interaction.click_count).toBe(2);

        capture.dispose();
    });

    // A disabled modality is a null handle, not a stub — and must cost nothing.
    it('constructs nothing and sends nothing when the tenant disables it', async () => {
        const capture = createSignalCapture({
            settings: captureSettings({ interaction_enabled: false }),
            transport: createSignalTransport(() => CONTEXT),
        });
        capture.start({ session_id: CONTEXT.sessionId });

        expect(capture.interaction).toBeNull();
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        await capture.stop();
        expect(postedBatches()).toHaveLength(0);
        capture.dispose();
    });

    // The gate is rohy's, and it is read at flush time — a window finalized
    // after consent closes must not be sent.
    it('drops the window when the gate closed before the flush', async () => {
        let ctx = { ...CONTEXT };
        const capture = createSignalCapture({
            settings: captureSettings({ interaction_enabled: true }),
            transport: createSignalTransport(() => ctx),
        });
        capture.start({ session_id: CONTEXT.sessionId });
        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        ctx = { ...CONTEXT, persist: false };
        await capture.stop();

        expect(postedBatches()).toHaveLength(0);
        capture.dispose();
    });

    // Documented limitation, pinned so the behaviour is visible rather than
    // discovered later: InteractionAggregator produces ONE window per
    // start()/finalize() span, and SignalCapture finalizes it only at
    // teardown. There is no periodic flush and no host-facing finalize on the
    // handle (`capture.interaction` exposes `active` and `tracker` only), so an
    // interaction window is a whole-session summary and is lost entirely if
    // the tab closes without React cleanup running. See the upstream item in
    // todo/OYON_SIGNALCAPTURE_PLAN.md.
    it('emits interaction only at teardown, never mid-session', async () => {
        const capture = createSignalCapture({
            settings: captureSettings({ interaction_enabled: true }),
            transport: createSignalTransport(() => CONTEXT),
        });
        capture.start({ session_id: CONTEXT.sessionId });

        document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise(r => setTimeout(r, 30));
        expect(postedBatches()).toHaveLength(0);   // nothing yet, by design
        expect(Object.keys(capture.interaction)).not.toContain('finalize');

        await capture.stop();
        expect(postedBatches()).toHaveLength(1);
        capture.dispose();
    });
});
