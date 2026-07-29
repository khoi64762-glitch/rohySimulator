/*
 * Hand-written declarations for voiceChartMath.js (same pattern as
 * typingChartMath.d.ts). The JSDoc in the .js file is authoritative.
 */

/**
 * One compact per-frame sample of the voice test's recorded series — the
 * `frame_series` rows the voice test hook persists alongside each
 * `voice-v1` window (app-level additive field, not part of the library
 * profile). `f0` is `null` on an unvoiced frame (never 0); `p` is `null`
 * when no VAD ran on the frame.
 */
export interface VoiceFrameSample {
  /** Monotonic ms of the frame (the controller's clock). */
  t: number;
  /** Per-frame RMS, nominally in [0, 1]. */
  rms: number;
  /** VAD speech probability, or null when no VAD ran. */
  p: number | null;
  /** Estimated F0 in Hz, or null on an unvoiced frame. */
  f0: number | null;
  /** NSDF pitch confidence in [0, 1]. */
  conf: number;
  voiced: boolean;
  clipped: boolean;
  /** Frame fell inside a host AI-playback interval (excluded from speech measurement). */
  playback: boolean;
  muted: boolean;
}

export type StripSegmentKind = 'speech' | 'silence' | 'pause' | 'playback' | 'muted';

export interface StripSegment {
  kind: StripSegmentKind;
  /** Frame-time bounds: index × frameMs — the aggregator's own accounting. */
  startMs: number;
  endMs: number;
}

export declare function speechStripSegments(
  frames: VoiceFrameSample[] | null | undefined,
  options?: { frameMs?: number; vadThreshold?: number; pauseThresholdMs?: number },
): { segments: StripSegment[]; totalMs: number };

export declare function clippedRuns(
  frames: VoiceFrameSample[] | null | undefined,
  options?: { frameMs?: number },
): Array<{ startMs: number; endMs: number }>;

export interface PitchPoint {
  t: number;
  f0: number;
  confidence: number;
}

export interface PitchContourPoint extends PitchPoint {
  playback: boolean;
  muted: boolean;
}

export declare function pitchSegments(
  frames: VoiceFrameSample[] | null | undefined,
  options?: { maxJoinGapMs?: number },
): PitchContourPoint[][];

export declare function keptPitchPoints(
  frames: VoiceFrameSample[] | null | undefined,
  options?: { minConfidence?: number },
): PitchPoint[];

export declare function pitchTrend(
  points: Array<{ t: number; f0: number }> | null | undefined,
): { n: number; median: number; slope: number | null; meanT: number; meanF0: number } | null;

export declare function quantileSorted(sorted: number[], p: number): number;

export interface PitchHistogram {
  bins: Array<{ lo: number; hi: number; count: number }>;
  binHz: number;
  n: number;
  min: number;
  max: number;
  /** Quartiles from the same `quantileSorted` the aggregator uses: q3 - q1 === pitch_iqr_hz. */
  q1: number;
  median: number;
  q3: number;
}

export declare function pitchHistogram(
  points: Array<{ f0: number }> | null | undefined,
  options?: { minBinHz?: number; maxBins?: number },
): PitchHistogram | null;

export interface LoudnessPoint {
  t: number;
  rms: number;
  /** Entered the aggregator's speech-scoped rms_mean. */
  speech: boolean;
  /** Playback or muted — outside every learner measurement. */
  excluded: boolean;
  clipped: boolean;
}

export interface LoudnessEnvelope {
  points: LoudnessPoint[];
  /** Reproduces the window's `rms_mean` (speech-scoped, finite-rms frames only). */
  speechMean: number | null;
  peak: number | null;
  nearSilenceRms: number;
  speechFrames: number;
  measuredFrames: number;
}

export declare function loudnessEnvelope(
  frames: VoiceFrameSample[] | null | undefined,
  options?: { vadThreshold?: number; nearSilenceRms?: number },
): LoudnessEnvelope;

export interface TurnTimeComposition {
  parts: Array<{ key: string; label: string; ms: number }>;
  /** Wall-clock `turn_duration_ms`. */
  totalMs: number;
  /** Sum of the parts (frame-time accounting) — need not equal totalMs. */
  accountedMs: number;
  unaccountedMs: number;
  overrunMs: number;
}

export declare function turnTimeComposition(
  voice: { turn_duration_ms?: number } | null | undefined,
): TurnTimeComposition | null;

export interface TurnMetricPoint {
  index: number;
  /** `null` = not measured for this turn — a GAP, never a zero. */
  value: number | null;
  /** The turn carried `insufficient_data`. */
  flagged: boolean;
}

export interface TurnMetricSeries {
  points: TurnMetricPoint[];
  n: number;
  measured: number;
  min: number | null;
  max: number | null;
}

export declare function turnMetricSeries<V, T extends { voice: V }>(
  turns: T[] | null | undefined,
  pick: (voice: V, turn: T) => number | null | undefined,
): TurnMetricSeries;

export declare function measuredRuns(
  points: TurnMetricPoint[] | null | undefined,
): Array<Array<{ index: number; value: number }>>;
