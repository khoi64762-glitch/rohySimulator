import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * /analyze/voice surface contracts.
 *
 * The behavioural math behind these charts is tested against the real
 * VoiceTurnAggregator in app-voice-charts.test.js. THIS file pins the things
 * that fail silently instead: a chart that stops being mounted, a duplicated
 * helper drifting from its source, a null contract quietly becoming a zero.
 * Every assertion here corresponds to a regression that would leave the page
 * rendering fine while saying less (or something else) than it claims.
 *
 *   1. Both SCOPES exist and stay separated. The page reads session-first
 *      (pooled figures, across-turn trends, per-turn composition) and then
 *      turn-scoped (structure, pitch, detail). The across-turn view is the
 *      only place a session reads as a trajectory; losing it is the exact
 *      regression that made this page a pile of numbers.
 *   2. Every chart is actually mounted. A chart component can exist, be
 *      typechecked, be tested — and never be rendered.
 *   3. Pooling lives in lib/voiceAnalytics.ts (testable without React), and
 *      keeps its null contract: a rate with a zero denominator is null, not
 *      0. This is the aggregator's convention and the page must not undo it.
 *   4. No duplicated bucket-label helper. VoiceStatsPanel used to carry its
 *      own copy; a second hand-maintained copy of a formatting rule is the
 *      defect species the settings-nav test exists to prevent.
 *   5. Histograms render as BARS, not as a grid of metric tiles. Same data
 *      shape as the typing page's pause histogram, same treatment.
 *   6. The Live voice test modal charts the turn it just recorded, using the
 *      per-frame series the hook already keeps for that purpose.
 */

const view = readFileSync('standalone/app/src/routes/analyze/voice.tsx', 'utf8');
const analytics = readFileSync('standalone/app/src/lib/voiceAnalytics.ts', 'utf8');
const panel = readFileSync('standalone/app/src/components/voice/VoiceStatsPanel.tsx', 'utf8');
const modal = readFileSync('standalone/app/src/components/voice/VoiceTestModal.tsx', 'utf8');

// ---- 1. Both scopes, in reading order ----
const sectionIds = [...view.matchAll(/id="(voice-[a-z-]+)"/g)].map((m) => m[1]);
for (const id of ['voice-overview', 'voice-trends', 'voice-pausing', 'voice-turns', 'voice-structure', 'voice-pitch', 'voice-detail']) {
  assert.ok(sectionIds.includes(id), `/analyze/voice must keep the #${id} section`);
}
assert.ok(
  sectionIds.indexOf('voice-trends') < sectionIds.indexOf('voice-structure'),
  'the session-scoped view must come before the turn-scoped views',
);
assert.ok(
  sectionIds.indexOf('voice-turns') < sectionIds.indexOf('voice-structure'),
  'the turn table must precede the per-turn charts it drives',
);

// ---- 2. Every chart is mounted ----
for (const chart of [
  'VoiceTurnTrends',
  'VoiceTurnComposition',
  'VoiceSpeechStrip',
  'VoiceLoudnessEnvelope',
  'VoicePitchContour',
  'VoicePitchDistribution',
  'StateDistributionBars',
]) {
  assert.match(view, new RegExp(`import \\{ ${chart} \\}`), `voice.tsx must import ${chart}`);
  assert.match(view, new RegExp(`<${chart}\\b`), `voice.tsx must actually render ${chart}`);
}

// The session-scoped charts are the way INTO a turn: both must be able to
// change the selection, or the trajectory view is a dead end.
assert.match(
  view,
  /<VoiceTurnTrends[\s\S]{0,220}onSelectIndex=\{selectByIndex\}/,
  'clicking a trend point must select that turn',
);
assert.match(
  view,
  /<VoiceTurnComposition[\s\S]{0,220}onSelectIndex=\{selectByIndex\}/,
  'clicking a composition bar must select that turn',
);

// ---- 3. Pooling module + null discipline ----
assert.match(
  view,
  /aggregateVoiceTurns/,
  'the route must pool through lib/voiceAnalytics.ts, not an inline reduce',
);
assert.doesNotMatch(
  view,
  /totalSpeechMs\s*\/\s*totalTurnMs/,
  'pooling arithmetic must not be re-inlined in the route',
);

// Every rate must be null-guarded on its denominator. A `?:` returning 0
// here would turn "not measured" into a confident zero.
for (const [field, guard] of [
  ['pooledSpeechRatio', 'totalTurnMs > 0'],
  ['pauseRatePerMin', 'totalTurnMs > 0'],
  ['meanPauseMs', 'pauseCount > 0'],
  ['pauseShare', 'totalTurnMs > 0'],
]) {
  assert.match(
    analytics,
    new RegExp(`${field}:\\s*${guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\?[^:]+:\\s*null`),
    `${field} must be null (not 0) when its denominator is zero`,
  );
}
assert.match(
  analytics,
  /pitchLo:\s*medians\.length > 0 \? Math\.min\(\.\.\.medians\) : null/,
  'the pitch range must be null when no turn reached the voiced-frame floor',
);

// Flagged turns stay IN the pooled totals — excluding them would silently
// redefine what the session summary describes.
assert.doesNotMatch(
  analytics,
  /if\s*\(\s*voice\.insufficient_data\s*\)\s*continue/,
  'insufficient turns must be pooled and counted, never skipped',
);

// ---- 4. No duplicated bucket-label helper ----
assert.match(analytics, /export function voicePauseBucketLabel/);
assert.match(panel, /voicePauseBucketLabel/, 'the panel must import the shared label helper');
assert.doesNotMatch(
  panel,
  /function pauseBucketLabel/,
  'VoiceStatsPanel must not keep its own copy of the bucket-label rule',
);

// ---- 5. Histograms are bars ----
assert.match(
  panel,
  /<StateDistributionBars/,
  'the internal-pause histogram must render as bars, not a grid of metric tiles',
);
assert.match(
  view,
  /<StateDistributionBars[\s\S]{0,120}order="given"/,
  'histogram bars must keep source order — sorting by count scrambles the axis',
);

// The capture-conditions block is reference material, not analysis: it folds
// away so the panel leads with measurement rather than device settings.
assert.match(panel, /<details/, 'capture conditions must fold away');
assert.match(panel, /Measurement coverage/, 'coverage stays a first-class card');

// ---- 6. The Live modal charts what it just recorded ----
assert.match(modal, /<VoiceSpeechStrip/, 'the voice test modal must chart the recorded turn');
assert.match(modal, /<VoiceLoudnessEnvelope/, 'the voice test modal must chart the recorded level');
assert.match(
  modal,
  /test\.framesRef\.current/,
  'the modal must use the per-frame series the hook keeps for exactly this',
);

console.log('app-analyze-voice.test.js — all cases passed');
