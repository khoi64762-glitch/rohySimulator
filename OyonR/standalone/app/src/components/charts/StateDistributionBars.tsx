import { emotionColor } from '@/lib/emotionColors';

export interface StateDistributionBarsProps {
  frequencies: Record<string, number> | null | undefined;
  limit?: number;
  /**
   * Row order: 'count' (default) sorts most-frequent first — right for state
   * distributions; 'given' keeps the object's own key order — required for
   * histograms (e.g. typing pause buckets), where sorting by frequency would
   * scramble the axis.
   */
  order?: 'count' | 'given';
}

/** Responsive state-frequency bars; labels never share the bar's width. */
export function StateDistributionBars({
  frequencies,
  limit = 12,
  order = 'count',
}: StateDistributionBarsProps) {
  const entries = Object.entries(frequencies ?? {}).filter(
    ([, count]) => Number.isFinite(count) && count > 0,
  );
  if (order === 'count') entries.sort((a, b) => b[1] - a[1]);
  const rows = entries.slice(0, limit);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  const max = Math.max(1, ...rows.map(([, count]) => count));

  if (rows.length === 0) {
    return <p className="m-0 text-sm text-ink-3">No state frequencies yet.</p>;
  }

  return (
    <div className="space-y-2.5" role="list" aria-label="State frequencies">
      {rows.map(([label, count]) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={label} className="space-y-1" role="listitem">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-medium capitalize text-ink-1">
                {label.replace(/[-_]/g, ' ')}
              </span>
              <span className="shrink-0 tabular-nums text-ink-2">
                {count.toLocaleString()} <span className="text-ink-3">({pct.toFixed(1)}%)</span>
              </span>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-surface-2"
              role="img"
              aria-label={`${label}: ${count} states, ${pct.toFixed(1)} percent`}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(count / max) * 100}%`,
                  background: emotionColor(label),
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
