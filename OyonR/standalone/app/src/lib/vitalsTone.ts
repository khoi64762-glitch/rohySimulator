/*
 * Trust colouring for rate readouts (heart rate, breathing).
 *
 * One mapping, used by every surface that shows a rate, so the same number is
 * never green in one place and amber in another. Two independent things can
 * make a reading untrustworthy, and the colour reflects the WORSE of them:
 *
 *   1. The value is outside the physiologically plausible band. This is the
 *      hard signal — a resting adult is not at 47 bpm, so a confident 47 is
 *      more likely an artifact than a finding.
 *   2. Signal quality is low. An in-band value from a noisy ROI is a guess
 *      that happens to look reasonable.
 *
 * `reason` says WHICH, because "red" alone tells the user nothing they can act
 * on — out-of-band means don't trust the number, poor quality means fix the
 * lighting or sit still.
 */

export type VitalTone = 'ok' | 'warn' | 'bad' | 'null';

export interface VitalToneResult {
  tone: VitalTone;
  /** CSS colour token to apply to the value/indicator. */
  color: string;
  /** Short human explanation, or null when the reading is trustworthy. */
  reason: string | null;
}

const COLORS: Record<VitalTone, string> = {
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  bad: 'var(--status-bad)',
  null: 'var(--ink-3)',
};

/** Below this the reading is treated as untrustworthy; between the two it is
 *  marginal. Matches the heart-rate min-confidence default (0.5) sitting in
 *  the middle of the amber band. */
const QUALITY_BAD = 0.4;
const QUALITY_WARN = 0.6;

export function vitalTone({
  value,
  confidence,
  min,
  max,
}: {
  value: number | null | undefined;
  confidence: number | null | undefined;
  min: number;
  max: number;
}): VitalToneResult {
  if (value == null || !Number.isFinite(value)) {
    return { tone: 'null', color: COLORS.null, reason: null };
  }
  if (value < min || value > max) {
    return {
      tone: 'bad',
      color: COLORS.bad,
      reason: `outside ${min}–${max}`,
    };
  }
  const c = typeof confidence === 'number' && Number.isFinite(confidence) ? confidence : 0;
  if (c < QUALITY_BAD) {
    return { tone: 'bad', color: COLORS.bad, reason: 'low signal quality' };
  }
  if (c < QUALITY_WARN) {
    return { tone: 'warn', color: COLORS.warn, reason: 'marginal signal quality' };
  }
  return { tone: 'ok', color: COLORS.ok, reason: null };
}

export { QUALITY_BAD, QUALITY_WARN };
