import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { analyzeSubTabs } from '@/lib/analyzeTabs';
import { AffectView } from './analyze/affect';
import { EngagementView } from './analyze/engagement';
import { GazeView } from './analyze/gaze';
import { PositionView } from './analyze/sensing';
import { HeartRateView } from './analyze/heartRate';
import { LogsView } from './analyze/logs';
import { PatternsView } from './analyze/patterns';
import { SequenceView } from './analyze/sequence';
import { TypingView } from './analyze/typing';
import { VoiceView } from './analyze/voice';
import { ComparisonView } from './analyze/comparison';

/*
 * Analyze — parent route. Each domain view lives in its own file under
 * src/routes/analyze/, so this is now purely a route container.
 *
 * It used to render a PageHeader block plus a row of nine domain tabs. Both
 * are gone: the domains are reachable from the single top bar's Analyze menu,
 * standalone and embedded alike, so the layout renders only the active view.
 */
export const analyzeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/analyze',
  component: Outlet,
});

export const analyzeIndexRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/',
  beforeLoad: () => {
    // Land on the first/default domain — Affect. Must track the leading entry
    // in analyzeSubTabs: when the order changed, a stale redirect here would
    // silently drop the user on the SECOND tab.
    throw redirect({ to: analyzeSubTabs[0].to as never });
  },
});

export const analyzeAffectRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/affect',
  component: AffectView,
});
export const analyzeEngagementRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/engagement',
  component: EngagementView,
});
export const analyzeAttentionExperimentalRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/attention-experimental',
  beforeLoad: () => {
    // Compatibility for saved links: attention and engagement now share one
    // evidence screen instead of competing destinations.
    throw redirect({ to: '/analyze/engagement' });
  },
});
export const analyzeGazeRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/gaze',
  component: GazeView,
});
// Route id kept as '/sensing' (stable deep-link) — labelled "Position".
export const analyzeSensingRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/sensing',
  component: PositionView,
});
export const analyzeHeartRateRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/heart-rate',
  component: HeartRateView,
});
export const analyzeMonitorRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/monitor',
  beforeLoad: () => {
    // Compatibility for saved links: the monitor now leads the Gaze page.
    throw redirect({ to: '/analyze/gaze' });
  },
});
export const analyzeLogsRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/logs',
  component: LogsView,
});
export const analyzePatternsRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/patterns',
  component: PatternsView,
});
export const analyzeSequenceRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/sequence',
  component: SequenceView,
});
export const analyzeTypingRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/typing',
  component: TypingView,
});
export const analyzeVoiceRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/voice',
  component: VoiceView,
});
export const analyzeComparisonRoute = createRoute({
  getParentRoute: () => analyzeRoute,
  path: '/comparison',
  component: ComparisonView,
  validateSearch: (search: Record<string, unknown>): { ids?: string } => {
    const ids = typeof search.ids === 'string' ? search.ids : undefined;
    return { ids };
  },
});
