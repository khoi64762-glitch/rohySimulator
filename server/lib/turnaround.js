// Turnaround time — single source of truth for both labs and radiology.
// Wall-clock minutes from order time to result availability.
//
// The REQUEST override is client input and is clamped to 0…MAX_REQUEST_OVERRIDE
// (the sim's compressed pacing band, per migration 0023). It is a learner-side
// convenience — "give me this result now" — so it may shorten a wait and must
// never be able to lengthen one. Unclamped, `turnaround_override: Infinity`
// reached SQL as `datetime('now','+Infinity minutes')`, which evaluates to NULL:
// the result then never became available AND the duplicate-order guard refused
// to let it be re-ordered. A learner could permanently brick one of their own
// investigations, and nothing in the code enforced the band this header claimed.
//
// AUTHOR values (per-test and per-case) are not clamped here — an educator may
// legitimately want a long wait for delayed-result teaching, and those values
// come from the database, not from a request body. They are only checked for
// finiteness, because a NaN in this function is a NULL in the schedule.

export const DEFAULT_TURNAROUND_MINUTES = 3;

/** Ceiling for a client-supplied override. The sim band is 1–5 minutes. */
export const MAX_REQUEST_OVERRIDE_MINUTES = 5;

/** A usable positive wall-clock value — finite, a real number, above zero. */
function positiveMinutes(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Priority (highest first):
 *   1. requestOverride === 0           student clicked "Order instantly"
 *   2. caseConfig.investigations.instantResults === true
 *                                      educator pinned the case to instant
 *   3. requestOverride > 0             explicit per-order value
 *   4. testDefault > 0                 per-test value (case_investigations
 *                                      row or radiology master DB)
 *   5. caseConfig.investigations.defaultTurnaround > 0
 *                                      case-level default
 *   6. DEFAULT_TURNAROUND_MINUTES (3)  final fallback
 *
 * Student instant beats case-level instant: the button is a learner-side
 * convenience that should always work, even on a realistic-timing case.
 */
export function resolveTurnaroundMinutes({ requestOverride, caseConfig, testDefault } = {}) {
    if (requestOverride === 0) return 0;
    if (caseConfig?.investigations?.instantResults === true) return 0;
    if (positiveMinutes(requestOverride)) {
        return Math.min(requestOverride, MAX_REQUEST_OVERRIDE_MINUTES);
    }
    if (positiveMinutes(testDefault)) return testDefault;
    const caseDefault = caseConfig?.investigations?.defaultTurnaround;
    if (positiveMinutes(caseDefault)) return caseDefault;
    return DEFAULT_TURNAROUND_MINUTES;
}
