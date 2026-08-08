// Unit test for the turnaround resolver. Server-side regression lock for
// the 1–5 minute clamp + the single priority chain shared by both the
// lab and radiology endpoints.

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_TURNAROUND_MINUTES,
    resolveTurnaroundMinutes,
} from '../../server/lib/turnaround.js';

describe('resolveTurnaroundMinutes', () => {
    it('exposes DEFAULT_TURNAROUND_MINUTES inside the 1–5 minute clamp', () => {
        expect(DEFAULT_TURNAROUND_MINUTES).toBeGreaterThanOrEqual(1);
        expect(DEFAULT_TURNAROUND_MINUTES).toBeLessThanOrEqual(5);
    });

    it('requestOverride === 0 beats every other source (student Instant button)', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 0,
            caseConfig: { investigations: { instantResults: false, defaultTurnaround: 4 } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('case-level instantResults beats request override > 0 and per-test default', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 3,
            caseConfig: { investigations: { instantResults: true } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('student instantly STILL beats case-level instantResults (learner-side convenience wins)', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 0,
            caseConfig: { investigations: { instantResults: true } },
            testDefault: 5,
        });
        expect(got).toBe(0);
    });

    it('positive request override beats per-test default', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: 2,
            testDefault: 5,
        });
        expect(got).toBe(2);
    });

    it('per-test default beats case-level default', () => {
        const got = resolveTurnaroundMinutes({
            testDefault: 1,
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(1);
    });

    it('case-level default applied when there is no per-test value', () => {
        const got = resolveTurnaroundMinutes({
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(4);
    });

    it('falls back to DEFAULT_TURNAROUND_MINUTES when nothing is supplied', () => {
        expect(resolveTurnaroundMinutes({})).toBe(DEFAULT_TURNAROUND_MINUTES);
        expect(resolveTurnaroundMinutes()).toBe(DEFAULT_TURNAROUND_MINUTES);
    });

    it('non-numeric / NaN / negative request overrides are ignored', () => {
        const got = resolveTurnaroundMinutes({
            requestOverride: null,
            testDefault: 3,
        });
        expect(got).toBe(3);

        const got2 = resolveTurnaroundMinutes({
            requestOverride: undefined,
            testDefault: 3,
        });
        expect(got2).toBe(3);

        const got3 = resolveTurnaroundMinutes({
            requestOverride: -1,
            testDefault: 3,
        });
        expect(got3).toBe(3);
    });

    // Regression lock: explicit per-test 0 means "instant" — the authoring
    // editor's Immediate button was silently discarded because the resolver
    // rejected 0 as "no per-test value" (bug report 2.9.15 #4). Migration
    // 0043 nulled the historical stamped 0s this rule used to guard against.
    it('explicit per-test 0 resolves to 0 (instant), beating the case default', () => {
        const got = resolveTurnaroundMinutes({
            testDefault: 0,
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        });
        expect(got).toBe(0);
    });

    // Regression lock: per-test null/undefined = "unset — follow the case
    // default"; only a real number is a configured value (bug report 2.9.15 #4).
    it('per-test null/undefined falls through to the case default', () => {
        const caseConfig = { investigations: { defaultTurnaround: 4 } };
        expect(resolveTurnaroundMinutes({ testDefault: null, caseConfig })).toBe(4);
        expect(resolveTurnaroundMinutes({ testDefault: undefined, caseConfig })).toBe(4);
    });

    // Regression lock: a concrete per-test value wins over any case default
    // (bug report 2.9.15 #4).
    it('a concrete per-test value is honoured regardless of the case default', () => {
        expect(resolveTurnaroundMinutes({
            testDefault: 7,
            caseConfig: { investigations: { defaultTurnaround: 4 } },
        })).toBe(7);
        expect(resolveTurnaroundMinutes({ testDefault: 7 })).toBe(7);
    });

    it('NaN / negative / non-numeric per-test values are treated as unset', () => {
        const caseConfig = { investigations: { defaultTurnaround: 4 } };
        expect(resolveTurnaroundMinutes({ testDefault: NaN, caseConfig })).toBe(4);
        expect(resolveTurnaroundMinutes({ testDefault: -1, caseConfig })).toBe(4);
        expect(resolveTurnaroundMinutes({ testDefault: '3', caseConfig })).toBe(4);
    });
});
