// Contract tests for the record→EmotionWindow mapper feeding the v2 Analyze
// dashboards (el.setWindows). Pins the projection so a DB column rename or a
// hydrateRecord change can't silently blank the dashboards.

import { describe, it, expect } from 'vitest';
import { recordToWindow, recordsToWindows } from './serverWindows.js';

const DB_RECORD = {
    id: 7,
    tenant_id: 't1',
    session_id: 42,
    user_id: 3,
    username: 'student',
    case_id: 5,
    record_id: 'r-abc',
    window_start: '2026-07-02T08:00:00.000Z',
    window_end: '2026-07-02T08:00:10.000Z',
    duration_ms: 10000,
    expected_samples: 20,
    dominant_emotion: 'neutral',
    probabilities: { neutral: 0.8, happy: 0.2 },
    valence: 0.12,
    arousal: -0.05,
    confidence: 0.74,
    entropy: 0.5,
    valid_frames: 18,
    missing_face_ratio: 0.1,
    quality: { blur: 0.1 },
    model_name: 'enet_b0_8_va_mtl',
    model_version: '1',
    model_profile: 'hse-emotion-mtl',
    dynamics: { rmssd_valence: 0.02 },
    gaze: { zones: { center_center: 0.9 }, n_points: 120 },
    engagement: { on_task_share: 0.8 },
    // DB-only noise that must not leak through
    emotion_probabilities_json: '{"neutral":0.8}',
    consent_version: 'oyon-consent-v1',
};

describe('recordToWindow', () => {
    it('projects every EmotionWindow field, ids stringified', () => {
        const w = recordToWindow(DB_RECORD);
        expect(w.session_id).toBe('42');
        expect(w.user_id).toBe('3');
        expect(w.case_id).toBe('5');
        expect(w.window_start).toBe(DB_RECORD.window_start);
        expect(w.dominant_emotion).toBe('neutral');
        expect(w.probabilities).toEqual({ neutral: 0.8, happy: 0.2 });
        expect(w.valence).toBe(0.12);
        expect(w.confidence).toBe(0.74);
        expect(w.valid_frames).toBe(18);
        expect(w.quality).toEqual({ blur: 0.1 });
        expect(w.gaze).toEqual({ zones: { center_center: 0.9 }, n_points: 120 });
        expect(w.engagement).toEqual({ on_task_share: 0.8 });
        expect(w).not.toHaveProperty('emotion_probabilities_json');
    });

    it('degrades pre-0028 rows to null gaze/engagement and defaults the required numbers', () => {
        const w = recordToWindow({ window_start: 'a', window_end: 'b' });
        expect(w.gaze).toBeNull();
        expect(w.engagement).toBeNull();
        expect(w.confidence).toBe(0);
        expect(w.valid_frames).toBe(0);
        expect(w.dominant_emotion).toBeNull();
    });
});

describe('recordsToWindows', () => {
    it('reverses newest-first API order into a chronological pool', () => {
        const newest = { ...DB_RECORD, window_start: '2026-07-02T09:00:00.000Z' };
        const oldest = { ...DB_RECORD, window_start: '2026-07-02T08:00:00.000Z' };
        const pool = recordsToWindows([newest, oldest]);
        expect(pool[0].window_start).toBe(oldest.window_start);
        expect(pool[1].window_start).toBe(newest.window_start);
    });

    it('tolerates non-array input', () => {
        expect(recordsToWindows(undefined)).toEqual([]);
    });
});

// Oyon 3 window-shared blocks (migration 0039). These are what let the
// element's OWN Analyze dashboards render the new modalities without Rohy
// authoring a view per signal — so dropping them here would silently blank the
// new dashboards exactly as a column rename would blank the old ones.
describe('Oyon 3 window-shared blocks', () => {
    const V3_RECORD = {
        ...DB_RECORD,
        facial: { facing_screen_ratio: 0.9, head_pose_mean: { yaw: 2 } },
        posture: { slump_ratio: 0.15 },
        heart_rate: { bpm: 74, bpm_robust: 73, confidence: 0.62 },
        respiration: { brpm: 13 },
        illumination: { mean_luma: 0.38 },
        capture_quality: { decoded_fps: 15.8 },
    };

    it('passes every v3 block through to the EmotionWindow', () => {
        const w = recordToWindow(V3_RECORD);
        expect(w.facial).toEqual({ facing_screen_ratio: 0.9, head_pose_mean: { yaw: 2 } });
        expect(w.posture).toEqual({ slump_ratio: 0.15 });
        expect(w.heart_rate).toEqual({ bpm: 74, bpm_robust: 73, confidence: 0.62 });
        expect(w.respiration).toEqual({ brpm: 13 });
        expect(w.illumination).toEqual({ mean_luma: 0.38 });
        expect(w.capture_quality).toEqual({ decoded_fps: 15.8 });
    });

    it('yields null (never undefined) for rows captured before 0039', () => {
        const w = recordToWindow(DB_RECORD);
        for (const key of ['facial', 'posture', 'heart_rate', 'respiration', 'illumination', 'capture_quality']) {
            expect(w[key]).toBeNull();
        }
    });

    it('leaves the pre-existing projection untouched', () => {
        const before = recordToWindow(DB_RECORD);
        const after = recordToWindow(V3_RECORD);
        expect(after.dominant_emotion).toBe(before.dominant_emotion);
        expect(after.gaze).toEqual(before.gaze);
        expect(after.engagement).toEqual(before.engagement);
        expect(after.room).toBe(before.room);
    });
});
