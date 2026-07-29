import type { TypingQuality } from 'oyon';
import type { TypingMetricsV3 } from '@/lib/storedTypingWindows';
import { getColor, linearScale } from '../analytics/charts/chartMath';
import { buildLogHistogram, formatDurationShort } from '@/lib/typingChartMath.js';

/*
 * TypingIkiDistribution — histogram of the episode's inter-event intervals
 * (IKIs) on a LOG-SPACED x axis.
 *
 * IKI distributions are heavy-tailed (roughly log-normal): most intervals
 * sit in the 50–300 ms transcription band while genuine pauses run into the
 * tens of seconds. On a linear axis that renders as one spike against an
 * empty plain; log spacing shows the actual shape — typically a fluent-
 * transcription mode plus a deliberation tail.
 *
 * The chart's reason to exist is the pair of vertical rules. The SOLID rule
 * is the episode's fixed pause threshold (`quality.thresholds.
 * burst_threshold_ms`, conventionally 2000 ms — the cut the entire
 * keystroke-logging literature builds bursts and pauses on). The DASHED
 * rule, drawn only when the episode carries the adaptive figure
 * (`adaptive_burst_threshold_ms`, 3× this writer's own median IKI), is the
 * writer-relative alternative. Whether the conventional 2 s cut falls
 * sensibly in the valley of THIS writer's own distribution — or slices
 * through one of its modes — is exactly what this comparison makes visible;
 * no summary statistic shows it.
 *
 * Every bar counts observed intervals from `inter_event_intervals_ms`;
 * nothing is smoothed or fitted. An empty series renders as an explicit
 * degraded state, and a series capped by the aggregator's retention bound
 * (`quality.intervals_truncated`) is disclosed as such.
 */

export interface TypingIkiDistributionProps {
  typing: TypingMetricsV3;
  quality?: TypingQuality;
}

const W = 860;
const H = 210;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 30;
const BINS_PER_DECADE = 4;
const MIN_MS = 10;

/** Log-axis position (in bin units) of a value ≥ MIN_MS. */
function uOf(v: number): number {
  return Math.log10(v / MIN_MS) * BINS_PER_DECADE;
}

export function TypingIkiDistribution({ typing, quality }: TypingIkiDistributionProps) {
  const intervals = Array.isArray(typing.inter_event_intervals_ms)
    ? typing.inter_event_intervals_ms
    : [];
  const hist = buildLogHistogram(intervals, { binsPerDecade: BINS_PER_DECADE, minMs: MIN_MS });
  if (hist.bins.length === 0) {
    return (
      <p className="m-0 text-sm text-ink-3">
        Not drawable — <code>inter_event_intervals_ms</code> is empty: an episode needs at least
        two committed edits to have an interval.
      </p>
    );
  }

  const thresholds = quality?.thresholds as
    | { burst_threshold_ms?: number; adaptive_burst_threshold_ms?: number }
    | undefined;
  const fixedMs = thresholds?.burst_threshold_ms ?? 2000;
  const adaptiveMs = Number.isFinite(thresholds?.adaptive_burst_threshold_ms as number)
    ? (thresholds?.adaptive_burst_threshold_ms as number)
    : null;

  // Axis in bin units: the underflow bin occupies [-1, 0); bin k ≥ 1 covers
  // [k-1, k). Extend the span so both threshold rules always fit on-axis —
  // seeing where they sit relative to the distribution is the whole point.
  const uMin = -1;
  const uMax = Math.max(
    hist.bins.length - 1,
    Math.ceil(uOf(fixedMs)) + 0.5,
    adaptiveMs !== null && adaptiveMs >= MIN_MS ? Math.ceil(uOf(adaptiveMs)) + 0.5 : 0,
  );
  const plotW = W - PAD_L - PAD_R;
  const xOfU = (u: number) => PAD_L + ((u - uMin) / (uMax - uMin)) * plotW;

  const maxCount = Math.max(1, ...hist.bins.map((b) => b.count));
  const yScale = linearScale([0, maxCount], [H - PAD_B, PAD_T]);

  // Decade tick labels (10 ms, 100 ms, 1 s, 10 s …) within the axis span.
  const decadeTicks: Array<{ u: number; label: string }> = [];
  for (let d = 0; ; d += 1) {
    const v = MIN_MS * 10 ** d;
    const u = d * BINS_PER_DECADE;
    if (u > uMax) break;
    decadeTicks.push({ u, label: formatDurationShort(v) });
  }

  const barColor = getColor(3);

  return (
    <div className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Histogram of inter-event intervals on a log-spaced axis, with the fixed pause threshold marked as a solid rule and the adaptive per-writer threshold, when measured, as a dashed rule"
      >
        <title>Inter-keystroke interval distribution (log-spaced) with pause-threshold rules</title>

        {/* Gridlines + y axis (interval counts). */}
        {yScale.ticks(4).map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD_L} y1={yScale(v)} x2={W - PAD_R} y2={yScale(v)} stroke="var(--line)" />
            <text x={PAD_L - 6} y={yScale(v) + 3} textAnchor="end" fontSize={10} fill="var(--ink-3)">
              {v}
            </text>
          </g>
        ))}
        <text x={PAD_L} y={10} fontSize={9} fill="var(--ink-3)">
          intervals
        </text>

        {/* Bars: bin 0 is the sub-{MIN_MS} ms underflow bin. */}
        {hist.bins.map((b, k) => {
          if (b.count === 0) return null;
          const x0 = xOfU(k - 1) + 0.5;
          const x1 = xOfU(k) - 0.5;
          return (
            <rect
              key={`bin-${k}`}
              x={x0}
              y={yScale(b.count)}
              width={Math.max(1, x1 - x0)}
              height={H - PAD_B - yScale(b.count)}
              fill={barColor}
              opacity={0.85}
            />
          );
        })}

        {/* x axis: log-spaced decades. */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="var(--line-strong)" />
        {decadeTicks.map((tk) => (
          <g key={`x-${tk.u}`}>
            <line x1={xOfU(tk.u)} y1={H - PAD_B} x2={xOfU(tk.u)} y2={H - PAD_B + 4} stroke="var(--ink-3)" />
            <text x={xOfU(tk.u)} y={H - PAD_B + 15} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
              {tk.label}
            </text>
          </g>
        ))}
        {/* Underflow-bin label sits on a second row so it cannot collide with
            the 10 ms decade label beside it. */}
        <text x={xOfU(-0.5)} y={H - PAD_B + 26} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
          {'<'}{formatDurationShort(MIN_MS)}
        </text>

        {/* Fixed pause threshold: solid rule. */}
        <line
          x1={xOfU(uOf(fixedMs))}
          y1={PAD_T}
          x2={xOfU(uOf(fixedMs))}
          y2={H - PAD_B}
          stroke="var(--ink-1)"
          strokeWidth={1.5}
        />
        <text
          x={xOfU(uOf(fixedMs)) + 4}
          y={PAD_T + 10}
          fontSize={10}
          fill="var(--ink-1)"
        >
          fixed {formatDurationShort(fixedMs)} cut
        </text>

        {/* Adaptive per-writer threshold: dashed rule (only when measured). */}
        {adaptiveMs !== null && adaptiveMs >= MIN_MS && (
          <>
            <line
              x1={xOfU(uOf(adaptiveMs))}
              y1={PAD_T}
              x2={xOfU(uOf(adaptiveMs))}
              y2={H - PAD_B}
              stroke="var(--status-info)"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text
              x={xOfU(uOf(adaptiveMs)) + 4}
              y={PAD_T + 22}
              fontSize={10}
              fill="var(--status-info)"
            >
              adaptive {formatDurationShort(adaptiveMs)} (3× median IKI)
            </text>
          </>
        )}
      </svg>

      <p className="m-0 text-xs text-ink-3">
        {hist.total.toLocaleString()} intervals
        {quality?.intervals_truncated
          ? ' — series hit its retention cap; the histogram covers retained intervals only'
          : ''}
        {adaptiveMs === null
          ? ' · adaptive threshold not measured (fixed pause-threshold mode)'
          : ''}
      </p>
    </div>
  );
}
