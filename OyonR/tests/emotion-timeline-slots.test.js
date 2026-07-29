import assert from 'node:assert/strict';
import {
  buildSlots,
  formatGap,
  MAX_EXPLICIT_EMPTY_SLOTS,
} from '../standalone/app/src/lib/timelineSlots.js';

/*
 * The Live emotion timeline used to lay bars out by ARRAY INDEX, so a dropped
 * window (min_valid_frames gate) or a paused session rendered identically to a
 * clean continuous run — the one thing the strip is scanned for. These cases
 * pin the time-axis layout that replaced it.
 */

const T0 = Date.parse('2026-07-20T10:00:00.000Z');
const STEP = 10000;

/** Windows at the given 10s multiples — `at: [0,1,3]` skips the 3rd window. */
function windowsAt(multiples, dominant = 'neutral') {
  return multiples.map((m) => ({
    window_start: new Date(T0 + m * STEP).toISOString(),
    window_end: new Date(T0 + (m + 1) * STEP).toISOString(),
    dominant_emotion: dominant,
    probabilities: { [dominant]: 0.8 },
  }));
}

const kinds = (r) => r.slots.map((s) => s.kind);

// Continuous capture — no gaps invented.
{
  const r = buildSlots(windowsAt([0, 1, 2, 3]));
  assert.deepEqual(kinds(r), ['bar', 'bar', 'bar', 'bar']);
  assert.equal(r.gaps, 0);
  assert.equal(r.cadenceMs, STEP);
}

// One dropped window becomes one empty slot in the right place.
{
  const r = buildSlots(windowsAt([0, 1, 3, 4]));
  assert.deepEqual(kinds(r), ['bar', 'bar', 'empty', 'bar', 'bar']);
  assert.equal(r.gaps, 1);
}

// Several dropped windows stay literal while they fit.
{
  const r = buildSlots(windowsAt([0, 4]));
  assert.deepEqual(kinds(r), ['bar', 'empty', 'empty', 'empty', 'bar']);
  assert.equal(r.gaps, 1);
}

// A long pause collapses to ONE labelled break rather than hundreds of
// empties, which would squash every bar to sub-pixel width.
{
  const r = buildSlots(windowsAt([0, 1, 200]));
  assert.deepEqual(kinds(r), ['bar', 'bar', 'break', 'bar']);
  assert.equal(r.gaps, 1);
  const brk = r.slots.find((s) => s.kind === 'break');
  // 199 steps between starts, one of which is the window itself.
  assert.equal(brk.ms, 199 * STEP - STEP);
}

// The empty/break boundary sits exactly at MAX_EXPLICIT_EMPTY_SLOTS.
{
  const atLimit = buildSlots(windowsAt([0, MAX_EXPLICIT_EMPTY_SLOTS + 1]));
  assert.ok(atLimit.slots.every((s) => s.kind !== 'break'), 'at limit stays empties');
  assert.equal(
    atLimit.slots.filter((s) => s.kind === 'empty').length,
    MAX_EXPLICIT_EMPTY_SLOTS,
  );
  const overLimit = buildSlots(windowsAt([0, MAX_EXPLICIT_EMPTY_SLOTS + 2]));
  assert.ok(overLimit.slots.some((s) => s.kind === 'break'), 'over limit collapses');
}

// Cadence comes from each window's OWN duration, not the observed deltas —
// otherwise the dropouts inflate the spacing used to detect them.
{
  const r = buildSlots(windowsAt([0, 1, 2, 3, 60]));
  assert.equal(r.cadenceMs, STEP, 'one huge gap must not move the cadence');
  assert.deepEqual(kinds(r), ['bar', 'bar', 'bar', 'bar', 'break', 'bar']);
}

// The circular-inference case: with only two windows the single delta IS the
// only delta, so a delta-derived cadence would report "no gap". Duration-
// derived cadence still sees the three missing windows.
{
  const r = buildSlots(windowsAt([0, 4]));
  assert.equal(r.cadenceMs, STEP);
  assert.equal(r.gaps, 1, 'a gap between the only two windows must still show');
}

// Same trap at scale: if MOST windows dropped, the median delta is 2x the
// true cadence and every gap would silently disappear.
{
  const r = buildSlots(windowsAt([0, 2, 4, 6, 8]));
  assert.equal(r.cadenceMs, STEP, 'majority-dropout must not redefine cadence');
  assert.equal(r.gaps, 4);
  assert.deepEqual(kinds(r), [
    'bar', 'empty', 'bar', 'empty', 'bar', 'empty', 'bar', 'empty', 'bar',
  ]);
}

// Out-of-order input is sorted, not treated as gaps.
{
  const ws = windowsAt([0, 1, 2]);
  const r = buildSlots([ws[2], ws[0], ws[1]]);
  assert.deepEqual(kinds(r), ['bar', 'bar', 'bar']);
  assert.equal(r.gaps, 0);
}

// Unusable timestamps fall back to index layout — no invented gaps.
{
  const r = buildSlots([
    { dominant_emotion: 'happy', probabilities: { happy: 0.9 } },
    { dominant_emotion: 'sad', probabilities: { sad: 0.7 } },
  ]);
  assert.deepEqual(kinds(r), ['bar', 'bar']);
  assert.equal(r.gaps, 0);
  assert.equal(r.cadenceMs, null);
}

// Degenerate inputs.
assert.deepEqual(buildSlots([]), { slots: [], gaps: 0, cadenceMs: null });
assert.deepEqual(buildSlots(null), { slots: [], gaps: 0, cadenceMs: null });
{
  const one = buildSlots(windowsAt([0]));
  assert.deepEqual(kinds(one), ['bar']);
  assert.equal(one.cadenceMs, FALLBACK_FOR_SINGLE());
}
function FALLBACK_FOR_SINGLE() {
  // A single window yields no deltas, so the cadence falls back to the default.
  return 10000;
}

// Gap labels.
assert.equal(formatGap(45000), '45s');
assert.equal(formatGap(150000), '3m');
assert.equal(formatGap(7200000), '2.0h');

console.log('emotion-timeline-slots.test.js — all cases passed');
