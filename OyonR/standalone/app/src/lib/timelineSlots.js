/*
 * Slot layout for the Live emotion timeline.
 *
 * Capture is not guaranteed continuous — a window can be dropped by the
 * min_valid_frames gate, or the session paused — so laying bars out by array
 * index renders a dropout identically to a clean run. This module turns a
 * window list into a slot list on a TIME axis, inserting empties for short
 * dropouts and a compressed, labelled break for long ones.
 *
 * Plain JS (with a hand-written .d.ts sibling, matching src/legacy/) so the
 * repo's node test runner can exercise it directly — the layout maths is real
 * logic, not presentation, and a canvas component cannot be unit-tested.
 */

/** Gaps up to this many missing windows render as literal empty slots;
 *  anything longer collapses to a labelled break so bars stay legible. */
export const MAX_EXPLICIT_EMPTY_SLOTS = 6;
export const FALLBACK_CADENCE_MS = 10000;

function startMs(w) {
  if (typeof w?.window_start_ms === 'number' && Number.isFinite(w.window_start_ms)) {
    return w.window_start_ms;
  }
  const parsed = Date.parse(String(w?.window_start ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A window's own span — the aggregate window length it was built from. */
function durationMs(w) {
  if (typeof w?.duration_ms === 'number' && Number.isFinite(w.duration_ms) && w.duration_ms > 0) {
    return w.duration_ms;
  }
  const start = startMs(w);
  const end = Date.parse(String(w?.window_end ?? ''));
  if (start != null && Number.isFinite(end) && end > start) return end - start;
  return null;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Windows → drawable slots.
 *
 * Falls back to plain index layout when any timestamp is unusable — better a
 * strip with no gap information than one with invented gaps.
 *
 * @param {Array<object>} windows
 * @returns {{ slots: Array<object>, gaps: number, cadenceMs: number|null }}
 */
export function buildSlots(windows) {
  if (!Array.isArray(windows) || windows.length === 0) {
    return { slots: [], gaps: 0, cadenceMs: null };
  }

  const stamped = windows.map((w) => ({ w, t: startMs(w) }));
  if (stamped.some((s) => s.t == null)) {
    return {
      slots: windows.map((w) => ({ kind: 'bar', window: w })),
      gaps: 0,
      cadenceMs: null,
    };
  }
  const ordered = stamped.slice().sort((a, b) => a.t - b.t);

  // Expected spacing comes from each window's OWN span, not from the observed
  // inter-window deltas. Inferring it from deltas is circular: the dropouts we
  // are trying to expose are exactly what inflates those deltas, so two
  // windows 40s apart would report a 40s cadence and no gap at all. A window's
  // duration is the aggregate window length that produced it — ground truth,
  // independent of whether the neighbouring windows survived.
  const durations = ordered.map((o) => durationMs(o.w)).filter((d) => d != null);
  const deltas = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const d = ordered[i].t - ordered[i - 1].t;
    if (d > 0) deltas.push(d);
  }
  const cadenceMs = median(durations) ?? median(deltas) ?? FALLBACK_CADENCE_MS;

  const slots = [{ kind: 'bar', window: ordered[0].w }];
  let gaps = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const delta = ordered[i].t - ordered[i - 1].t;
    const missing = Math.max(0, Math.round(delta / cadenceMs) - 1);
    if (missing > 0) {
      gaps += 1;
      if (missing <= MAX_EXPLICIT_EMPTY_SLOTS) {
        for (let k = 0; k < missing; k += 1) slots.push({ kind: 'empty' });
      } else {
        slots.push({ kind: 'break', ms: delta - cadenceMs });
      }
    }
    slots.push({ kind: 'bar', window: ordered[i].w });
  }
  return { slots, gaps, cadenceMs };
}

/** Human-readable gap duration for the break marker's label. */
export function formatGap(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
