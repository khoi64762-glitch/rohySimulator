// Contract tests for the host-driven signal transport.
//
// This is the payload that crosses the boundary between `SignalCapture` and
// rohy's ingest, so the properties pinned here are the ones a bug would be
// invisible behind: whose session_id wins, whether a closed gate really stops
// the POST, and whether `window_id` survives (the server dedups replayed
// batches on it).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateEmotionBatch, isModalityOnlyEvent } from 'oyon/validation';

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('./clientLogger', () => ({ oyonClientLog: vi.fn() }));

const { createSignalTransport } = await import('./signalTransport.js');

// Shaped after a real TypingAggregator.finalize() row plus the stamps
// SignalCapture.emitWindow adds (window_id / capture_id / session_id).
// Note `session_id: 'capture-session'` — deliberately NOT rohy's session, so
// the re-stamping test below is testing something real.
function typingWindow(overrides = {}) {
    return {
        modality: 'typing',
        window_kind: 'episode',
        feature_profile: 'typing-v3',
        window_start: '2026-07-30T10:00:00.000Z',
        window_end: '2026-07-30T10:00:42.000Z',
        typing: {
            elapsed_ms: 42000,
            active_input_ms: 18500,
            committed_graphemes: 214,
            edit_event_count: 240,
            burst_count: 6,
            submitted: true,
            abandoned: false,
        },
        window_id: 'win_abc123',
        capture_id: 'cap_xyz789',
        session_id: 'capture-session',
        ...overrides,
    };
}

const OPEN = { persist: true, sessionId: 'rohy-session-1', caseId: 'case-7', room: 'chat' };

beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
});

describe('createSignalTransport', () => {
    it('refuses to be built without a context reader', () => {
        expect(() => createSignalTransport()).toThrow(TypeError);
        expect(() => createSignalTransport({ sessionId: 'x' })).toThrow(TypeError);
    });

    it('posts the batch envelope the ingest expects', async () => {
        await createSignalTransport(() => OPEN).send([typingWindow()]);

        expect(apiFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = apiFetch.mock.calls[0];
        expect(url).toBe('/addons/oyon/emotion-records');
        expect(opts.method).toBe('POST');
        expect(opts.json.schema_version).toBe('oyon-window-batch-v4');
        expect(opts.json.session_id).toBe('rohy-session-1');
        expect(opts.json.events).toHaveLength(1);
    });

    it('stamps rohy\'s envelope onto the event', async () => {
        await createSignalTransport(() => OPEN).send([typingWindow()]);

        const event = apiFetch.mock.calls[0][1].json.events[0];
        expect(event.case_id).toBe('case-7');
        expect(event.room).toBe('chat');
        // Required by validateServerEvent; SignalCapture never sets it.
        expect(event.capture_mode).toBe('local-browser');
        // The server overwrites this from the accepted consent row — the
        // placeholder exists only so the payload validator passes.
        expect(event.consent_version).toBe('placeholder');
    });

    // The defect this prevents: a learner ends one session and starts another
    // while a typing episode is still open. The row carries the OLD session,
    // and the window would be filed against a session the learner has left.
    it('overrides the capture library\'s own session_id with rohy\'s', async () => {
        const row = typingWindow();
        expect(row.session_id).toBe('capture-session');

        await createSignalTransport(() => OPEN).send([row]);

        expect(apiFetch.mock.calls[0][1].json.events[0].session_id).toBe('rohy-session-1');
    });

    // Regression lock: the server dedups replayed signal batches on window_id
    // (`recordId` preference in insertSignalWindow, oyon-routes.js). Dropping
    // it would turn every retry into duplicate rows.
    it('preserves window_id, capture_id and the modality fields', async () => {
        await createSignalTransport(() => OPEN).send([typingWindow()]);

        const event = apiFetch.mock.calls[0][1].json.events[0];
        expect(event.window_id).toBe('win_abc123');
        expect(event.capture_id).toBe('cap_xyz789');
        expect(event.modality).toBe('typing');
        expect(event.window_kind).toBe('episode');
        expect(event.typing.committed_graphemes).toBe(214);
    });

    // The load-bearing assertion in this file. Everything else pins a field;
    // this pins that the whole body is one the ingest will actually accept.
    // `validateEmotionBatch` runs server-side on every POST, and
    // `isModalityOnlyEvent` is what routes the event into
    // `oyon_signal_windows` instead of `oyon_emotion_records` — a body that
    // failed either would be a 400, or worse, silently filed as a camera row.
    it('builds a body Oyon\'s own validator accepts and routes as modality-only', async () => {
        await createSignalTransport(() => OPEN).send([typingWindow()]);

        const body = apiFetch.mock.calls[0][1].json;
        expect(body.events.every(isModalityOnlyEvent)).toBe(true);

        const result = validateEmotionBatch(body);
        expect(result.errors ?? []).toEqual([]);
        expect(result.ok).toBe(true);
    });

    it('sends every row in one batch', async () => {
        await createSignalTransport(() => OPEN).send([
            typingWindow(),
            typingWindow({ modality: 'interaction', window_id: 'win_def456' }),
        ]);

        expect(apiFetch).toHaveBeenCalledTimes(1);
        expect(apiFetch.mock.calls[0][1].json.events).toHaveLength(2);
    });

    describe('the drop gate', () => {
        it('drops when consent is not open', async () => {
            await createSignalTransport(() => ({ ...OPEN, persist: false })).send([typingWindow()]);
            expect(apiFetch).not.toHaveBeenCalled();
        });

        it('drops when there is no session to attribute the window to', async () => {
            await createSignalTransport(() => ({ ...OPEN, sessionId: null })).send([typingWindow()]);
            expect(apiFetch).not.toHaveBeenCalled();
        });

        it('survives a context reader that returns nothing', async () => {
            await expect(createSignalTransport(() => undefined).send([typingWindow()]))
                .resolves.toBeUndefined();
            expect(apiFetch).not.toHaveBeenCalled();
        });

        it('does not post an empty batch', async () => {
            const transport = createSignalTransport(() => OPEN);
            await transport.send([]);
            await transport.send(null);
            await transport.send([null, undefined]);
            expect(apiFetch).not.toHaveBeenCalled();
        });
    });

    // The context is read per send, not captured at construction, because the
    // learner moves between rooms while one capture keeps running.
    it('re-reads the context on every send', async () => {
        let room = 'chat';
        const transport = createSignalTransport(() => ({ ...OPEN, room }));

        await transport.send([typingWindow()]);
        room = 'examination';
        await transport.send([typingWindow({ window_id: 'win_second' })]);

        expect(apiFetch.mock.calls[0][1].json.events[0].room).toBe('chat');
        expect(apiFetch.mock.calls[1][1].json.events[0].room).toBe('examination');
    });

    // Regression lock: swallowing would log the failure but leave
    // SignalCapture's stats.errorCount reading clean while telemetry went
    // nowhere. trackWrite() catches this and routes it to onError.
    it('rethrows a failed POST into SignalCapture\'s error channel', async () => {
        apiFetch.mockRejectedValue(new Error('offline'));
        await expect(createSignalTransport(() => OPEN).send([typingWindow()]))
            .rejects.toThrow('offline');
    });
});
