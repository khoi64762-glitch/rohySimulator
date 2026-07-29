import assert from 'node:assert/strict';

/*
 * app-voice-charts — the pure derivation functions behind the voice charts
 * on /analyze/voice (standalone/app/src/lib/voiceChartMath.js):
 *
 *   1. speechStripSegments — per-frame classification (playback > muted >
 *      speech/silence), run merging, and the internal-pause relabel rule
 *      (>= pauseThresholdMs, bounded by speech on both sides; initial and
 *      trailing silence never become pauses).
 *   2. clippedRuns — contiguous clipped stretches in frame time.
 *   3. pitchSegments — unvoiced frames are GAPS: no polyline segment ever
 *      spans an unvoiced frame or a dropped-frame time jump; single voiced
 *      frames stay isolated points.
 *   4. keptPitchPoints / pitchTrend — must reproduce the REAL
 *      VoiceTurnAggregator's pitch_median_hz and pitch_slope_hz_per_s
 *      (same confidence gate, same R type-7 median, same OLS-per-second),
 *      asserted on scripted turns AND on 150 seeded random turns run
 *      through the real aggregator, which also pins the strip's speech /
 *      pause accounting to the window's own figures.
 *   5. pitchHistogram — the distribution behind the two pitch numbers; its
 *      quartiles must reproduce pitch_median_hz and pitch_iqr_hz exactly,
 *      and its bins must partition the kept points (every point in exactly
 *      one bin, counts summing to n).
 *   6. loudnessEnvelope — its speech-scoped mean must reproduce the
 *      aggregator's rms_mean, applying the same three gates (not playback,
 *      not muted, VAD speech) and the same absent-measurement rule (a
 *      non-finite rms is omitted, NEVER coerced to 0).
 *   7. turnTimeComposition — the residual between frame-time parts and
 *      wall-clock duration is REPORTED, never hidden by normalisation.
 *   8. turnMetricSeries / measuredRuns — an unmeasured turn stays a gap and
 *      breaks the polyline; it is never dropped (which would close the gap
 *      and draw a trend through an absence).
 */

import {
  speechStripSegments,
  clippedRuns,
  pitchSegments,
  keptPitchPoints,
  pitchTrend,
  quantileSorted,
  pitchHistogram,
  loudnessEnvelope,
  turnTimeComposition,
  turnMetricSeries,
  measuredRuns,
} from '../standalone/app/src/lib/voiceChartMath.js';
import { VoiceTurnAggregator } from '../src/aggregation/VoiceTurnAggregator.js';

const FRAME_MS = 32;

/** Build one compact chart-math frame sample (the app's frame_series shape). */
function frame({ i = 0, p = 0.1, f0 = null, conf = 0, voiced = false, clipped = false, playback = false, muted = false, rms = 0.05, t = null }) {
  return { t: t ?? 1000 + i * FRAME_MS, rms, p, f0, conf, voiced, clipped, playback, muted };
}

/** Expand [probability, count] pairs into frame samples. */
function script(pairs, overrides = {}) {
  const frames = [];
  for (const [p, count, extra = {}] of pairs) {
    for (let k = 0; k < count; k += 1) {
      frames.push(frame({ i: frames.length, p, ...overrides, ...extra }));
    }
  }
  return frames;
}

// ---- 1. speechStripSegments ----
{
  // 10 silence, 20 speech, 20 silence (640ms >= 500 → internal pause),
  // 15 speech, 10 trailing silence.
  const frames = script([[0.1, 10], [0.9, 20], [0.1, 20], [0.9, 15], [0.1, 10]]);
  const { segments, totalMs } = speechStripSegments(frames, {
    frameMs: FRAME_MS, vadThreshold: 0.5, pauseThresholdMs: 500,
  });
  assert.equal(totalMs, 75 * FRAME_MS);
  assert.deepEqual(
    segments.map((s) => [s.kind, s.endMs - s.startMs]),
    [
      ['silence', 10 * FRAME_MS], // initial silence is never a pause
      ['speech', 20 * FRAME_MS],
      ['pause', 20 * FRAME_MS],   // internal >= 500ms → pause
      ['speech', 15 * FRAME_MS],
      ['silence', 10 * FRAME_MS], // trailing silence is never a pause
    ],
  );
  // Contiguity: segments tile [0, totalMs] exactly.
  let cursor = 0;
  for (const s of segments) {
    assert.equal(s.startMs, cursor, 'segments tile without gaps');
    cursor = s.endMs;
  }
  assert.equal(cursor, totalMs);
}

{
  // A short internal silence run stays 'silence' (below the threshold).
  const frames = script([[0.9, 10], [0.1, 10], [0.9, 10]]); // 320ms < 500
  const { segments } = speechStripSegments(frames, { frameMs: FRAME_MS, pauseThresholdMs: 500 });
  assert.deepEqual(segments.map((s) => s.kind), ['speech', 'silence', 'speech']);
}

{
  // Precedence: playback beats a speech-like probability; muted beats it too;
  // a null probability is NOT speech (no VAD, no claim).
  const frames = [
    frame({ i: 0, p: 0.9, playback: true }),
    frame({ i: 1, p: 0.9, muted: true }),
    frame({ i: 2, p: null }),
    frame({ i: 3, p: 0.9 }),
  ];
  const { segments } = speechStripSegments(frames, { frameMs: FRAME_MS });
  assert.deepEqual(segments.map((s) => s.kind), ['playback', 'muted', 'silence', 'speech']);
}

{
  // Degenerate inputs.
  assert.deepEqual(speechStripSegments([], {}), { segments: [], totalMs: 0 });
  assert.deepEqual(speechStripSegments(null, {}), { segments: [], totalMs: 0 });
}

// ---- 2. clippedRuns ----
{
  const frames = [
    frame({ i: 0 }),
    frame({ i: 1, clipped: true }),
    frame({ i: 2, clipped: true }),
    frame({ i: 3 }),
    frame({ i: 4, clipped: true }),
  ];
  assert.deepEqual(clippedRuns(frames, { frameMs: FRAME_MS }), [
    { startMs: 1 * FRAME_MS, endMs: 3 * FRAME_MS },
    { startMs: 4 * FRAME_MS, endMs: 5 * FRAME_MS },
  ]);
  assert.deepEqual(clippedRuns([], {}), []);
}

// ---- 3. pitchSegments: gaps are gaps ----
{
  const frames = [
    frame({ i: 0, voiced: true, f0: 120, conf: 0.9 }),
    frame({ i: 1, voiced: true, f0: 122, conf: 0.9 }),
    frame({ i: 2 }), // unvoiced → break
    frame({ i: 3, voiced: true, f0: 130, conf: 0.9 }), // isolated point
    frame({ i: 4 }),
    frame({ i: 5, voiced: true, f0: 140, conf: 0.9 }),
    frame({ i: 6, voiced: true, f0: 141, conf: 0.9 }),
  ];
  const segments = pitchSegments(frames, { maxJoinGapMs: 100 });
  assert.equal(segments.length, 3, 'two unvoiced frames → three voiced stretches');
  assert.deepEqual(segments.map((s) => s.length), [2, 1, 2]);
  assert.deepEqual(segments[0].map((p) => p.f0), [120, 122]);
  assert.deepEqual(segments[1].map((p) => p.f0), [130]);
}

{
  // A dropped-frame time jump breaks a segment even with voicing on both sides.
  const frames = [
    frame({ i: 0, voiced: true, f0: 120, conf: 0.9, t: 1000 }),
    frame({ i: 1, voiced: true, f0: 121, conf: 0.9, t: 1032 }),
    frame({ i: 2, voiced: true, f0: 122, conf: 0.9, t: 1500 }), // 468ms jump
  ];
  const segments = pitchSegments(frames, { maxJoinGapMs: 100 });
  assert.deepEqual(segments.map((s) => s.length), [2, 1], 'time jump is never bridged');
}

// ---- 4. keptPitchPoints: the aggregator's exact gates ----
{
  const frames = [
    frame({ i: 0, voiced: true, f0: 120, conf: 0.9 }),
    frame({ i: 1, voiced: true, f0: 125, conf: 0.5 }),           // below confidence gate
    frame({ i: 2, voiced: true, f0: 130, conf: 0.9, playback: true }), // playback excluded
    frame({ i: 3, voiced: true, f0: 135, conf: 0.9, muted: true }),    // muted excluded
    frame({ i: 4, voiced: false, f0: null, conf: 0 }),           // unvoiced
    frame({ i: 5, voiced: true, f0: 140, conf: 0.6 }),           // exactly at gate → kept
  ];
  const kept = keptPitchPoints(frames, { minConfidence: 0.6 });
  assert.deepEqual(kept.map((p) => p.f0), [120, 140]);
}

// ---- quantileSorted (R type-7) ----
{
  assert.equal(quantileSorted([10], 0.5), 10);
  assert.equal(quantileSorted([10, 20], 0.5), 15);
  assert.equal(quantileSorted([10, 20, 30], 0.5), 20);
  assert.equal(quantileSorted([10, 20, 30, 40], 0.25), 17.5);
}

// ---- pitchTrend degenerate cases ----
{
  assert.equal(pitchTrend([]), null);
  assert.equal(pitchTrend(null), null);
  const single = pitchTrend([{ t: 1000, f0: 120 }]);
  assert.equal(single.n, 1);
  assert.equal(single.median, 120);
  assert.equal(single.slope, null, 'one observation has no trend');
}

// ---- 5. Agreement with the REAL VoiceTurnAggregator ----

/**
 * Feed one scripted turn through the real aggregator AND the chart math.
 * `spec` frames: { p, f0, conf, voiced, clipped, playback, muted }.
 */
function runBoth(spec, { frameMs = FRAME_MS, vadThreshold = 0.5, pauseThresholdMs = 500 } = {}) {
  const aggregator = new VoiceTurnAggregator({ frameMs, vadThreshold, pauseThresholdMs });
  aggregator.start({ timestamp: 1000 });
  const frames = [];
  spec.forEach((f, i) => {
    const t = 1000 + i * frameMs;
    const features = {
      rms: f.rms ?? 0.05,
      peak: (f.rms ?? 0.05) * 2,
      clippedSamples: f.clipped ? 3 : 0,
      zeroCrossingRate: 0.1,
      centroidHz: 900,
      rolloffHz: 2500,
      f0Hz: f.voiced ? f.f0 : null,
      f0Confidence: f.conf ?? 0,
      voiced: f.voiced === true,
    };
    aggregator.recordFrame(features, {
      timestamp: t,
      speechProbability: f.p ?? null,
      inPlayback: f.playback === true,
      muted: f.muted === true,
    });
    frames.push({
      t,
      rms: features.rms,
      p: f.p ?? null,
      f0: features.f0Hz,
      conf: features.f0Confidence,
      voiced: features.voiced,
      clipped: f.clipped === true,
      playback: f.playback === true,
      muted: f.muted === true,
    });
  });
  const window = aggregator.finalize({ timestamp: 1000 + spec.length * frameMs });
  return { window, frames };
}

{
  // Scripted turn: silence, speech (voiced, rising pitch), pause, speech, tail.
  const spec = [];
  for (let i = 0; i < 8; i += 1) spec.push({ p: 0.1 });
  for (let i = 0; i < 30; i += 1) spec.push({ p: 0.9, voiced: true, f0: 118 + i, conf: 0.9 });
  for (let i = 0; i < 25; i += 1) spec.push({ p: 0.1 }); // 800ms internal pause
  for (let i = 0; i < 20; i += 1) spec.push({ p: 0.9, voiced: true, f0: 150 + i, conf: 0.85 });
  for (let i = 0; i < 6; i += 1) spec.push({ p: 0.1 });

  const { window, frames } = runBoth(spec);
  const voice = window.voice;

  const { segments } = speechStripSegments(frames, {
    frameMs: FRAME_MS, vadThreshold: 0.5, pauseThresholdMs: 500,
  });
  const stripSpeechMs = segments
    .filter((s) => s.kind === 'speech')
    .reduce((total, s) => total + (s.endMs - s.startMs), 0);
  const stripPauses = segments.filter((s) => s.kind === 'pause');

  assert.equal(stripSpeechMs, voice.speech_duration_ms, 'strip speech time = window speech time');
  assert.equal(
    segments.filter((s) => s.kind === 'speech').length,
    voice.speech_segment_count,
    'strip speech segments = window segment count',
  );
  assert.equal(stripPauses.length, voice.internal_pause_count, 'strip pauses = window pause count');
  assert.equal(
    stripPauses.reduce((total, s) => total + (s.endMs - s.startMs), 0),
    voice.internal_pause_total_ms,
    'strip pause time = window pause total',
  );

  // Pitch overlays must be drawn from the window's own statistics.
  const kept = keptPitchPoints(frames, { minConfidence: 0.6 });
  const trend = pitchTrend(kept);
  assert.ok(Math.abs(trend.median - voice.pitch_median_hz) < 1e-9, 'median matches aggregator');
  assert.ok(Math.abs(trend.slope - voice.pitch_slope_hz_per_s) < 1e-9, 'OLS slope matches aggregator');
  assert.equal(kept.length >= 5, voice.pitch_median_hz != null, 'floor agreement');
}

{
  // 150 seeded random turns: strip + pitch agreement against the aggregator.
  // (No playback/muted here — the strip's structural labels are only
  // guaranteed to match the aggregator's structural timeline when nothing
  // is excluded from it; the playback caveat is documented in the module.)
  let seed = 424243;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  for (let turn = 0; turn < 150; turn += 1) {
    const spec = [];
    const blocks = 2 + Math.floor(rand() * 6);
    for (let b = 0; b < blocks; b += 1) {
      const speech = rand() < 0.5;
      const count = 1 + Math.floor(rand() * 30);
      for (let k = 0; k < count; k += 1) {
        if (speech) {
          const voiced = rand() < 0.7;
          spec.push({
            p: 0.6 + rand() * 0.4,
            voiced,
            f0: voiced ? 90 + rand() * 160 : null,
            conf: voiced ? rand() : 0,
            clipped: rand() < 0.03,
          });
        } else {
          spec.push({ p: rand() * 0.4, clipped: rand() < 0.01 });
        }
      }
    }
    const { window, frames } = runBoth(spec);
    const voice = window.voice;
    const { segments } = speechStripSegments(frames, {
      frameMs: FRAME_MS, vadThreshold: 0.5, pauseThresholdMs: 500,
    });

    const stripSpeechMs = segments
      .filter((s) => s.kind === 'speech')
      .reduce((total, s) => total + (s.endMs - s.startMs), 0);
    assert.equal(stripSpeechMs, voice.speech_duration_ms, `turn ${turn}: speech time diverges`);
    assert.equal(
      segments.filter((s) => s.kind === 'speech').length,
      voice.speech_segment_count,
      `turn ${turn}: segment count diverges`,
    );
    assert.equal(
      segments.filter((s) => s.kind === 'pause').length,
      voice.internal_pause_count,
      `turn ${turn}: pause count diverges`,
    );

    const kept = keptPitchPoints(frames, { minConfidence: 0.6 });
    if (voice.pitch_median_hz != null) {
      const trend = pitchTrend(kept);
      assert.ok(Math.abs(trend.median - voice.pitch_median_hz) < 1e-9, `turn ${turn}: median diverges`);
      assert.ok(Math.abs(trend.slope - voice.pitch_slope_hz_per_s) < 1e-9, `turn ${turn}: slope diverges`);
    } else {
      assert.ok(kept.length < 5, `turn ${turn}: window nulled pitch but chart kept ${kept.length} points`);
    }
  }
}

// ---- 6. pitchHistogram ----
{
  assert.equal(pitchHistogram([]), null, 'no points, no distribution');
  assert.equal(pitchHistogram(null), null);

  // Bins must PARTITION the points: every point in exactly one bin.
  const points = Array.from({ length: 200 }, (_, i) => ({ f0: 100 + (i % 60) }));
  const histogram = pitchHistogram(points);
  assert.equal(
    histogram.bins.reduce((total, bin) => total + bin.count, 0),
    histogram.n,
    'bin counts must sum to the point count — no point dropped or double-counted',
  );
  assert.equal(histogram.n, 200);
  assert.ok(histogram.bins[0].lo <= histogram.min);
  assert.ok(histogram.bins[histogram.bins.length - 1].hi >= histogram.max);
  for (let i = 1; i < histogram.bins.length; i += 1) {
    assert.ok(
      Math.abs(histogram.bins[i].lo - histogram.bins[i - 1].hi) < 1e-9,
      'bins must tile without gaps or overlap',
    );
  }

  // A degenerate (single-value) turn must not divide by a zero bin width.
  const spike = pitchHistogram(Array.from({ length: 30 }, () => ({ f0: 141 })));
  assert.equal(spike.n, 30);
  assert.ok(spike.binHz > 0, 'a zero-IQR turn still needs a positive bin width');
  assert.equal(spike.median, 141);
  assert.equal(spike.q3 - spike.q1, 0);
  assert.equal(spike.bins.reduce((total, bin) => total + bin.count, 0), 30);

  // Non-finite f0s are excluded rather than binned somewhere arbitrary.
  const dirty = pitchHistogram([{ f0: 100 }, { f0: NaN }, { f0: 120 }, { f0: null }]);
  assert.equal(dirty.n, 2);
}

// ---- 7. loudnessEnvelope ----
{
  // Absent measurements are OMITTED, never zeroed: a frame with no finite
  // rms must not appear as a bar at 0 and must not enter the mean.
  const frames = [
    frame({ i: 0, p: 0.9, rms: 0.2 }),
    frame({ i: 1, p: 0.9, rms: Number.NaN }),
    frame({ i: 2, p: 0.9, rms: 0.4 }),
    frame({ i: 3, p: 0.1, rms: 0.9 }),  // silence: context, not in the mean
    frame({ i: 4, p: 0.9, rms: 0.9, playback: true }), // excluded
    frame({ i: 5, p: 0.9, rms: 0.9, muted: true }),    // excluded
  ];
  const envelope = loudnessEnvelope(frames, { vadThreshold: 0.5 });
  assert.equal(envelope.measuredFrames, 5, 'the NaN-rms frame is omitted entirely');
  assert.equal(envelope.speechFrames, 2, 'only unexcluded VAD-speech frames enter the mean');
  assert.ok(Math.abs(envelope.speechMean - 0.3) < 1e-12);
  assert.ok(Math.abs(envelope.peak - 0.4) < 1e-12, 'peak is over the same speech frames');
  assert.equal(envelope.points.filter((p) => p.excluded).length, 2);
  assert.equal(envelope.points.filter((p) => p.speech).length, 2);

  // Nothing measurable → null, not 0. A silent turn is not a turn at 0 RMS.
  const silent = loudnessEnvelope([frame({ i: 0, p: 0.1, rms: 0.01 })]);
  assert.equal(silent.speechMean, null);
  assert.equal(silent.peak, null);
  assert.deepEqual(loudnessEnvelope(null).points, []);
}

// ---- 8. turnTimeComposition ----
{
  assert.equal(turnTimeComposition(null), null);
  assert.equal(turnTimeComposition({ turn_duration_ms: 0 }), null, 'no duration, nothing to compose');

  const composition = turnTimeComposition({
    turn_duration_ms: 10000,
    initial_silence_ms: 1000,
    speech_duration_ms: 6000,
    internal_pause_total_ms: 1500,
    trailing_silence_ms: 500,
    excluded_playback_ms: 0,
    muted_ms: 0,
  });
  assert.deepEqual(composition.parts.map((p) => p.key), [
    'initial_silence', 'speech', 'pause', 'trailing_silence',
  ], 'zero-length parts are dropped, order is fixed');
  assert.equal(composition.accountedMs, 9000);
  assert.equal(composition.unaccountedMs, 1000, 'the residual is reported, not normalised away');
  assert.equal(composition.overrunMs, 0);

  // Frame time overrunning wall clock is surfaced, not clamped into a
  // silently-shrunk bar.
  const over = turnTimeComposition({
    turn_duration_ms: 1000,
    initial_silence_ms: 0,
    speech_duration_ms: 1400,
    internal_pause_total_ms: 0,
    trailing_silence_ms: 0,
    excluded_playback_ms: 0,
    muted_ms: 0,
  });
  assert.equal(over.unaccountedMs, 0);
  assert.equal(over.overrunMs, 400);
}

// ---- 9. turnMetricSeries / measuredRuns ----
{
  const turns = [
    { voice: { pitch_median_hz: 120, insufficient_data: false } },
    { voice: { pitch_median_hz: null, insufficient_data: true } },
    { voice: { pitch_median_hz: 140, insufficient_data: false } },
    { voice: { pitch_median_hz: 150, insufficient_data: true } },
  ];
  const series = turnMetricSeries(turns, (voice) => voice.pitch_median_hz);
  assert.equal(series.n, 4, 'every turn keeps a slot — unmeasured turns are not dropped');
  assert.equal(series.measured, 3);
  assert.equal(series.points[1].value, null, 'an unmeasured turn is null, never 0');
  assert.deepEqual(series.points.map((p) => p.flagged), [false, true, false, true]);
  assert.equal(series.min, 120);
  assert.equal(series.max, 150);

  // The polyline must BREAK at the gap rather than bridging turns 0 → 2.
  const runs = measuredRuns(series.points);
  assert.deepEqual(
    runs.map((run) => run.map((point) => point.index)),
    [[0], [2, 3]],
    'a run never spans an unmeasured turn',
  );

  // Non-finite values are treated as absent, not plotted at their raw value.
  const dirty = turnMetricSeries(
    [{ voice: { x: Number.NaN } }, { voice: { x: Infinity } }, { voice: { x: 3 } }],
    (voice) => voice.x,
  );
  assert.equal(dirty.measured, 1);
  assert.equal(dirty.min, 3);

  assert.deepEqual(turnMetricSeries(null, () => 1).points, []);
  assert.deepEqual(measuredRuns(null), []);
}

// ---- 10. New derivations vs the REAL aggregator (seeded turns) ----
{
  let seed = 991117;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };

  for (let turn = 0; turn < 120; turn += 1) {
    const spec = [];
    const blocks = 2 + Math.floor(rand() * 6);
    for (let b = 0; b < blocks; b += 1) {
      const speech = rand() < 0.55;
      const count = 1 + Math.floor(rand() * 25);
      for (let k = 0; k < count; k += 1) {
        if (speech) {
          const voiced = rand() < 0.75;
          spec.push({
            p: 0.6 + rand() * 0.4,
            voiced,
            f0: voiced ? 90 + rand() * 160 : null,
            conf: voiced ? rand() : 0,
            clipped: rand() < 0.03,
            rms: 0.02 + rand() * 0.5,
          });
        } else {
          spec.push({ p: rand() * 0.4, rms: rand() * 0.02 });
        }
      }
    }
    const { window, frames } = runBoth(spec);
    const voice = window.voice;

    // rms_mean is speech-scoped in the aggregator; the envelope must apply
    // exactly the same scoping or its reference line lies about the bars.
    const envelope = loudnessEnvelope(frames, { vadThreshold: 0.5 });
    if (voice.rms_mean == null) {
      assert.equal(envelope.speechMean, null, `turn ${turn}: chart invented a mean the window nulled`);
    } else {
      assert.ok(
        Math.abs(envelope.speechMean - voice.rms_mean) < 1e-9,
        `turn ${turn}: speech mean diverges (${envelope.speechMean} vs ${voice.rms_mean})`,
      );
    }

    // The histogram's quartiles ARE the window's pitch statistics.
    const kept = keptPitchPoints(frames, { minConfidence: 0.6 });
    const histogram = pitchHistogram(kept);
    if (voice.pitch_median_hz != null) {
      assert.ok(histogram, `turn ${turn}: window reported pitch but chart found no distribution`);
      assert.ok(
        Math.abs(histogram.median - voice.pitch_median_hz) < 1e-9,
        `turn ${turn}: histogram median diverges`,
      );
      assert.ok(
        Math.abs(histogram.q3 - histogram.q1 - voice.pitch_iqr_hz) < 1e-9,
        `turn ${turn}: histogram IQR diverges from pitch_iqr_hz`,
      );
      assert.equal(
        histogram.bins.reduce((total, bin) => total + bin.count, 0),
        histogram.n,
        `turn ${turn}: bins do not partition the kept points`,
      );
    }

    // Composition parts never exceed what the window reports, and the
    // residual accounting stays internally consistent.
    const composition = turnTimeComposition(voice);
    if (composition) {
      assert.ok(composition.unaccountedMs >= 0 && composition.overrunMs >= 0);
      assert.ok(
        composition.unaccountedMs === 0 || composition.overrunMs === 0,
        `turn ${turn}: a turn cannot both under- and over-run its wall clock`,
      );
      assert.equal(
        composition.accountedMs - composition.totalMs,
        composition.overrunMs - composition.unaccountedMs,
        `turn ${turn}: residual accounting is inconsistent`,
      );
    }
  }
}

console.log('app-voice-charts.test.js — all cases passed');
