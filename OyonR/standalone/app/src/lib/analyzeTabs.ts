/*
 * The Analyze domain tabs — shared by the standalone AnalyzeLayout subtab row
 * (routes/analyze.tsx) and the embedded unified header (EmbedHeader.tsx). Kept
 * in its own dependency-free module so EmbedHeader can render the tabs without
 * importing the route tree (which would create an import cycle through the root
 * route → AppShell → EmbedHeader).
 *
 * Order follows how a finding is actually read: Affect first (WHAT the state
 * was), then Dynamics (HOW it moved between states) — the dynamics view only
 * means something once you know the states it transitions between — then
 * Patterns (which recurring structures those movements form) and Typing (the
 * writing-process dashboard over typing episodes).
 *
 * Route ids are frozen regardless of label or position, so existing deep links
 * keep working: the dynamics tab is still '/analyze/sequence' (labelled
 * "Dynamics" now that it is multi-channel, not affect-specific) and the
 * position tab is still '/analyze/sensing'.
 *
 * Likewise '/analyze/sensing' keeps its route id but is labelled "Position"
 * (facial signals + body posture). Heart rate was split out to its own tab —
 * a physiological rate and a head/body orientation share no axis, no unit and
 * no reading, so one screen could not serve both.
 */
export const analyzeSubTabs: ReadonlyArray<{ to: string; label: string }> = [
  { to: '/analyze/affect', label: 'Affect' },
  { to: '/analyze/sequence', label: 'Dynamics' },
  { to: '/analyze/patterns', label: 'Patterns' },
  { to: '/analyze/typing', label: 'Typing' },
  { to: '/analyze/voice', label: 'Voice' },
  { to: '/analyze/engagement', label: 'Attention & engagement' },
  { to: '/analyze/gaze', label: 'Gaze' },
  { to: '/analyze/sensing', label: 'Position' },
  { to: '/analyze/heart-rate', label: 'Heart & breathing' },
  { to: '/analyze/logs', label: 'Logs' },
  { to: '/analyze/comparison', label: 'Comparison' },
];
