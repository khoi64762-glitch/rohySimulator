import { useMemo } from 'react';
import { useFilteredWindows } from '@/lib/useFilteredWindows';

/*
 * Shared plumbing for the two sensing analytics tabs — Position (facial
 * signals + body posture) and Heart rate (rPPG). They read different blocks off
 * the same window stream, so the selection/ordering and the small numeric
 * helpers live here rather than being duplicated in both views.
 */

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function get(o: unknown, ...path: string[]): unknown {
  let cur: unknown = o;
  for (const k of path) {
    if (cur && typeof cur === 'object') cur = (cur as Record<string, unknown>)[k];
    else return undefined;
  }
  return cur;
}

export function mean(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function fmt(v: number | null, d = 1, suffix = ''): string {
  return v == null ? '—' : v.toFixed(d) + suffix;
}

/** Fraction formatted as a percentage ("72%"), or "—". */
export function pct(v: number | null, d = 0): string {
  return v == null ? '—' : `${(v * 100).toFixed(d)}%`;
}

export type SensingWindow = Record<string, unknown>;

/**
 * Windows that carry at least one of the requested sensing blocks, in
 * chronological order. `blocks` is the set of top-level keys a view needs
 * (e.g. ['facial', 'posture'] for Position) — a window with none of them is
 * irrelevant noise for that tab.
 */
export function useSensingWindows(blocks: string[]): { windows: SensingWindow[]; isLoading: boolean } {
  const { filtered, isLoading } = useFilteredWindows();
  const key = blocks.join(',');

  const windows = useMemo(() => {
    const wanted = key.split(',');
    const endMs = (w: SensingWindow) =>
      num(w.window_end_ms) ?? (Date.parse(String(w.window_end ?? '')) || 0);
    return [...filtered]
      .filter((w) => wanted.some((b) => (w as SensingWindow)[b]))
      .sort((a, b) => endMs(a as SensingWindow) - endMs(b as SensingWindow)) as SensingWindow[];
    // `key` is the stable stringification of `blocks` — a fresh array literal
    // from the caller must not retrigger this on every render.
  }, [filtered, key]);

  return { windows, isLoading };
}
