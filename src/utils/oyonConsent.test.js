import { describe, it, expect } from 'vitest';
import {
    consentRank, consentSatisfies, needsConsentUpgrade, acceptableVersion,
    OYON_CONSENT_CAMERA_ONLY,
} from './oyonConsent.js';

describe('oyonConsent version logic', () => {
    it('ranks unknown versions below v1 so they can never satisfy a check', () => {
        expect(consentRank('oyon-consent-v1')).toBe(0);
        expect(consentRank('oyon-consent-v2')).toBe(1);
        expect(consentRank('made-up')).toBe(-1);
        expect(consentSatisfies('made-up', 'oyon-consent-v1')).toBe(false);
    });

    // Mirrors the server reading a NULL accepted_version as v1 — the only
    // contract that existed before the column did.
    it('reads a missing accepted version as v1, not as current', () => {
        expect(consentSatisfies(undefined, 'oyon-consent-v1')).toBe(true);
        expect(consentSatisfies(undefined, 'oyon-consent-v2')).toBe(false);
        expect(consentSatisfies(null, 'oyon-consent-v2')).toBe(false);
    });

    it('accepts an equal or newer contract', () => {
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v2')).toBe(true);
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v1')).toBe(true);
        expect(consentSatisfies('oyon-consent-v1', 'oyon-consent-v2')).toBe(false);
    });

    // An out-of-date bundle must re-prompt rather than assume it is current.
    it('treats an unrecognised requirement as unsatisfied', () => {
        expect(consentSatisfies('oyon-consent-v2', 'oyon-consent-v9')).toBe(false);
    });

    describe('needsConsentUpgrade', () => {
        it('prompts a learner who said yes to an older contract', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: 'oyon-consent-v1', requiredVersion: 'oyon-consent-v2',
            })).toBe(true);
        });

        // Declining is an answer. Re-asking every load would be nagging; the
        // learner can opt in from Settings → Oyon whenever they want.
        it('does not nag a learner who declined', () => {
            expect(needsConsentUpgrade({
                granted: false, acceptedVersion: 'oyon-consent-v1', requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });

        // Never answered → the first-run card handles them, not this prompt.
        it('stays out of the way of a learner who has never answered', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: null, requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });

        it('is quiet once the learner is current', () => {
            expect(needsConsentUpgrade({
                granted: true, acceptedVersion: 'oyon-consent-v2', requiredVersion: 'oyon-consent-v2',
            })).toBe(false);
        });
    });

    it('never offers to accept a contract it cannot render', () => {
        expect(acceptableVersion('oyon-consent-v2')).toBe('oyon-consent-v2');
        expect(acceptableVersion('oyon-consent-v9')).toBe(OYON_CONSENT_CAMERA_ONLY);
    });
});
