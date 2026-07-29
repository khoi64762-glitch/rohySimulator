import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { loadDemoData } from '@/legacy/demoFixture.js';
import { WindowLog } from '@/components/logs/WindowLog';
import { Section } from '@/components/ui/Section';
import { Metric } from '@/components/ui/Metric';
import { sessionIdOf, stateOf } from '@/lib/analyzeWindows';

/*
 * Analyze · Logs — the comprehensive per-window data log. Every recorded signal
 * (emotion + probabilities, engagement, gaze, zones, quality, place) in one
 * searchable / sortable / pivotable / column-toggleable table with CSV export.
 */
export function LogsView() {
  const { filtered: enriched, isLoading } = useFilteredWindows();
  const queryClient = useQueryClient();

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  if (isLoading) return <EmptyState title="Loading stored windows…" />;
  if (enriched.length === 0) {
    return (
      <EmptyState
        title="No stored windows yet"
        description="Capture a real session, or load synthetic demo data to populate the log."
        action={
          <Button variant="primary" size="sm" onClick={handleLoadDemo}>
            <Database className="size-3.5" aria-hidden="true" />
            Load demo data
          </Button>
        }
      />
    );
  }

  const sessions = new Set(enriched.map(sessionIdOf)).size;
  const states = new Set(enriched.map(stateOf)).size;
  const engagement = enriched.filter((window) => window.engagement != null).length;
  const gaze = enriched.filter((window) => window.gaze != null).length;
  const sensing = enriched.filter((window) => (
    window.heart_rate != null
    || window.respiration != null
    || window.facial != null
    || window.posture != null
  )).length;

  return (
    <div className="flex flex-col gap-6">
      <Section id="logs-overview" title="Log overview">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Metric label="Windows" value={enriched.length} tone="info" />
          <Metric label="Sessions" value={sessions} tone="info" />
          <Metric label="States" value={states} tone="info" />
          <Metric label="Engagement blocks" value={engagement} tone="info" />
          <Metric label="Gaze blocks" value={gaze} tone="info" />
          <Metric label="Sensing blocks" value={sensing} tone="info" />
        </div>
      </Section>
      <WindowLog windows={enriched} />
    </div>
  );
}
