import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `${start} must appear before ${end}`);
  return source.slice(from, to);
}

function assertMetricBand(source, start, end, count) {
  const band = section(source, start, end);
  assert.equal((band.match(/<Metric\b/g) || []).length, count, `${start} must expose ${count} aligned headline metrics`);
  assert.match(band, /grid-cols-2[^"']*gap-3/, `${start} needs the shared compact metric grid`);
}

const sequence = read('standalone/app/src/routes/analyze/sequence.tsx');
assertMetricBand(sequence, 'id="seq-overview"', 'id="seq-network"', 6);
assert.match(sequence, /includeOverview: false/, 'spell detail must not repeat the headline sequence metrics');

const patterns = read('standalone/app/src/components/patterns/PatternsPanel.tsx');
assertMetricBand(patterns, 'id="pat-overview"', 'id="pat-simplicial"', 6);

const comparison = read('standalone/app/src/routes/analyze/comparison.tsx');
assertMetricBand(comparison, 'id="cmp-overview"', 'id="cmp-timelines"', 6);
assert.match(comparison, /id="cmp-distribution"[\s\S]*className="flex flex-col gap-4"/,
  'variable comparison groups must stack symmetrically instead of leaving an orphan card');

const logs = read('standalone/app/src/routes/analyze/logs.tsx');
assertMetricBand(logs, 'id="logs-overview"', '<WindowLog', 6);

const heart = read('standalone/app/src/routes/analyze/heartRate.tsx');
assertMetricBand(heart, 'id="hr-kpis"', 'id="hr-trend"', 8);
assert.doesNotMatch(heart, /id="hr-lighting"/, 'lighting quality belongs on Sensor diagnostics');

const position = read('standalone/app/src/routes/analyze/sensing.tsx');
const positionBand = section(position, 'id="position-kpis"', 'id="position-facial"');
assert.match(positionBand, /hasFacial && hasPosture \? 'lg:grid-cols-4' : 'lg:grid-cols-2'/,
  'conditional position metrics must use two or four complete columns');

console.log('analytics-summary-layout.test.js — all cases passed');
