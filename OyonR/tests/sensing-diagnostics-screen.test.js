import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync('standalone/app/src/router.ts', 'utf8');
const page = readFileSync('standalone/app/src/routes/diagnostics.tsx', 'utf8');
const topMenu = readFileSync('standalone/app/src/components/shell/TopMenu.tsx', 'utf8');
const shell = readFileSync('standalone/app/src/components/shell/AppShell.tsx', 'utf8');
const mini = readFileSync('standalone/app/src/components/shell/MiniCamera.tsx', 'utf8');
const gazeDot = readFileSync('standalone/app/src/components/shell/LiveGazeDot.tsx', 'utf8');
const live = readFileSync('standalone/app/src/routes/live.tsx', 'utf8');
const liveSignals = readFileSync('standalone/app/src/components/live/LiveSignals.tsx', 'utf8');
const runtimeState = readFileSync('standalone/app/src/lib/runtime.ts', 'utf8');

assert.match(router, /diagnosticsRoute/, 'router must register the sensing diagnostics route');
assert.match(page, /path: '\/diagnostics'/, 'diagnostics screen must keep a stable deep link');
assert.match(topMenu, /to: '\/diagnostics', label: 'Diagnostics'/,
  'Sensor diagnostics must be named explicitly in primary navigation');
assert.match(page, /title="Sensor diagnostics"/, 'the page title must match the navigation label');

// Closing is a reversible display action, never a persisted camera decision.
assert.doesNotMatch(shell, /localStorage/, 'camera dock visibility must not survive a reload');
assert.doesNotMatch(shell, /oyon-mini-camera-visible/, 'remove the permanent hidden-state key');
assert.match(topMenu, /Show camera preview/, 'top bar must always provide a restore action');
assert.match(mini, /Open camera preview/, 'closed dock must leave a conspicuous restore handle');
assert.match(mini, /z-modal/, 'restore handle must sit above ordinary dock and chart layers');
assert.match(
  gazeDot,
  /pathname !== '\/live'/,
  'the floating gaze target must not cover analytics or diagnostic cards',
);

// The screen is real-session evidence, not a demo that always passes.
assert.match(page, /runtime\.recentWindows/, 'diagnostics must read windows emitted by the live runtime');
assert.doesNotMatch(page, /demoFixture|setMockGaze/, 'diagnostics must not substitute synthetic evidence');
for (const field of [
  'capture_quality',
  'drop_ratio',
  'Delivery shortfall',
  'observed_fps',
  'fixation_count',
  'aoi_transition_count',
  'scanpath_length',
  'rgb_corroboration_agreement_ratio',
  'max_sample_gap_ms',
  'quality_mean',
  'luma_temporal_std',
  'clipped_low',
  'clipped_high',
]) {
  assert.match(page, new RegExp(field), `diagnostics screen must expose ${field}`);
}

assert.match(page, /setGazeAois/, 'the screen must be able to apply AOIs to the running runtime');
assert.equal(
  (page.match(/className=\{RESULT_CARD_CLASS\}/g) || []).length,
  4,
  'camera, gaze, respiration, and lighting result cards must share one height contract',
);
assert.match(page, /function PrimaryReading/, 'each sensor needs one dominant diagnostic result');
assert.match(page, /function QualityBar/, 'quality should be visually scannable without another metric tile');
assert.equal(
  (page.match(/<Metric\b/g) || []).length,
  6,
  'only the compact run summary should use metric tiles',
);

// The combined live card reports both pipelines and the actual capture state.
assert.match(live, /liveVitalCount/);
assert.match(live, /label: 'idle'[^\n]*start capture/);
assert.match(live, /visibleVitalCount/, 'visible low-quality rates must be counted separately from trusted live rates');
assert.match(live, /showing last or low-quality readings/, 'the card status must disclose retained readings');
assert.match(live, /const displayedHeartRate[\s\S]*bpm: weightedHeartBpm/,
  'the large heart readout must use the confidence-weighted window estimate');
assert.match(live, /const displayedRespiration[\s\S]*brpm: windowRespiration\.brpm_mean/,
  'the large breathing readout must use the confidence-weighted window estimate');
assert.match(live, /active=\{cameraRunning\}/);
assert.match(liveSignals, /Start capture to measure pulse and breathing/);
assert.match(liveSignals, /held value · waiting for a current estimate/,
  'a weak update must retain and grey the last heart-rate value');
assert.match(liveSignals, /last reading · current signal unavailable/,
  'a weak update must retain and grey the last breathing value');
assert.match(runtimeState, /setLastHeartRate\(\(previous\) =>/,
  'heart status events must merge into the previous measurement');
assert.match(runtimeState, /bpm: hasCurrent \? nextBpm : previous\?\.bpm \?\? null/,
  'heart status events must never erase the last BPM');
assert.match(runtimeState, /brpm: hasCurrent \? nextBrpm : previous\?\.brpm \?\? null/,
  'respiration status events must never erase the last breathing rate');
const liveGazeLine = live.slice(live.indexOf('Gaze (live):'), live.indexOf('Gaze (live):') + 400);
assert.doesNotMatch(liveGazeLine, /lastGaze\.state|state\{' '\}/,
  'the live gaze summary must not print the raw eye state');
assert.match(liveSignals, /respirationPhase/, 'live breathing must distinguish a full rejected buffer from acquisition');
assert.match(page, /respirationQualityLabel/, 'diagnostics must show acquisition, confirmation, and confidence as different stages');
assert.doesNotMatch(live, /<CardTitle>Lighting<\/CardTitle>/, 'lighting belongs on Test, not in the live learner-signal row');

console.log('sensing-diagnostics-screen.test.js — all cases passed');
