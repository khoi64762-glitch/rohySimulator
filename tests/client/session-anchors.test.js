// Tests for src/utils/sessionAnchors.js — the wall-clock anchoring that
// keeps the session clock and scenario timeline alive across the remounts
// caused by room switching, and across page refreshes.
//
// Regression lock: the session clock and scenario time used to be plain
// useState counters inside PatientMonitor; every room switch unmounted the
// component and replayed the vitals trajectory from t=0 (bug report
// 2.9.15 #14). Anchors derive time from timestamps so a remount resumes at
// the true position.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    parseUtcTimestamp,
    readScenarioAnchor,
    writeScenarioAnchor,
    anchorSeconds,
    SCENARIO_ANCHOR_KEY,
} from '../../src/utils/sessionAnchors.js';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('parseUtcTimestamp', () => {
    it('parses a bare SQLite timestamp as UTC, not local time', () => {
        // SQLite CURRENT_TIMESTAMP emits 'YYYY-MM-DD HH:MM:SS' with no zone.
        expect(parseUtcTimestamp('2026-08-08 10:00:00')).toBe(Date.parse('2026-08-08T10:00:00Z'));
    });

    it('leaves already-zoned strings alone', () => {
        expect(parseUtcTimestamp('2026-08-08T10:00:00Z')).toBe(Date.parse('2026-08-08T10:00:00Z'));
        expect(parseUtcTimestamp('2026-08-08T12:00:00+02:00')).toBe(Date.parse('2026-08-08T10:00:00Z'));
    });

    it('returns null for empty or unparseable input', () => {
        expect(parseUtcTimestamp(null)).toBeNull();
        expect(parseUtcTimestamp('')).toBeNull();
        expect(parseUtcTimestamp('not a date')).toBeNull();
    });
});

describe('scenario anchor persistence', () => {
    const anchor = { sessionId: 42, scenarioId: 'case_7', startMs: 1000, offsetSec: 0, playing: true };

    it('round-trips an anchor for the owning session', () => {
        writeScenarioAnchor(anchor);
        expect(readScenarioAnchor(42)).toEqual(anchor);
    });

    it('refuses an anchor that belongs to a different session', () => {
        writeScenarioAnchor(anchor);
        expect(readScenarioAnchor(43)).toBeNull();
        expect(readScenarioAnchor(null)).toBeNull();
    });

    it('clears the stored anchor when passed null', () => {
        writeScenarioAnchor(anchor);
        writeScenarioAnchor(null);
        expect(readScenarioAnchor(42)).toBeNull();
    });

    it('survives a corrupt stored value', () => {
        localStorage.setItem(SCENARIO_ANCHOR_KEY, '{not json');
        expect(readScenarioAnchor(42)).toBeNull();
    });
});

describe('anchorSeconds', () => {
    it('flows with wall-clock time while playing', () => {
        vi.spyOn(Date, 'now').mockReturnValue(90_000);
        expect(anchorSeconds({ startMs: 60_000, offsetSec: 5, playing: true })).toBe(35);
    });

    it('holds at offsetSec while paused', () => {
        vi.spyOn(Date, 'now').mockReturnValue(999_999_999);
        expect(anchorSeconds({ startMs: 60_000, offsetSec: 17, playing: false })).toBe(17);
    });

    it('resumes from the pause position, not from zero', () => {
        // pause at 17s, resume 100s later: time should continue from 17.
        const resumed = { startMs: 200_000, offsetSec: 17, playing: true };
        vi.spyOn(Date, 'now').mockReturnValue(210_000);
        expect(anchorSeconds(resumed)).toBe(27);
    });
});
