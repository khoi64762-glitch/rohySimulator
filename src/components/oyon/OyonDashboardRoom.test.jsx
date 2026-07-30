// Contract for the named Oyon dashboard surface.
//
// This surface is an ADDITION: it renders OYON's own Analyze dashboards
// (OyonServerDashboards → <oyon-app chrome="none">) over server rows, beside
// Rohy's existing Emotion Analytics route rather than replacing it. What matters
// here is that authorization stays server-side (the component only calls Rohy's
// API), that a failed signal-windows probe cannot blank the dashboard, and that
// the modality summary from migration 0039 reaches the UI.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k, opts) => (opts?.count != null ? `${k}:${opts.count}` : k) }),
}));

const apiFetch = vi.fn();
vi.mock('../../services/apiClient', () => ({ apiFetch: (...a) => apiFetch(...a) }));

// The real child loads a ~5 MB web-component bundle; stub it and assert the
// records it is handed instead.
const dashboardProps = vi.fn();
vi.mock('./OyonServerDashboards', () => ({
    default: (props) => {
        dashboardProps(props);
        return <div data-testid="oyon-dashboards">{(props.records || []).length} rows</div>;
    },
}));

const OyonDashboardRoom = (await import('./OyonDashboardRoom')).default;

function record(i) {
    return { record_id: `r${i}`, window_start: `2026-07-02T08:0${i}:00.000Z`, dominant_emotion: 'neutral' };
}

beforeEach(() => {
    apiFetch.mockReset();
    dashboardProps.mockReset();
});

describe('OyonDashboardRoom', () => {
    it('feeds fetched emotion records into Oyon\'s own dashboards', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1), record(2)], total: 2 });
            }
            return Promise.resolve({ modalities: [] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('oyon-dashboards')).toHaveTextContent('2 rows'));
        expect(dashboardProps).toHaveBeenCalled();
    });

    it('surfaces the modality summary from the signal-windows endpoint', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1)], total: 1 });
            }
            return Promise.resolve({ modalities: [{ modality: 'facial', count: 12 }] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('facial · 12')).toBeInTheDocument());
    });

    // A failed advisory probe must not take the dashboard down with it.
    it('still renders the dashboard when the signal-windows probe fails', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.resolve({ records: [record(1)], total: 1 });
            }
            return Promise.reject(new Error('signal windows exploded'));
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByTestId('oyon-dashboards')).toBeInTheDocument());
        expect(screen.queryByText('oyon_dashboard_load_failed')).not.toBeInTheDocument();
    });

    it('reports a records-fetch failure instead of rendering an empty dashboard', async () => {
        apiFetch.mockImplementation((url) => {
            if (url.startsWith('/addons/oyon/emotion-records')) {
                return Promise.reject(new Error('403 Access denied'));
            }
            return Promise.resolve({ modalities: [] });
        });

        render(<OyonDashboardRoom onClose={() => {}} />);
        await waitFor(() => expect(screen.getByText('oyon_dashboard_load_failed')).toBeInTheDocument());
        expect(screen.getByText('403 Access denied')).toBeInTheDocument();
        expect(screen.queryByTestId('oyon-dashboards')).not.toBeInTheDocument();
    });
});
