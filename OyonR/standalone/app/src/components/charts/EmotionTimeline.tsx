import { useEffect, useRef } from 'react';
import type { EmotionWindow } from 'oyon';
import { emotionColor } from '@/lib/emotionColors';
import { stateOf } from '@/lib/analyzeWindows';
import { buildSlots, formatGap, type TimelineSlot } from '@/lib/timelineSlots.js';

/*
 * EmotionTimeline — horizontal strip plot of the last N windows.
 * Each bar = one window. Color = dominant emotion. Height = dominant
 * probability. Newest window is on the right.
 *
 * Bars are laid out on a TIME axis, not by array index. Capture is not
 * guaranteed continuous — a window can be dropped by the min_valid_frames
 * gate, or the session can be paused — and index layout renders those bars
 * flush against each other, so a dropout looks identical to a clean run. That
 * matters here specifically, because this strip is what you scan to ask "was
 * there a stretch where the read got unstable".
 *
 * Time is quantised to the observed window cadence rather than drawn
 * continuously, so a short dropout is a visible hole exactly as wide as the
 * windows it swallowed. Long gaps (a pause, a break between tasks) would
 * otherwise squash every bar to sub-pixel width, so they collapse to an
 * explicit, LABELLED break marker — compressed but never silent. There is
 * still no interpolation between windows; that would invent data.
 *
 * Windows that failed the valid-frame gate (`insufficient`) draw as a hatched
 * stub rather than a coloured bar: the palette's `insufficient` grey sits very
 * close to `neutral`, and "no usable data" must never read as a real emotion.
 */

export interface EmotionTimelineProps {
  recentWindows: EmotionWindow[];
  /** Height of the strip in CSS pixels. */
  height?: number;
}

const BREAK_WIDTH_PX = 14;

type Slot = TimelineSlot;

function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim() || fallback;
}

function dominantProbability(w: EmotionWindow): number {
  const probs = w.probabilities ?? {};
  const values = Object.values(probs).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  );
  return values.length ? Math.max(...values) : 0;
}

export function EmotionTimeline({
  recentWindows,
  height = 96,
}: EmotionTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const dpr = window.devicePixelRatio || 1;
    const width = wrapper.clientWidth;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const surface0 = readCssVar('--surface-0', '#ffffff');
    const ink3 = readCssVar('--ink-3', '#737373');
    const line = readCssVar('--line', 'rgba(0,0,0,0.10)');

    ctx.fillStyle = surface0;
    ctx.fillRect(0, 0, width, height);

    // Baseline.
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height - 0.5);
    ctx.lineTo(width, height - 0.5);
    ctx.stroke();

    if (recentWindows.length === 0) {
      // Empty-state hint inside the canvas so the layout doesn't reflow.
      ctx.fillStyle = ink3;
      ctx.font = '11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(
        'no windows yet — bars appear as capture emits them',
        width / 2,
        height / 2,
      );
      return;
    }

    const padding = 6;
    const usable = width - padding * 2;
    const gap = 2;

    // Keep the most recent slots that fit, so a long session scrolls rather
    // than shrinking every bar toward invisibility.
    const built = buildSlots(recentWindows);
    let slots = built.slots;
    const unitCount = (s: Slot[]) => s.filter((x) => x.kind !== 'break').length;
    const breakCount = (s: Slot[]) => s.filter((x) => x.kind === 'break').length;
    const MIN_UNIT_PX = 3;
    while (
      slots.length > 1 &&
      (usable - breakCount(slots) * (BREAK_WIDTH_PX + gap) - gap * (unitCount(slots) - 1)) /
        Math.max(1, unitCount(slots)) < MIN_UNIT_PX
    ) {
      slots = slots.slice(1);
    }
    // Never lead with a gap once older slots have been dropped — a break at
    // the left edge implies a dropout before data we are simply not showing.
    while (slots.length > 0 && slots[0].kind !== 'bar') slots = slots.slice(1);

    const units = unitCount(slots);
    const breaks = breakCount(slots);
    // Upper bound as well as lower: without it, four windows early in a session
    // each take ~240px and the strip reads as a few solid slabs rather than a
    // timeline. Bars grow INTO the space up to a sane width, then the strip
    // simply fills from the left as the session lengthens.
    const MAX_UNIT_PX = 28;
    const unitWidth = Math.min(
      MAX_UNIT_PX,
      Math.max(
        MIN_UNIT_PX,
        (usable - breaks * (BREAK_WIDTH_PX + gap) - gap * Math.max(0, units - 1)) /
          Math.max(1, units),
      ),
    );

    let x = padding;
    let barCount = 0;
    for (const slot of slots) {
      if (slot.kind === 'break') {
        // Compressed elapsed time: two dashed rules plus the duration, so the
        // compression is stated rather than hidden.
        ctx.strokeStyle = ink3;
        ctx.globalAlpha = 0.55;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x + 3.5, 16);
        ctx.lineTo(x + 3.5, height - 4);
        ctx.moveTo(x + BREAK_WIDTH_PX - 3.5, 16);
        ctx.lineTo(x + BREAK_WIDTH_PX - 3.5, height - 4);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = ink3;
        ctx.font = '9px ui-sans-serif, system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(formatGap(slot.ms), x + BREAK_WIDTH_PX / 2, height - 8);
        ctx.globalAlpha = 1;
        x += BREAK_WIDTH_PX + gap;
        continue;
      }
      if (slot.kind === 'empty') {
        // A dropped window: a tick on the baseline marks that time passed
        // here and produced nothing.
        ctx.strokeStyle = ink3;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(x, height - 2.5);
        ctx.lineTo(x + unitWidth, height - 2.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
        x += unitWidth + gap;
        continue;
      }

      const w = slot.window;
      const state = stateOf(w);
      barCount += 1;
      if (state === 'insufficient') {
        // Hatched stub — deliberately unlike any emotion bar.
        const stubH = 10;
        const y = height - 4 - stubH;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, unitWidth, stubH);
        ctx.clip();
        ctx.strokeStyle = ink3;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1;
        for (let hx = x - stubH; hx < x + unitWidth + stubH; hx += 4) {
          ctx.beginPath();
          ctx.moveTo(hx, y + stubH);
          ctx.lineTo(hx + stubH, y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = ink3;
        ctx.globalAlpha = 0.7;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, unitWidth - 1), stubH - 1);
        ctx.globalAlpha = 1;
      } else {
        const conf = dominantProbability(w);
        const barHeight = Math.max(4, conf * (height - 18));
        const y = height - 4 - barHeight;
        ctx.fillStyle = emotionColor(state);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x, y, unitWidth, barHeight);
        ctx.globalAlpha = 1;
      }
      x += unitWidth + gap;
    }

    // Corner labels.
    const lastBar = [...slots].reverse().find((s) => s.kind === 'bar');
    ctx.fillStyle = ink3;
    ctx.font = '10px ui-sans-serif, system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(
      `${barCount} window${barCount === 1 ? '' : 's'}${built.gaps > 0 ? ` · ${built.gaps} gap${built.gaps === 1 ? '' : 's'}` : ''}`,
      6,
      12,
    );
    if (lastBar && lastBar.kind === 'bar') {
      ctx.textAlign = 'right';
      ctx.fillText(
        `latest: ${stateOf(lastBar.window)} · ${(dominantProbability(lastBar.window) * 100).toFixed(0)}%`,
        width - 6,
        12,
      );
    }
  }, [recentWindows, height]);

  return (
    <div ref={wrapperRef} className="w-full">
      <canvas ref={canvasRef} aria-label="Emotion timeline" />
    </div>
  );
}
