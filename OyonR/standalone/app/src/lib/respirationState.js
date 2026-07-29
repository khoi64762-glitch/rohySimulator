/*
 * One interpretation of the live respiration contract for every screen.
 * `ready` means the signal is usable, not that acquisition is incomplete, so
 * treating `ready === false` as "acquiring" is incorrect once the buffer is
 * full. Keep this dependency-free so the state machine is directly testable.
 */

export function respirationPhase(sample) {
  if (Number.isFinite(sample?.brpm)) return 'measured';

  const progress = finite(sample?.progress);
  const bufferedSeconds = finite(sample?.bufferedSeconds);
  const minWindowSeconds = finite(sample?.minWindowSeconds);
  const buffered = sample?.buffered === true
    || progress >= 0.999
    || (bufferedSeconds != null
      && minWindowSeconds != null
      && bufferedSeconds >= minWindowSeconds);

  if (!buffered) return 'acquiring';
  if (sample?.estimateState === 'confirming' || sample?.statusReason === 'confirming') {
    return 'confirming';
  }
  return 'unconfirmed';
}

export function respirationStatusText(sample) {
  const phase = respirationPhase(sample);
  if (phase === 'measured') return 'measuring';
  if (phase === 'confirming') {
    const count = finite(sample?.confirmationCount);
    const required = finite(sample?.confirmationRequired);
    return count != null && required != null
      ? `confirming rate — ${Math.round(count)}/${Math.round(required)} checks`
      : 'confirming stable rate';
  }
  if (phase === 'acquiring') {
    const progress = finite(sample?.progress);
    const target = finite(sample?.minWindowSeconds) ?? 25;
    const rebuilding = sample?.statusReason === 'sample_gap';
    if (progress != null) {
      return `${rebuilding ? 'rebuilding after camera pause' : 'acquiring'} — ${Math.round(progress * 100)}% of ~${Math.round(target)} s`;
    }
    return rebuilding ? 'rebuilding after camera pause' : 'acquiring';
  }
  if (sample?.statusReason === 'low_sample_rate') {
    const rate = finite(sample?.sampleRateHz);
    return `camera cadence too low${rate != null ? ` (${rate.toFixed(1)} Hz)` : ''}`;
  }
  if (sample?.statusReason === 'sample_gap') return 'camera stream paused — keep this tab visible';
  if (sample?.estimateState === 'rgb_uncorroborated' || sample?.rgbCorroborationRequired) {
    return 'no RGB-corroborated rate — improve lighting and sit still';
  }
  if (sample?.estimateState === 'low_confidence') {
    return 'signal too weak — improve front lighting and sit still';
  }
  if (sample?.estimateState === 'unstable_rate') {
    return 'rate is unstable — sit still and breathe normally';
  }
  return 'no stable rate — sit still, breathe normally, improve lighting';
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
