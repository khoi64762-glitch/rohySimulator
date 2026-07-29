import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync('standalone/app/src/routes/analyze/sensing.tsx', 'utf8');
const charts = readFileSync('standalone/app/src/components/sensing/SensingCharts.tsx', 'utf8');

// The default page is an analysis summary, not an always-expanded signal dump.
assert.match(view, /title="Position overview"/);
assert.doesNotMatch(view, /<Metric label="Position windows"/);
assert.doesNotMatch(view, /<Metric label="Head yaw"/);
assert.doesNotMatch(view, /tone="info"/);

// Facing ratio and movement have incompatible units and must not share an axis.
assert.match(view, /<CardTitle>Head orientation density<\/CardTitle>[\s\S]*<OrientationDensity[\s\S]*lg:grid-cols-2/,
  'head orientation density must own a full-width row before the two time-series cards');
assert.match(view, /<CardTitle>Facing screen<\/CardTitle>[\s\S]*<CardTitle>Head movement<\/CardTitle>/,
  'facing ratio and movement must remain separate peers on the following row');
assert.doesNotMatch(view, /movement \(° ÷ 30\)/);
assert.match(view, /unit="degrees"/);

// Show the strongest facial features first; preserve complete detail on demand.
assert.match(view, /data\.auRows\.slice\(0, 8\)[\s\S]*maxWidth="none"/,
  'the primary action-unit heatstrip must fill its full-width card');
assert.match(view, /<details className=/);
assert.match(view, /Advanced facial-signal detail/);
assert.match(view, /<h3[^>]*>All action units<\/h3>/);
assert.match(view, /<h3[^>]*>Raw blendshapes<\/h3>/);
assert.doesNotMatch(view, /<details[^>]*\bopen\b/);

// Long sessions become a density field, not a sampled or connected trace.
assert.match(charts, /ORIENTATION_BINS_X = 18/);
assert.match(charts, /ORIENTATION_BINS_Y = 12/);
assert.match(charts, /summary\.bins\.filter\(\(bin\) => bin\.count > 0\)\.map/);
assert.match(charts, /Math\.sqrt\(bin\.count \/ summary\.maxBin\)/,
  'square-root opacity must keep lower-frequency regions visible');
assert.doesNotMatch(charts, /export function PoseMap/);
assert.doesNotMatch(charts, /MAX_POSE_MARKS/);
assert.doesNotMatch(charts, /const rings/);
assert.match(charts, /maxWidth = 1280/,
  'the density field must be designed for the full-width card');
assert.match(charts, /Math\.floor\(\(deviations\.length - 1\) \* 0\.95\)/,
  'isolated pose failures must not crush the useful density into the origin');
assert.match(charts, /central 95% display[\s\S]*tracking extremes outside view/,
  'robust scaling must disclose how many extremes fall outside the display');
assert.match(charts, /typicalYaw: median[\s\S]*typicalPitch: median[\s\S]*typicalRoll: median/,
  'typical orientation must use robust all-window summaries for all three angles');
assert.match(charts, /facingYawDeg[\s\S]*facingPitchDeg[\s\S]*facingPct/,
  'the density must preserve a meaningful yaw/pitch pose zone and coverage');
assert.match(charts, /Darker cell[\s\S]*Green box[\s\S]*Crosshair/,
  'the three visual encodings must be stated directly');
assert.match(charts, /WITHIN POSE ZONE[\s\S]*yaw\/pitch only/,
  'yaw/pitch tolerance must not claim to equal the separate facing-screen signal');
{
  const niceCeil = (v) => {
    const mag = 10 ** Math.floor(Math.log10(v));
    const k = v / mag;
    return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * mag;
  };
  const normal = Array.from({ length: 100 }, (_, i) => ({
    yaw: 1 + (i % 5) * 0.4,
    pitch: -1 - (i % 4) * 0.3,
  }));
  const points = [...normal, { yaw: 100, pitch: 0 }];
  const deviations = points
    .flatMap((p) => [Math.abs(p.yaw), Math.abs(p.pitch)])
    .sort((a, b) => a - b);
  const index = Math.min(deviations.length - 1, Math.floor((deviations.length - 1) * 0.95));
  const span = niceCeil(Math.max(5, deviations[index] * 1.1));
  assert.ok(span <= 5, `one 100° failure must not force a ±100° display; got ±${span}°`);
}

// A wide card must not magnify SVG labels and rows to twice their design size.
assert.match(charts, /maxWidth = 1000/);
assert.match(charts, /maxWidth === 'none' \? undefined : maxWidth/,
  'individual heatstrips must be able to opt out of the default width cap');

console.log('position-layout.test.js — all cases passed');
