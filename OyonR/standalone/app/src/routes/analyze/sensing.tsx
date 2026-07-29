import { useMemo } from 'react';
import { Section } from '@/components/ui/Section';
import { Card, CardHeader, CardTitle, CardContent, CardMeta } from '@/components/ui/Card';
import { Metric } from '@/components/ui/Metric';
import { EmptyState } from '@/components/ui/EmptyState';
import { NoSignalWindows } from '@/components/sensing/NoSignalWindows';
import { LineChart, OrientationDensity, Heatstrip, type Series } from '@/components/sensing/SensingCharts';
import { useSensingWindows, num, get, mean, fmt, pct, type SensingWindow } from '@/lib/sensingWindows';
import { cn } from '@/lib/cn';

/*
 * Position — where the head and body ARE: facial signals (head pose + action
 * units) and body posture (lean, tilt, sway, slouch). Heart rate lives in its
 * own tab: it is a physiological rate, not a position, and mixing the two on
 * one screen made the axes meaningless.
 *
 * Head pose is shown as a yaw × pitch density field rather than three line
 * charts. Roll remains part of the same reading as a robust typical value,
 * without turning every window into another overlapping glyph.
 */

const COL = {
  lean: '#58a6ff',
  tilt: '#a371f7',
  sway: '#d29922',
  facing: '#3fb950',
  movement: '#f0883e',
  above: '#58a6ff',
};

/*
 * Action units and blendshapes are DISCOVERED from the data, never listed here.
 *
 * This screen used to hardcode 7 AU names while the extractor emits 14
 * (ACTION_UNIT_MAP in src/inference/FacialSignalExtractor.js). The seven it
 * dropped included eye_squint, mouth_press and both brow_raise variants — so a
 * session whose most active expressions were exactly those rendered as a blank
 * strip, and the obvious reading was "nothing happened facially". That is worse
 * than showing nothing: it is a confident wrong answer.
 *
 * It also violated the project data policy (CLAUDE.md): "No deny-listing of
 * derived signal... every derived signal ships by default." A hardcoded
 * allowlist in the view is exactly that, and it silently re-breaks every time
 * the extractor gains a signal. Reading the keys off the payload cannot.
 */

/** Union of the keys present under `facial.<field>` across all windows. */
function discoverKeys(windows: SensingWindow[], field: string): string[] {
  const seen = new Set<string>();
  for (const w of windows) {
    const map = get(w, 'facial', field);
    if (map && typeof map === 'object') {
      for (const k of Object.keys(map as Record<string, unknown>)) seen.add(k);
    }
  }
  return [...seen];
}

/** Per-key series across windows, ordered by mean activity (loudest first). */
function seriesByActivity(
  windows: SensingWindow[],
  field: string,
): Array<{ label: string; values: Array<number | null>; activity: number }> {
  return discoverKeys(windows, field)
    .map((k) => {
      const values = windows.map((w) => num(get(w, 'facial', field, k)));
      return { label: k, values, activity: mean(values) ?? 0 };
    })
    .filter((r) => r.values.some((v) => v != null))
    .sort((a, b) => b.activity - a.activity);
}

export function PositionView() {
  const { windows, isLoading } = useSensingWindows(['facial', 'posture']);

  const data = useMemo(() => {
    const pitch: Array<number | null> = [];
    const yaw: Array<number | null> = [];
    const roll: Array<number | null> = [];
    const facing: Array<number | null> = [];
    const movement: Array<number | null> = [];
    const lean: Array<number | null> = [];
    const tilt: Array<number | null> = [];
    const sway: Array<number | null> = [];
    const above: Array<number | null> = [];
    const width: Array<number | null> = [];

    for (const w of windows) {
      pitch.push(num(get(w, 'facial', 'head_pose_mean', 'pitch_deg')));
      yaw.push(num(get(w, 'facial', 'head_pose_mean', 'yaw_deg')));
      roll.push(num(get(w, 'facial', 'head_pose_mean', 'roll_deg')));
      facing.push(num(get(w, 'facial', 'facing_screen_ratio')));
      movement.push(num(get(w, 'facial', 'head_movement_deg')));
      lean.push(num(get(w, 'posture', 'torso_lean_deg_mean')));
      tilt.push(num(get(w, 'posture', 'shoulder_tilt_deg_mean')));
      sway.push(num(get(w, 'posture', 'postural_sway_deg')));
      above.push(num(get(w, 'posture', 'head_above_norm_mean')));
      width.push(num(get(w, 'posture', 'shoulder_width_norm_mean')));
    }

    // Rows lead with the expressions that actually happened, not a fixed
    // alphabet — and cover every AU the extractor emitted, not a subset.
    const auRows = seriesByActivity(windows, 'action_units_mean');
    // All raw blendshapes (~52). The named AUs above are averaged proxies over
    // these; researchers asking "which shape drove that" need the originals.
    const blendRows = seriesByActivity(windows, 'blendshapes_mean');

    return { pitch, yaw, roll, facing, movement, lean, tilt, sway, above, width, auRows, blendRows };
  }, [windows]);

  if (isLoading) return <EmptyState title="Loading…" />;
  if (windows.length === 0) {
    return (
      <NoSignalWindows
        title="No position windows yet"
        description="Enable Facial signals and/or Body posture in Settings and capture a session — or load synthetic demo data."
      />
    );
  }

  const hasFacial = data.pitch.some((x) => x != null);
  const hasPosture = data.lean.some((x) => x != null);

  const postureSeries: Series[] = [
    { name: 'torso lean', color: COL.lean, values: data.lean },
    { name: 'shoulder tilt', color: COL.tilt, values: data.tilt },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Section
        id="position-kpis"
        title="Position overview"
        description="A compact reading of screen orientation and postural stability."
        actions={<span className="text-xs tabular-nums text-ink-3">{windows.length} windows</span>}
      >
        <div className={cn('grid grid-cols-2 gap-3', hasFacial && hasPosture ? 'lg:grid-cols-4' : 'lg:grid-cols-2')}>
          {hasFacial && <Metric label="Facing screen" value={pct(mean(data.facing))} />}
          {hasFacial && <Metric label="Head movement" value={fmt(mean(data.movement), 1, '°')} hint="mean per window" />}
          {hasPosture && <Metric label="Torso lean" value={fmt(mean(data.lean), 1, '°')} />}
          {hasPosture && <Metric label="Postural sway" value={fmt(mean(data.sway), 2, '°')} hint="restlessness" />}
        </div>
      </Section>

      {hasFacial && (
        <Section
          id="position-facial"
          title="Facial signals"
          description="Where the head pointed, how consistently the screen was faced, and which visible expressions were most active."
        >
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Head orientation density</CardTitle>
                <CardMeta>yaw × pitch · roll summarized</CardMeta>
              </CardHeader>
              <CardContent>
                <OrientationDensity
                  yaw={data.yaw}
                  pitch={data.pitch}
                  roll={data.roll}
                />
              </CardContent>
            </Card>
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Facing screen</CardTitle></CardHeader>
                <CardContent>
                  <LineChart
                    series={[{ name: 'facing screen', color: COL.facing, values: data.facing }]}
                    height={260}
                    yDomain={[0, 1]}
                    formatY={(v) => `${Math.round(v * 100)}%`}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Head movement</CardTitle></CardHeader>
                <CardContent>
                  <LineChart
                    series={[{ name: 'movement', color: COL.movement, values: data.movement }]}
                    height={260}
                    unit="degrees"
                  />
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Most active action units</CardTitle>
                <CardMeta>{Math.min(8, data.auRows.length)} of {data.auRows.length} shown</CardMeta>
              </CardHeader>
              <CardContent>
                <Heatstrip rows={data.auRows.slice(0, 8)} max={1} rowHeight={16} maxWidth="none" />
              </CardContent>
            </Card>
          </div>

          <details className="overflow-hidden rounded-lg border border-line bg-surface-1">
            <summary className="flex cursor-pointer items-center justify-between gap-3 bg-surface-2 px-4 py-3 text-xs font-semibold text-ink-2">
              <span>Advanced facial-signal detail</span>
              <span className="font-normal text-ink-3">
                {data.auRows.length} action units · {data.blendRows.length} raw shapes
              </span>
            </summary>
            <div className="grid gap-5 border-t border-line p-4">
              <div>
                <h3 className="mb-3 mt-0 text-xs font-semibold text-ink-1">All action units</h3>
                <Heatstrip rows={data.auRows} max={1} rowHeight={14} />
              </div>
              {data.blendRows.length > 0 && (
                <div>
                  <h3 className="mb-3 mt-0 text-xs font-semibold text-ink-1">Raw blendshapes</h3>
                  <Heatstrip rows={data.blendRows} max={1} rowHeight={12} />
                </div>
              )}
            </div>
          </details>
        </Section>
      )}

      {hasPosture && (
        <Section
          id="position-posture"
          title="Body posture"
          description="Torso lean / shoulder tilt, postural sway (restlessness), and slouch."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Lean &amp; tilt over time</CardTitle></CardHeader>
              <CardContent>
                <LineChart series={postureSeries} zeroLine unit="degrees" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Postural sway (restlessness)</CardTitle></CardHeader>
              <CardContent>
                <LineChart series={[{ name: 'sway', color: COL.sway, values: data.sway }]} unit="°" />
              </CardContent>
            </Card>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Metric label="Slouch (head above)" value={fmt(mean(data.above), 2)} hint="lower = more slumped" />
            <Metric label="Proximity" value={fmt(mean(data.width), 3)} hint="shoulder width (larger = closer)" />
          </div>
        </Section>
      )}
    </div>
  );
}
