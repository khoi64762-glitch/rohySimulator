import assert from 'node:assert/strict';
import { InteractionAggregator } from '../src/aggregation/InteractionAggregator.js';
import { validateEmotionEvent } from '../src/validation/validateEmotionPayload.js';

// ---------- A. Pointer path length + sample count + AOI dwell (hand-computed) ----------
// Samples: t=0 (0,0,'a'); t=100 (0.1,0,'a'); t=250 (0.1,0.1,'b'); finalize t=300.
// path_length = dist((0,0)->(0.1,0)) + dist((0.1,0)->(0.1,0.1)) = 0.1 + 0.1 = 0.2.
// aoi_dwell_ms: sample1('a') is charged the GAP TO THE NEXT sample (100 - 0 = 100);
//   sample2('a') is charged the gap to ITS next sample (250 - 100 = 150) -> 'a' totals 250;
//   sample3('b') has no successor before finalize, so it gets the tail rule:
//   min(pointerSampleMs=100, finalize(300) - 250 = 50) = 50.
{
  const agg = new InteractionAggregator({ pointerSampleMs: 100 });
  agg.start({ timestamp: 0 });
  agg.record({ modality: 'interaction', state: 'pointer_move', source: 'user', timestamp: 0, detail: { x: 0, y: 0, aoi: 'a' } });
  agg.record({ state: 'pointer_move', timestamp: 100, detail: { x: 0.1, y: 0, aoi: 'a' } });
  agg.record({ state: 'pointer_move', timestamp: 250, detail: { x: 0.1, y: 0.1, aoi: 'b' } });
  const win = agg.finalize({ timestamp: 300 });

  assert.ok(win, 'window produced');
  assert.equal(win.modality, 'interaction');
  assert.equal(win.window_kind, 'interval');
  assert.equal(win.feature_profile, 'interaction-v1');
  assert.equal(win.window_start, new Date(0).toISOString());
  assert.equal(win.window_end, new Date(300).toISOString());

  const t = win.interaction;
  assert.equal(t.pointer_sample_count, 3);
  assert.ok(Math.abs(t.pointer_path_length - 0.2) < 1e-9, `expected 0.2, got ${t.pointer_path_length}`);
  assert.deepEqual(t.aoi_dwell_ms, { a: 250, b: 50 });
  assert.equal(t.idle_ms, 0);
  assert.equal(t.idle_ratio, 0);
  assert.deepEqual(validateEmotionEvent(win), [], `validator should accept the window, got: ${JSON.stringify(validateEmotionEvent(win))}`);
}

// ---------- B. idle_ms / idle_ratio (hand-computed) ----------
// Two idle events of 1500ms each -> idle_ms = 3000; duration = 6000 -> idle_ratio = 0.5.
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ state: 'pointer_idle', timestamp: 1500, detail: { idle_ms: 1500, x: null, y: null, aoi: null } });
  agg.record({ state: 'pointer_idle', timestamp: 5000, detail: { idle_ms: 1500, x: 0.2, y: 0.3, aoi: null } });
  const win = agg.finalize({ timestamp: 6000 });

  assert.equal(win.interaction.idle_ms, 3000);
  assert.equal(win.interaction.idle_ratio, 0.5);
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- C. click_count / double_click_count / aoi_click_counts ----------
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ state: 'click', timestamp: 10, detail: { x: 0.1, y: 0.1, aoi: 'x', button: 0 } });
  agg.record({ state: 'click', timestamp: 20, detail: { x: 0.1, y: 0.1, aoi: 'x', button: 0 } });
  agg.record({ state: 'double_click', timestamp: 30, detail: { x: 0.5, y: 0.5, aoi: 'y', button: 0 } });
  agg.record({ state: 'click', timestamp: 40, detail: { x: 0.9, y: 0.9, aoi: null, button: 2 } });
  const win = agg.finalize({ timestamp: 100 });

  assert.equal(win.interaction.click_count, 3);
  assert.equal(win.interaction.double_click_count, 1);
  assert.deepEqual(win.interaction.aoi_click_counts, { x: 2, y: 1 }, 'the click with a null aoi is not keyed into the map');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- D. scroll_events / scroll_depth_max / scroll_reversals (hand-computed) ----------
// Directions in order: down, down, up, down, up.
// Reversals are direction changes between CONSECUTIVE events: down->down (no),
// down->up (yes, 1), up->down (yes, 2), down->up (yes, 3) -> 3 reversals.
// scroll_depth_max = max(0.2, 0.4, 0.3, 0.5, 0.1) = 0.5.
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ state: 'scroll_down', timestamp: 10, detail: { delta_px: 50, depth_ratio: 0.2 } });
  agg.record({ state: 'scroll_down', timestamp: 20, detail: { delta_px: 60, depth_ratio: 0.4 } });
  agg.record({ state: 'scroll_up', timestamp: 30, detail: { delta_px: 40, depth_ratio: 0.3 } });
  agg.record({ state: 'scroll_down', timestamp: 40, detail: { delta_px: 45, depth_ratio: 0.5 } });
  agg.record({ state: 'scroll_up', timestamp: 50, detail: { delta_px: 80, depth_ratio: 0.1 } });
  const win = agg.finalize({ timestamp: 100 });

  assert.equal(win.interaction.scroll_events, 5);
  assert.equal(win.interaction.scroll_reversals, 3);
  assert.equal(win.interaction.scroll_depth_max, 0.5);
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- E. selection_count / selection_mean_length, incl. null when never measured ----------
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ state: 'select_text', timestamp: 10, detail: { length: 5 } });
  agg.record({ state: 'select_text', timestamp: 20, detail: { length: 15 } });
  const win = agg.finalize({ timestamp: 100 });
  assert.equal(win.interaction.selection_count, 2);
  assert.equal(win.interaction.selection_mean_length, 10, '(5 + 15) / 2');
  assert.deepEqual(validateEmotionEvent(win), []);

  const agg2 = new InteractionAggregator();
  agg2.start({ timestamp: 0 });
  const win2 = agg2.finalize({ timestamp: 100 });
  assert.equal(win2.interaction.selection_count, 0);
  assert.equal(win2.interaction.selection_mean_length, null, 'never measured -> null, not 0');
  assert.deepEqual(validateEmotionEvent(win2), []);
}

// ---------- F. focus_loss_count / hidden_ms, incl. a span still open at finalize ----------
// tab_hidden@100 -> tab_visible@250 closes a 150ms span; tab_hidden@400 is
// still open when finalize(600) runs, contributing another 200ms -> 350 total.
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  agg.record({ state: 'focus_loss', timestamp: 10, detail: null });
  agg.record({ state: 'focus_gain', timestamp: 20, detail: null });
  agg.record({ state: 'focus_loss', timestamp: 30, detail: null });
  agg.record({ state: 'tab_hidden', timestamp: 100, detail: null });
  agg.record({ state: 'tab_visible', timestamp: 250, detail: null });
  agg.record({ state: 'tab_hidden', timestamp: 400, detail: null });
  const win = agg.finalize({ timestamp: 600 });

  assert.equal(win.interaction.focus_loss_count, 2);
  assert.equal(win.interaction.hidden_ms, 350, '150 (100->250) + 200 (400->600, still hidden at finalize)');
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- G. AOI dwell gap interruption: a gap larger than maxSampleGapMs
// is NOT charged as dwell (a real pause must not become fabricated dwell
// time), but the tail sample still gets its representative charge. ----------
// pointerSampleMs: 100 -> maxSampleGapMs defaults to max(500, 100*4) = 500.
// Gap between the two samples is 1000ms (> 500) -> nothing charged for it.
// Tail: min(pointerSampleMs=100, finalize(1050) - 1000 = 50) = 50, charged to 'a'.
{
  const agg = new InteractionAggregator({ pointerSampleMs: 100 });
  agg.start({ timestamp: 0 });
  agg.record({ state: 'pointer_move', timestamp: 0, detail: { x: 0, y: 0, aoi: 'a' } });
  agg.record({ state: 'pointer_move', timestamp: 1000, detail: { x: 0, y: 0, aoi: 'a' } });
  const win = agg.finalize({ timestamp: 1050 });

  assert.equal(win.interaction.pointer_sample_count, 2);
  assert.equal(win.interaction.pointer_path_length, 0, 'both samples at the same point -> zero path length');
  assert.deepEqual(win.interaction.aoi_dwell_ms, { a: 50 }, 'the >500ms gap is not charged; only the 50ms tail is');
  assert.equal(win.quality.thresholds.max_sample_gap_ms, 500);
  assert.deepEqual(validateEmotionEvent(win), []);
}

// ---------- H. Unknown state throws ----------
{
  const agg = new InteractionAggregator();
  agg.start({ timestamp: 0 });
  assert.throws(
    () => agg.record({ state: 'bogus_state', timestamp: 10, detail: null }),
    /not a member of OYON_INTERACTION_STATES/,
  );
}

// ---------- I. record()/finalize() before start() are safe no-ops ----------
{
  const agg = new InteractionAggregator();
  agg.record({ state: 'click', timestamp: 1, detail: null }); // must not throw
  assert.equal(agg.active, false);
  assert.equal(agg.finalize({ timestamp: 100 }), null);
}

// ---------- J. double finalize returns null; quality.thresholds reflect configured options ----------
{
  const agg = new InteractionAggregator({ pointerSampleMs: 50, idleThresholdMs: 2000, scrollThresholdPx: 25 });
  agg.start({ timestamp: 0 });
  const first = agg.finalize({ timestamp: 100 });
  assert.ok(first);
  assert.deepEqual(first.quality.thresholds, {
    pointer_sample_ms: 50,
    idle_threshold_ms: 2000,
    scroll_threshold_px: 25,
    max_sample_gap_ms: 500, // max(500, 50*4=200) = 500
  });
  assert.equal(agg.finalize({ timestamp: 200 }), null, 'second finalize on an already-finalized window returns null');
}

// ---------- K. Validator: malformed values rejected ----------
{
  function baseWindow(overrides = {}) {
    return {
      modality: 'interaction',
      window_kind: 'interval',
      feature_profile: 'interaction-v1',
      window_start: new Date().toISOString(),
      window_end: new Date().toISOString(),
      interaction: {
        pointer_path_length: 0,
        pointer_sample_count: 0,
        idle_ms: 0,
        idle_ratio: 0,
        click_count: 0,
        double_click_count: 0,
        scroll_events: 0,
        scroll_depth_max: 0,
        scroll_reversals: 0,
        selection_count: 0,
        selection_mean_length: null,
        focus_loss_count: 0,
        hidden_ms: 0,
        aoi_dwell_ms: {},
        aoi_click_counts: {},
        ...overrides,
      },
      quality: { thresholds: { pointer_sample_ms: 100, idle_threshold_ms: 1500, scroll_threshold_px: 40, max_sample_gap_ms: 500 } },
    };
  }

  assert.deepEqual(validateEmotionEvent(baseWindow()), [], 'a well-formed, empty interaction window validates cleanly');

  const badClickCount = validateEmotionEvent(baseWindow({ click_count: -1 }));
  assert.ok(badClickCount.some((e) => e.includes('click_count')));

  const badIdleRatio = validateEmotionEvent(baseWindow({ idle_ratio: 1.5 }));
  assert.ok(badIdleRatio.some((e) => e.includes('idle_ratio')));

  const badDwellValue = validateEmotionEvent(baseWindow({ aoi_dwell_ms: { a: -5 } }));
  assert.ok(badDwellValue.some((e) => e.includes('aoi_dwell_ms')));

  const badClickCountsInteger = validateEmotionEvent(baseWindow({ aoi_click_counts: { a: 1.5 } }));
  assert.ok(badClickCountsInteger.some((e) => e.includes('aoi_click_counts')));

  const oversizedMap = {};
  for (let i = 0; i < 201; i += 1) oversizedMap[`aoi_${i}`] = i;
  const badMapSize = validateEmotionEvent(baseWindow({ aoi_dwell_ms: oversizedMap }));
  assert.ok(badMapSize.some((e) => e.includes('aoi_dwell_ms') && e.includes('at most 200 keys')));

  const badSelectionMean = validateEmotionEvent(baseWindow({ selection_mean_length: -1 }));
  assert.ok(badSelectionMean.some((e) => e.includes('selection_mean_length')));

  // selection_mean_length: null is explicitly VALID (never-measured), not an error.
  assert.deepEqual(validateEmotionEvent(baseWindow({ selection_mean_length: null })), []);

  // modality must be a recognized value — 'interaction' itself must be accepted.
  const wrongModality = baseWindow();
  wrongModality.modality = 'not_a_real_modality';
  assert.ok(validateEmotionEvent(wrongModality).some((e) => e.includes('modality')));
}

console.log('interaction-aggregator.test.js passed');
