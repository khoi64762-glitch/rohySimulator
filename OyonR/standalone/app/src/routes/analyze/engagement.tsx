import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { loadDemoData } from '@/legacy/demoFixture.js';
import OyonAttentionV2 from '@/components/oyon/OyonAttentionV2.jsx';
import { AttentionExperimentalPanels } from './attentionExperimental';

/*
 * Established engagement evidence leads; experimental attention episodes are
 * additive panels below it. One destination prevents two screens from telling
 * overlapping stories with different navigation labels.
 */
export function EngagementView() {
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
        description="Capture a real session, or load synthetic demo data (3 sessions × ~30 windows) to exercise every panel."
        action={
          <Button variant="primary" size="sm" onClick={handleLoadDemo}>
            <Database className="size-3.5" aria-hidden="true" />
            Load demo data
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <OyonAttentionV2 records={enriched} />
      <AttentionExperimentalPanels records={enriched} showSummary={false} />
    </div>
  );
}
