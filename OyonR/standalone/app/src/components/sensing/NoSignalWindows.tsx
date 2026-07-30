import { useQueryClient } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { STORED_WINDOWS_QUERY_KEY } from '@/lib/storedWindows';
import { loadDemoData } from '@/legacy/demoFixture.js';

/*
 * Shared empty state for the sensing tabs. Both Position and Heart rate are
 * opt-in pipelines, so "nothing here" almost always means the setting is off
 * rather than that the capture failed — say which setting, and offer synthetic
 * data so the screen can be explored without a camera.
 */
export function NoSignalWindows({ title, description }: { title: string; description: string }) {
  const queryClient = useQueryClient();

  function handleLoadDemo() {
    loadDemoData();
    queryClient.invalidateQueries({ queryKey: STORED_WINDOWS_QUERY_KEY });
  }

  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <Button variant="primary" size="sm" onClick={handleLoadDemo}>
          <Database className="size-3.5" aria-hidden="true" />
          Load demo data
        </Button>
      }
    />
  );
}
