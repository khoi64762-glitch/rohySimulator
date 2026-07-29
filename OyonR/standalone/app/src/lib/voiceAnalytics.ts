import type { VoiceMetrics } from '../../../../types/voice';

/*
 * voiceAnalytics — pooling and labelling for /analyze/voice, kept out of the
 * route so the session-level arithmetic is testable without React (same
 * split as typingAnalytics.ts).
 *
 * The pooling rule, which is the whole reason this is a module and not four
 * inline reduces: EVERY rate divides POOLED TOTALS. Averaging per-turn
 * ratios would give a 2-second turn the same weight as a 2-minute one, so a
 * single short noisy turn could move the session figure more than the turn
 * the learner actually spent their time on.
 *
 * Null discipline, inherited from the aggregator: a rate whose denominator
 * is zero is `null` ("not measured"), never 0. A session with no recorded
 * turn time does not have a 0% speech ratio.
 *
 * Flagged turns (`insufficient_data`) ARE pooled. Excluding them would
 * silently redefine what the session summary describes; they are counted
 * separately so the UI can say how much of the total is shaky.
 */

export interface VoiceTurnLike {
  voice: VoiceMetrics;
}

export interface VoiceSessionSummary {
  turns: number;
  totalTurnMs: number;
  totalSpeechMs: number;
  totalPauseMs: number;
  pauseCount: number;
  /** Pooled speech time / pooled turn time — null with no turn time. */
  pooledSpeechRatio: number | null;
  /** Internal pauses per minute of pooled turn time — null with no turn time. */
  pauseRatePerMin: number | null;
  /** Mean internal pause length in ms — null with no internal pauses. */
  meanPauseMs: number | null;
  /** Share of pooled turn time spent in internal pauses — null with no turn time. */
  pauseShare: number | null;
  /** Lowest / highest per-turn median F0 — null when no turn reached the pitch floor. */
  pitchLo: number | null;
  pitchHi: number | null;
  /** Turns that produced a pitch median (i.e. reached the voiced-frame floor). */
  withPitch: number;
  insufficient: number;
  /** Pause-length buckets summed across every turn. */
  pauseHistogram: Record<string, number>;
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function aggregateVoiceTurns(turns: VoiceTurnLike[] | null | undefined): VoiceSessionSummary {
  const list = Array.isArray(turns) ? turns : [];
  let totalTurnMs = 0;
  let totalSpeechMs = 0;
  let totalPauseMs = 0;
  let pauseCount = 0;
  let insufficient = 0;
  const medians: number[] = [];
  const pauseHistogram: Record<string, number> = {};

  for (const turn of list) {
    const voice = turn?.voice;
    if (!voice) continue;
    totalTurnMs += finite(voice.turn_duration_ms);
    totalSpeechMs += finite(voice.speech_duration_ms);
    totalPauseMs += finite(voice.internal_pause_total_ms);
    pauseCount += finite(voice.internal_pause_count);
    if (voice.insufficient_data) insufficient += 1;
    if (voice.pitch_median_hz != null && Number.isFinite(voice.pitch_median_hz)) {
      medians.push(voice.pitch_median_hz);
    }
    for (const [bucket, count] of Object.entries(voice.pause_histogram ?? {})) {
      if (Number.isFinite(count)) pauseHistogram[bucket] = (pauseHistogram[bucket] ?? 0) + count;
    }
  }

  return {
    turns: list.length,
    totalTurnMs,
    totalSpeechMs,
    totalPauseMs,
    pauseCount,
    pooledSpeechRatio: totalTurnMs > 0 ? totalSpeechMs / totalTurnMs : null,
    pauseRatePerMin: totalTurnMs > 0 ? pauseCount / (totalTurnMs / 60000) : null,
    meanPauseMs: pauseCount > 0 ? totalPauseMs / pauseCount : null,
    pauseShare: totalTurnMs > 0 ? totalPauseMs / totalTurnMs : null,
    pitchLo: medians.length > 0 ? Math.min(...medians) : null,
    pitchHi: medians.length > 0 ? Math.max(...medians) : null,
    withPitch: medians.length,
    insufficient,
    pauseHistogram,
  };
}

/**
 * `lt_500_ms` → `< 500 ms`. Voice pause buckets stay in MILLISECONDS
 * (typing's equivalent renders seconds): the voice pause threshold is 500 ms
 * and the interesting buckets sit under two seconds, where `0.5 s` reads
 * worse than `500 ms`. Same key convention, different unit on purpose.
 */
export function voicePauseBucketLabel(key: string): string {
  const lt = /^lt_(\d+)_ms$/.exec(key);
  if (lt) return `< ${lt[1]} ms`;
  const gte = /^gte_(\d+)_ms$/.exec(key);
  if (gte) return `≥ ${gte[1]} ms`;
  const range = /^(\d+)_to_(\d+)_ms$/.exec(key);
  if (range) return `${range[1]}–${range[2]} ms`;
  return key;
}
