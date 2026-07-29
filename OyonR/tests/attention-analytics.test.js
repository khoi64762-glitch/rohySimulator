import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAttentionAnalytics } from '../standalone/app/src/lib/attentionAnalytics.js';
import { generateDemoFixture } from '../standalone/app/src/legacy/demoFixture.js';

function windowAt(index, focus, offScreen, fixations, brpm) {
  const end = new Date(Date.UTC(2026, 0, 1, 0, 0, index + 1)).toISOString();
  const start = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    window_start: start,
    window_end: end,
    duration_ms: 1_000,
    missing_face_ratio: 0.05,
    engagement: { focus_score: focus },
    gaze: {
      valid_frame_ratio: 0.9,
      off_screen_ratio: offScreen,
      fixation_count: fixations,
      fixation_duration_ms_median: 280,
      scanpath_length: 0.5,
      aoi_dwell_ms: { text: 600, chart: 300 },
      aoi_transition_count: 1,
      aoi_transitions: { 'text->chart': 1 },
    },
    respiration: {
      brpm_mean: brpm,
      confidence_mean: 0.8,
      rgb_corroboration_agreement_ratio: 0.9,
    },
  };
}

const chronological = [
  windowAt(0, 0.72, 0.05, 2, 12),
  windowAt(1, 0.35, 0.55, 1, 13),
  windowAt(2, 0.70, 0.10, 2, 14),
  windowAt(3, 0.45, 0.08, 3, 15),
  windowAt(4, 0.58, 0.10, 1, 16),
  windowAt(5, 0.82, 0.05, 3, 17),
];

const result = buildAttentionAnalytics([...chronological].reverse());

assert.equal(result.windows[0].window_end, chronological[0].window_end, 'windows must be sorted before episode analysis');
assert.deepEqual(result.states, ['focused', 'away', 'focused', 'shifting', 'available', 'focused']);
assert.equal(result.stateCounts.focused, 3);
assert.equal(result.focusedRuns, 3);
assert.equal(result.recoveries, 1, 'direct away-to-focused recovery must be retained');
assert.equal(result.longestFocusedRunMs, 1_000);
assert.equal(result.totalFixations, 12);
assert.equal(result.totalTransitions, 6);
assert.deepEqual(result.topAoiTransitions[0], { label: 'text->chart', value: 6 });
assert.deepEqual(result.topAoiDwell[0], { label: 'text', value: 3_600 });
assert.equal(result.respiration.overlapWindows, 6);
assert.ok(result.respiration.focusCorrelation > 0, 'paired focus/respiration association should preserve direction');

const noSignal = buildAttentionAnalytics([{ window_end: '2026-01-01T00:00:01.000Z' }]);
assert.deepEqual(noSignal.states, ['unmeasured']);
assert.equal(noSignal.meanFocus, null);
assert.equal(noSignal.respiration.focusCorrelation, null);

const legacyRoute = readFileSync('standalone/app/src/routes/analyze/engagement.tsx', 'utf8');
const route = readFileSync('standalone/app/src/routes/analyze/attentionExperimental.tsx', 'utf8');
const routeTree = readFileSync('standalone/app/src/routes/analyze.tsx', 'utf8');
const tabs = readFileSync('standalone/app/src/lib/analyzeTabs.ts', 'utf8');
const heartRateRoute = readFileSync('standalone/app/src/routes/analyze/heartRate.tsx', 'utf8');
assert.match(legacyRoute, /OyonAttentionV2/, 'the established Engagement screen must remain intact');
assert.match(legacyRoute, /AttentionExperimentalPanels/, 'attention episodes must join the established engagement destination');
assert.doesNotMatch(route, /OyonAttentionV2/, 'experimental attention must not fall back to the legacy copied screen');
assert.match(route, /Experimental attention analytics/);
assert.match(route, /Descriptive state ribbon/);
assert.doesNotMatch(route, /<CardTitle>Breathing trend<\/CardTitle>/, 'attention must not duplicate the full respiration trend');
assert.match(route, /Breathing × attention/);
assert.match(route, /not evidence that breathing caused attention to change/);
assert.equal((route.match(/className=\{ATTENTION_CARD\}/g) || []).length, 4, 'paired attention cards must share one alignment contract');
assert.equal((heartRateRoute.match(/<CardTitle>Breathing rate over time<\/CardTitle>/g) || []).length, 1,
  'the full respiration trend must have one canonical home');
assert.match(routeTree, /path: '\/attention-experimental'[\s\S]*redirect\(\{ to: '\/analyze\/engagement'/,
  'saved experimental links must redirect to the combined destination');
assert.match(tabs, /\/analyze\/engagement', label: 'Attention & engagement'/,
  'attention and engagement must have one navigation entry');
assert.doesNotMatch(tabs, /attention-experimental|Attention \(exp\.\)/,
  'the combined analytics must not retain a competing navigation tab');

const demoBreathing = generateDemoFixture().windows
  .map((window) => window.respiration?.brpm_mean)
  .filter((value) => typeof value === 'number');
assert.ok(demoBreathing.length > 0);
assert.ok(demoBreathing.every((value) => value >= 12.1 && value <= 13.1),
  'demo breathing must remain a realistic 12–13 br/min baseline, not fabricate emotion-linked spikes');

console.log('attention-analytics.test.js — all cases passed');
