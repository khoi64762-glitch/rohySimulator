import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDemoFixture } from '../standalone/app/src/legacy/demoFixture.js';

/*
 * Node sizing by centrality, and the contracts that keep the two new views
 * honest. The maths lives in lib/centrality.ts (TypeScript, so it is asserted
 * on source text like the app's other contract tests), and the pure scaling
 * rule is re-implemented here and checked numerically.
 */

const centrality = readFileSync('standalone/app/src/lib/centrality.ts', 'utf8');
const panel = readFileSync('standalone/app/src/components/charts/CentralityPanel.tsx', 'utf8');
const sequence = readFileSync('standalone/app/src/routes/analyze/sequence.tsx', 'utf8');
const stateBars = readFileSync('standalone/app/src/components/charts/StateDistributionBars.tsx', 'utf8');
const graph = readFileSync('standalone/vendor/rohy-tna/NetworkGraph.js', 'utf8');
const sequencePlots = readFileSync('standalone/vendor/rohy-tna/SequencePlots.js', 'utf8');
const monitor = readFileSync('standalone/app/src/components/charts/AttentionMonitor.tsx', 'utf8');
const view = readFileSync('standalone/app/src/routes/analyze/gaze.tsx', 'utf8');
const tabs = readFileSync('standalone/app/src/lib/analyzeTabs.ts', 'utf8');

// ── Sizing is OFF unless asked for ────────────────────────────────────────
// Size is the first channel the eye reads. A diagram that encodes something
// the reader did not request misleads more than one that encodes nothing.
assert.match(
  sequence,
  /useState<NodeSizeKey>\('none'\)/,
  'node sizing must default to none',
);
assert.match(panel, /value="none"/, 'the control must offer an explicit "no sizing" option');

// ── AREA, not radius, is proportional to the value ────────────────────────
// A circle's area grows with r². Mapping value straight onto radius makes a
// state with twice the centrality look four times as important — the picture
// would then contradict the number printed beside its bar.
assert.match(
  centrality,
  /Math\.sqrt\(v \/ max\)/,
  'radii must scale with sqrt(value) so AREA is proportional',
);
{
  // Re-implementation of nodeRadiiFor's scaling, checked numerically.
  const MIN = 13, MAX = 34;
  const radius = (v, max) => MIN + Math.sqrt(v / max) * (MAX - MIN);
  const areaOf = (r) => Math.PI * r * r;

  // A value 4x another must produce ~2x the radius ABOVE the floor, i.e. the
  // sqrt relationship — verified through the excess over MIN.
  const rBig = radius(4, 4);
  const rSmall = radius(1, 4);
  const excessRatio = (rBig - MIN) / (rSmall - MIN);
  assert.ok(
    Math.abs(excessRatio - 2) < 1e-9,
    `4x the value must give 2x the radius excess, got ${excessRatio}`,
  );
  // And the area excess ratio is then 4 — matching the data.
  assert.ok(areaOf(rBig) > areaOf(rSmall), 'bigger value must draw a bigger node');
}

// ── Degenerate input must not invent a hierarchy ──────────────────────────
// All-equal or all-zero centralities carry no differences to encode; scaling
// them anyway would magnify floating-point noise into a visible ranking.
assert.match(
  centrality,
  /max - min < 1e-9/,
  'identical values must fall back to uniform sizing',
);
assert.match(
  panel,
  /Every state scores the same on this measure/,
  'inert sizing must be explained, not silently ignored',
);

// ── Per-node radii must reach the renderer's geometry, not just the circle ─
// Trimming every edge by ONE global radius leaves arrowheads buried inside
// large nodes and floating away from small ones, and a fixed layout radius
// lets big nodes overflow the viewBox.
assert.match(graph, /const rOf = \(i\)/, 'the renderer must resolve radius per node');
assert.match(graph, /const srcR = rOf\(src\.index\)/, 'edge start must use its own node radius');
assert.match(graph, /const stopDist = tgtR \+ ARROW_SIZE/, 'arrowheads must stop at the TARGET radius');
assert.match(graph, /const selfR = rOf\(node\.index\)/, 'self-loops must use their own node radius');
assert.match(graph, /maxNodeRadius/, 'layout must clear the LARGEST node, not the nominal one');
// Backwards compatible: callers that pass no radii keep the single value.
assert.match(
  graph,
  /Array\.isArray\(options\.nodeRadii\) \? options\.nodeRadii : null/,
  'nodeRadii must be optional so existing callers are unaffected',
);

// ── Bars sit BESIDE a network that fills its full card ────────────────────
assert.match(
  sequence,
  /grid items-stretch gap-4 xl:grid-cols-2/,
  'centrality must render beside the network, not below it',
);
assert.ok(
  (sequence.match(/flex h-\[34rem\] min-h-0 flex-col overflow-hidden/g) || []).length >= 2,
  'network and centrality cards must share the same explicit height',
);
assert.match(sequence, /svgWidth: Math\.max\(1, el\.clientWidth\)/,
  'the network layout width must come from the available card width');
assert.match(sequence, /graphHeight: Math\.max\(1, el\.clientHeight\)/,
  'the network layout height must expand to the available card height');
assert.match(sequence, /className="min-h-0 w-full flex-1"/,
  'the network container must fill the flexible card content area');
assert.doesNotMatch(
  sequence,
  /renderCentralityTable/,
  'the old standalone centrality table must be gone — one table, not two',
);
assert.doesNotMatch(panel, /<table\b/, 'centrality must render as bars, not a numeric table');
assert.match(panel, /const displayKey: CentralityKey = sizeBy === 'none' \? 'InStrength' : sizeBy/,
  'the node-size selection must also drive the active bar ranking');
assert.match(panel, /width: `\$\{width\}%`/,
  'active centrality values must be encoded as horizontal bar lengths');
assert.match(panel, /background: emotionColor\(row\.label\)/,
  'centrality bars must use the shared emotion palette');
assert.doesNotMatch(panel, /secondaryMeasures/,
  'inactive centralities must not be printed beneath a bar that does not encode them');

// ── Frequencies + transition sunburst; matrix/ngrams live elsewhere ───────
assert.match(sequence, /title="State distribution"/,
  'state frequencies must retain their own section');
assert.match(sequence, /title="State distribution"[\s\S]*xl:grid-cols-2/,
  'frequency and transition sunburst cards must share a responsive row');
assert.match(sequence, /<CardTitle>Transition sunburst<\/CardTitle>/,
  'the empty companion slot must contain the TNA.js transition sunburst');
assert.match(sequence, /plotLSAPolar\(fit,[\s\S]*style: 'rose'/,
  'the transition view must use equal source sectors so dominant states cannot crush the labels');
assert.match(sequence, /fill: 'prob'/,
  'sunburst colour must remain on a bounded probability scale instead of being washed out by residual extremes');
assert.match(sequence, /viewBox="70 65 600 390"/,
  'unused internal title space must be cropped so the sunburst fills its card');
assert.match(sequence, /const sequences = useMemo[\s\S]*computeTnaFromSequences\(sequences\)/,
  'the network and sunburst must share the same session-safe pooled sequences');
assert.doesNotMatch(sequence, /Transition matrix|renderMatrixHeatmap/,
  'the transition-matrix card must not return');
assert.doesNotMatch(sequence, /n-gram|NgramPatternsPanel|renderPatternsTable/i,
  'n-grams belong in the Patterns tab and must not be duplicated here');
assert.match(stateBars, /justify-between/,
  'frequency values need a separate label row so the longest bar cannot clip them');
assert.match(stateBars, /background: emotionColor\(label\)/,
  'frequency bars must keep the shared emotion palette');

// ── Sequence plots are compact peers; distribution ticks every 10 steps ──
assert.match(sequence, /title="Sequence plots"[\s\S]*lg:grid-cols-2/,
  'the two sequence plots must share a responsive two-card row');
assert.match(sequence, /<Card id="seq-index">[\s\S]*<Card id="seq-distplot">/,
  'both sequence plot cards must retain addressable ids');
assert.doesNotMatch(sequence, /style=\{\{ minHeight: 200 \}\}/,
  'sequence SVGs must not reserve loose blank minimum height');
assert.match(sequencePlots, /ts\.step === 1 \|\| ts\.step % 10 === 0/,
  'distribution x-axis ticks must appear at 1 and every 10 timepoints');

// ── Attention monitor: ChatOyon centroids, coloured by emotion ───────────
// The gaze contract is centered [-0.5, 0.5], NOT [0, 1]. Treating a real
// centroid as 0..1 pins every negative coordinate to the top/left edges and
// crams the entire map into one quadrant.
assert.match(
  monitor,
  /\(clampCentered\(p\.x\) \+ 0\.5\) \* WIDTH/,
  'centered gaze x must be translated to screen coordinates like ChatOyon',
);
assert.match(
  monitor,
  /\(clampCentered\(p\.y\) \+ 0\.5\) \* HEIGHT/,
  'centered gaze y must be translated to screen coordinates like ChatOyon',
);
assert.match(monitor, /Math\.max\(-0\.5, Math\.min\(0\.5, v\)\)/,
  'centroids must be clamped to the documented centered screen square');
assert.doesNotMatch(monitor, /clamp01/, 'the old 0..1 transform must not return');

// Keep ChatOyon's sqrt(n_points) size encoding, but replace its single teal
// hue with the app-wide emotion palette.
assert.match(monitor, /Math\.sqrt\(p\.n \/ maxN\)/,
  'centroid radius must carry the window gaze-sample count');
assert.match(monitor, /color: emotionColor\(p\.emotion\)/,
  'every centroid must resolve its colour from the shared emotion palette');
assert.match(monitor, /return sizeBy === 'heartRate'[\s\S]*<path[\s\S]*d=\{HEART_PATH\}/,
  'heart-rate marks must use a distinct heart silhouette');
assert.match(monitor, /fill="none"[\s\S]*stroke=\{m\.color\}/,
  'heart-rate hearts must carry emotion colour on their outline only');
assert.match(monitor, /<circle[\s\S]*fill=\{m\.color\}[\s\S]*fillOpacity=\{0\.42\}/,
  'sample-sized centroids must remain filled circles');
assert.match(view, /n_points/, 'the view must forward gaze sample counts for dot sizing');
assert.equal((view.match(/<Card className="h-full">/g) || []).length, 2,
  'both centroid maps must be equal-height peers');
assert.match(view, /grid items-stretch gap-4 lg:grid-cols-2/,
  'centroid maps must use the same full-width two-column grid as the other Gaze cards');
assert.doesNotMatch(view, /max-w-6xl|max-w-xl|rounded-r-none|rounded-l-none|border-l-0/,
  'attention cards must not use a narrower or joined layout that breaks column alignment');

// The original map remains sample-sized; a distinct companion map carries HR.
assert.match(view, /<CardTitle>Gaze sample density<\/CardTitle>[\s\S]*sizeBy="gazeSamples"/,
  'the original map must retain gaze-sample sizing');
assert.match(view, /<CardTitle>Heart rate at gaze centroid<\/CardTitle>[\s\S]*sizeBy="heartRate"/,
  'heart rate must have its own clearly labelled companion map');
assert.match(view, /bpm_tracked[\s\S]*bpm_robust[\s\S]*bpm_mean/,
  'bubble sizing must prefer tracked BPM, then robust and raw fallbacks');
assert.match(monitor, /heartRateRadius\(p\.bpm\)/,
  'heart-rate mode must drive the bubble radius from the window BPM');
assert.match(monitor, /HR_REFERENCE_BPM = 72/,
  'heart-rate bubble sizing must have a stable 72 BPM reference');
assert.match(monitor, /HR_REFERENCE_RADIUS = 3\.25/,
  'the 72 BPM reference circle must stay visually small');
assert.match(monitor, /value <= HR_REFERENCE_BPM[\s\S]*HR_REFERENCE_RADIUS[\s\S]*HR_DOT_MAX/,
  'heart-rate bubble area must shrink below 72 and grow above it');
assert.match(monitor, /0\.22 \+ deviation \* 0\.58/,
  'the 72 BPM reference must be faint and deviations progressively brighter');
assert.match(monitor, /m\.bpm\?\.toFixed\(1\).*bpm/,
  'heart-rate bubbles must expose the encoded BPM in their tooltip');
assert.match(monitor, /delta < 0 \? 'below' : 'above'/,
  'heart-rate tooltips must state position below or above the reference');

// Demo data must mirror the REAL aggregator contract. This is executable
// rather than a source-text assertion so changing the fixture expression
// cannot silently move it to another coordinate convention.
{
  const { windows } = generateDemoFixture();
  const centroids = windows.map((w) => w.gaze?.centroid).filter(Boolean);
  assert.ok(centroids.length > 0, 'demo fixture must carry gaze centroids');
  for (const centroid of centroids) {
    assert.ok(Number.isFinite(centroid.x) && centroid.x >= -0.5 && centroid.x <= 0.5,
      `demo centroid.x ${centroid.x} is outside the centered gaze contract`);
    assert.ok(Number.isFinite(centroid.y) && centroid.y >= -0.5 && centroid.y <= 0.5,
      `demo centroid.y ${centroid.y} is outside the centered gaze contract`);
  }
}

// ── Attention monitor leads Gaze; the old deep link remains compatible ───
assert.doesNotMatch(tabs, /'\/analyze\/monitor'/,
  'attention monitor must not remain as a duplicate analyze tab');
assert.match(view, /id="gaze-kpis"[\s\S]*id="gaze-attention-monitor"[\s\S]*id="gaze-structure"/,
  'summary stats must lead, followed by attention cards and the remaining Gaze cards');
assert.match(view, /grid grid-cols-2 gap-3 lg:grid-cols-4/,
  'the summary must form two aligned rows of four equal metric cards');
{
  const router = readFileSync('standalone/app/src/router.ts', 'utf8');
  const routes = readFileSync('standalone/app/src/routes/analyze.tsx', 'utf8');
  assert.match(routes, /path: '\/monitor'[\s\S]*redirect\(\{ to: '\/analyze\/gaze' \}\)/,
    'saved monitor links must redirect to the merged Gaze page');
  const occurrences = (router.match(/analyzeMonitorRoute/g) || []).length;
  assert.ok(
    occurrences >= 2,
    'the compatibility redirect must remain registered in the route tree',
  );
}

console.log('centrality-sizing.test.js — all cases passed');
