// Oyon 3 modality-scoped window ingest + read contract (migration 0039).
//
// Regression lock: enabling Oyon 3's new camera modalities makes
// EmotionRuntime.sendWindows() emit standalone `facial_only` / `posture_only` /
// `heart_rate_only` windows that carry NO emotion data. They inherit
// capture_mode + consent_version from the same context spread, so they pass
// validateServerEvent() and — before this change — landed in
// oyon_emotion_records as `dominant_emotion IS NULL` rows. That silently
// shifted every existing row count and emotion distribution (Windows/Students/
// Cases views, the Affect/Attention/Sessions tabs, the emotion TNA sequences).
//
// The lock below fails against the un-fixed ingest: it posts a mixed batch and
// asserts oyon_emotion_records grew by EXACTLY the number of emotion windows.
//
// Uses the real spawned server + sqlite seed pattern from oyon-routes.test.js.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import sqlite3 from 'sqlite3';
import { startTestServer } from '../utils/startTestServer.js';

const SECRET = 'oyon-signal-windows-tests-secret';

function openDb(dbPath) {
    const sqlite = sqlite3.verbose();
    return new Promise((resolve, reject) => {
        const db = new sqlite.Database(dbPath, (err) => err ? reject(err) : resolve(db));
    });
}
function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.run(sql, params, function done(err) { err ? reject(err) : resolve(this); })
    );
}
function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) =>
        db.get(sql, params, (err, row) => err ? reject(err) : resolve(row || null))
    );
}
function dbClose(db) { return new Promise((r) => db.close(() => r())); }
function tokenFor(user, jti) {
    return jwt.sign(user, SECRET, { expiresIn: '1h', jwtid: jti });
}

async function setOyonViewFlags(dbPath, { admin = 1, educator = 1, student = 1 } = {}) {
    const db = await openDb(dbPath);
    await dbRun(db,
        `INSERT OR REPLACE INTO oyon_settings (
            tenant_id, emotion_capture_enabled,
            admin_emotion_view_enabled, educator_emotion_view_enabled, student_emotion_view_enabled,
            model_profile, sample_interval_ms, window_ms,
            min_valid_frames, smoothing_alpha, min_hold_ms, min_switch_confidence
         ) VALUES ('1', 1, ?, ?, ?,
                   'hse-emotion-mtl', 500, 10000, 3, 0.28, 3000, 0.5)`,
        [admin, educator, student]);
    await dbClose(db);
}

async function countRows(dbPath, table) {
    const db = await openDb(dbPath);
    const row = await dbGet(db, `SELECT COUNT(*) AS n FROM ${table}`);
    await dbClose(db);
    return Number(row?.n) || 0;
}

// Distinct window bounds per call so legitimately different windows hash apart.
let windowSeq = 0;
function windowBounds() {
    windowSeq += 1;
    const start = new Date(Date.now() - (600_000 - windowSeq * 20_000));
    const end = new Date(start.getTime() + 10_000);
    return { window_start: start.toISOString(), window_end: end.toISOString() };
}

const ENVELOPE = { capture_mode: 'local-browser', consent_version: 'oyon-consent-v1' };

function emotionWindow(sessionId) {
    return {
        ...ENVELOPE,
        ...windowBounds(),
        session_id: String(sessionId),
        dominant_emotion: 'happy',
        probabilities: { happy: 1 },
        confidence: 0.9,
        valid_frames: 8,
        missing_face_ratio: 0,
    };
}

/*
 * A camera modality-only window in the legacy `<x>_only` shape v3 still emits.
 *
 * Faithful to EmotionRuntime.sendWindows(): the modality block is NESTED and
 * carries its own valid_frames/duration_ms (see FacialSignalAggregator.flush),
 * so nothing supplies a TOP-LEVEL valid_frames. That is precisely what broke the
 * un-fixed ingest — binding undefined into `valid_frames NOT NULL`. Adding a
 * top-level valid_frames here would make the fixture unfaithful AND hide the bug.
 */
function modalityOnlyWindow(sessionId, flag, block, bounds = windowBounds()) {
    return {
        ...ENVELOPE,
        ...bounds,
        session_id: String(sessionId),
        [flag]: true,
        ...block,
    };
}

/** An emotion window carrying the v3 shared blocks (`*_window_share` default). */
function emotionWindowWithSharedBlocks(sessionId) {
    return {
        ...emotionWindow(sessionId),
        facial: { head_pose_mean: { yaw: 2 }, facing_screen_ratio: 0.9, valid_frames: 8 },
        posture: { slump_ratio: 0.15, valid_frames: 8 },
        heart_rate: { bpm: 74, bpm_robust: 73, confidence: 0.62 },
        respiration: { brpm: 13, confidence: 0.51 },
        illumination: { mean_luma: 0.38 },
        capture_quality: { decoded_fps: 15.8 },
    };
}

/** A v4 window declaring `modality` explicitly. */
function modalityWindow(sessionId, modality, payload, windowKind = 'interval') {
    return {
        ...ENVELOPE,
        ...windowBounds(),
        session_id: String(sessionId),
        modality,
        window_kind: windowKind,
        [modality]: payload,
    };
}

async function postBatch(server, token, events) {
    const res = await fetch(`${server.baseUrl}/api/addons/oyon/emotion-records`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema_version: 'oyon-window-batch-v4', events }),
    });
    return { status: res.status, body: await res.json() };
}

describe('Oyon 3 modality-scoped window ingest', () => {
    let server;
    let studentTok, educatorTok, adminTok;
    let sessionId;

    beforeAll(async () => {
        server = await startTestServer({ env: { JWT_SECRET: SECRET, OYON_ENABLED: '1' } });

        const db = await openDb(server.dbPath);
        const pwd = await bcrypt.hash('x', 4);
        for (const [u, role] of [['osw_stu', 'student'], ['osw_edu', 'educator'], ['osw_admin', 'admin']]) {
            await dbRun(db,
                `INSERT INTO users (username, name, password_hash, email, role, status, tenant_id)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [u, u, pwd, `${u}@example.com`, role]);
        }
        const stu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_stu']);
        const edu = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_edu']);
        const admin = await dbGet(db, 'SELECT id FROM users WHERE username = ?', ['osw_admin']);

        // Session owned by the student — POST requires the session owner.
        await dbRun(db,
            `INSERT INTO sessions (user_id, case_id, start_time, tenant_id)
             VALUES (?, 1, datetime('now', '-1 hour'), 1)`,
            [stu.id]);
        const sess = await dbGet(db,
            'SELECT id FROM sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1', [stu.id]);
        sessionId = sess.id;

        // Granted consent — ingest refuses without one.
        await dbRun(db,
            `INSERT INTO oyon_emotion_consents
                (tenant_id, user_id, session_id, consent_granted, consent_version)
             VALUES ('1', ?, ?, 1, 'oyon-consent-v1')`,
            [String(stu.id), String(sessionId)]);
        await dbClose(db);

        studentTok = tokenFor({ id: stu.id, username: 'osw_stu', role: 'student', tenant_id: 1 }, 'sw-s');
        educatorTok = tokenFor({ id: edu.id, username: 'osw_edu', role: 'educator', tenant_id: 1 }, 'sw-e');
        adminTok = tokenFor({ id: admin.id, username: 'osw_admin', role: 'admin', tenant_id: 1 }, 'sw-a');

        await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
    });

    afterAll(async () => { if (server) await server.close(); });

    // Regression lock: modality-only windows must NOT reach oyon_emotion_records.
    it('routes a mixed batch so emotion records grow by exactly the emotion count', async () => {
        const emotionsBefore = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsBefore = await countRows(server.dbPath, 'oyon_signal_windows');

        const { status, body } = await postBatch(server, studentTok, [
            emotionWindow(sessionId),
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 3, frontal_ratio: 0.8 } }),
            modalityOnlyWindow(sessionId, 'heart_rate_only', { heart_rate: { bpm: 72, confidence: 0.6 } }),
            modalityOnlyWindow(sessionId, 'posture_only', { posture: { slump_ratio: 0.2 } }),
        ]);

        expect(status).toBe(200);
        expect(body.inserted).toBe(1);            // emotion windows only
        expect(body.signals_inserted).toBe(3);    // facial + heart_rate + posture

        const emotionsAfter = await countRows(server.dbPath, 'oyon_emotion_records');
        const signalsAfter = await countRows(server.dbPath, 'oyon_signal_windows');
        expect(emotionsAfter - emotionsBefore).toBe(1);
        expect(signalsAfter - signalsBefore).toBe(3);
    });

    // Regression lock: no NULL-emotion rows may ever appear in the emotion table.
    it('never writes a dominant_emotion IS NULL row into oyon_emotion_records', async () => {
        await postBatch(server, studentTok, [
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 1 } }),
            modalityOnlyWindow(sessionId, 'engagement_only', { engagement: { focus_score: 0.7 } }),
            modalityOnlyWindow(sessionId, 'gaze_only', { gaze: { n_points: 40, dispersion: 0.05 } }),
        ]);
        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            'SELECT COUNT(*) AS n FROM oyon_emotion_records WHERE dominant_emotion IS NULL');
        await dbClose(db);
        expect(Number(row.n)).toBe(0);
    });

    // Regression lock for shape 1: the DEFAULT path. Every `*_window_share`
    // setting defaults true, so these blocks ride on the emotion window — and
    // before 0039 there were no columns for them, so they were silently dropped
    // exactly as v1 dropped gaze/engagement (see migration 0028).
    it('persists the window-shared blocks that ride on an emotion window', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            emotionWindowWithSharedBlocks(sessionId),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.signals_inserted).toBe(0); // it IS an emotion window

        const db = await openDb(server.dbPath);
        const row = await dbGet(db,
            `SELECT facial_json, posture_json, heart_rate_json, respiration_json,
                    illumination_json, capture_quality_json
             FROM oyon_emotion_records ORDER BY id DESC LIMIT 1`);
        await dbClose(db);
        expect(JSON.parse(row.facial_json)).toMatchObject({ facing_screen_ratio: 0.9 });
        expect(JSON.parse(row.posture_json)).toMatchObject({ slump_ratio: 0.15 });
        expect(JSON.parse(row.heart_rate_json)).toMatchObject({ bpm: 74, bpm_robust: 73 });
        expect(JSON.parse(row.respiration_json)).toMatchObject({ brpm: 13 });
        expect(JSON.parse(row.illumination_json)).toMatchObject({ mean_luma: 0.38 });
        expect(JSON.parse(row.capture_quality_json)).toMatchObject({ decoded_fps: 15.8 });
    });

    it('hydrates the shared blocks back out through GET /emotion-records', async () => {
        const res = await fetch(
            `${server.baseUrl}/api/addons/oyon/emotion-records?session_id=${sessionId}`,
            { headers: { Authorization: `Bearer ${adminTok}` } });
        const body = await res.json();
        const withBlocks = body.records.find(r => r.heart_rate != null);
        expect(withBlocks).toBeDefined();
        expect(withBlocks.heart_rate).toMatchObject({ bpm: 74 });
        expect(withBlocks.facial).toMatchObject({ facing_screen_ratio: 0.9 });
    });

    it('accepts v4 windows that declare `modality` explicitly, including episodes', async () => {
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(sessionId, 'typing', { keystrokes: 120, mean_iki_ms: 180 }, 'episode'),
            modalityWindow(sessionId, 'respiration', { brpm: 14, confidence: 0.5 }),
            modalityWindow(sessionId, 'illumination', { mean_luma: 0.42 }),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(0);
        expect(body.signals_inserted).toBe(3);

        const db = await openDb(server.dbPath);
        const episode = await dbGet(db,
            `SELECT modality, window_kind, payload_json FROM oyon_signal_windows
             WHERE modality = 'typing' ORDER BY id DESC LIMIT 1`);
        await dbClose(db);
        expect(episode.window_kind).toBe('episode');
        expect(JSON.parse(episode.payload_json)).toMatchObject({ keystrokes: 120, mean_iki_ms: 180 });
    });

    // Oyon's own validateEmotionBatch rejects an unrecognised `modality` at the
    // boundary, so the batch never reaches resolveModality — the handler's
    // unknown-modality guard is defence-in-depth behind it, not the active path.
    // What matters here is the observable contract: rejected, and nothing stored.
    it('rejects an unknown modality rather than storing it', async () => {
        const before = await countRows(server.dbPath, 'oyon_signal_windows');
        const { status, body } = await postBatch(server, studentTok, [
            modalityWindow(sessionId, 'telepathy', { vibes: 1 }),
        ]);
        expect(status).toBe(400);
        expect(JSON.stringify(body)).toMatch(/modality/i);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(before);
    });

    // The dedup key includes modality precisely because of this collision.
    it('keeps an emotion window and a same-bounds facial window as separate rows', async () => {
        const bounds = windowBounds();
        const { status, body } = await postBatch(server, studentTok, [
            { ...ENVELOPE, ...bounds, session_id: String(sessionId), dominant_emotion: 'sad',
              probabilities: { sad: 1 }, confidence: 0.8, valid_frames: 6, missing_face_ratio: 0 },
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 9 } }, bounds),
            modalityOnlyWindow(sessionId, 'posture_only', { posture: { slump_ratio: 0.4 } }, bounds),
        ]);
        expect(status).toBe(200);
        expect(body.inserted).toBe(1);
        expect(body.signals_inserted).toBe(2); // same bounds, different modalities
    });

    it('is idempotent on replay — a repeated batch inserts nothing new', async () => {
        const events = [
            modalityOnlyWindow(sessionId, 'facial_only', { facial: { head_yaw_deg: 5 } }),
            modalityWindow(sessionId, 'interaction', { clicks: 12, scroll_px: 900 }),
        ];
        const first = await postBatch(server, studentTok, events);
        expect(first.body.signals_inserted).toBe(2);

        const before = await countRows(server.dbPath, 'oyon_signal_windows');
        const replay = await postBatch(server, studentTok, events);
        expect(replay.body.signals_inserted).toBe(0);
        expect(replay.body.signals_skipped).toBe(2);
        expect(await countRows(server.dbPath, 'oyon_signal_windows')).toBe(before);
    });

    describe('GET /api/addons/oyon/signal-windows', () => {
        it('applies the same access policy as /emotion-records', async () => {
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
            const asStudent = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${studentTok}` },
            });
            expect(asStudent.status).toBe(403);
            expect((await asStudent.json()).code).toBe('oyon_role_required');

            const asEducator = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(asEducator.status).toBe(200);

            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 0, student: 1 });
            const educatorOff = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows`, {
                headers: { Authorization: `Bearer ${educatorTok}` },
            });
            expect(educatorOff.status).toBe(403);
            expect((await educatorOff.json()).code).toBe('oyon_view_disabled');
            await setOyonViewFlags(server.dbPath, { admin: 1, educator: 1, student: 1 });
        });

        it('filters by modality and reports which modalities hold data', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows?modality=facial`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.windows.length).toBeGreaterThan(0);
            expect(body.windows.every(w => w.modality === 'facial')).toBe(true);
            expect(body.windows[0].payload).toBeTypeOf('object');
            expect(body.modalities).toEqual([{ modality: 'facial', count: body.total }]);
        });

        it('rejects an unknown modality filter', async () => {
            const res = await fetch(`${server.baseUrl}/api/addons/oyon/signal-windows?modality=telepathy`, {
                headers: { Authorization: `Bearer ${adminTok}` },
            });
            expect(res.status).toBe(400);
            expect((await res.json()).code).toBe('oyon_unknown_modality');
        });
    });

    // The whole point of the separate table: existing surfaces cannot shift.
    it('leaves GET /emotion-records unable to see modality windows', async () => {
        const res = await fetch(
            `${server.baseUrl}/api/addons/oyon/emotion-records?session_id=${sessionId}`,
            { headers: { Authorization: `Bearer ${adminTok}` } });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.records.length).toBeGreaterThan(0);
        expect(body.records.every(r => r.dominant_emotion != null)).toBe(true);
        expect(body.records.every(r => r.modality === undefined)).toBe(true);
    });
});
