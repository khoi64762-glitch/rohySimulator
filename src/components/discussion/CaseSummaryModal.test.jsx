// Regression lock: case summary rendered every treatment name blank and no
// points/feedback debrief existed anywhere (bug report 2.9.15 #10)
//
// treatment_orders rows carry the name in `treatment_item`
// (migrations/0001_initial.sql), but the modal read `treatment_name` —
// SELECT * meant the field simply wasn't there and every ordered treatment
// rendered as an empty string. And although teachers configure points +
// feedback_if_ordered/feedback_if_missed, no surface ever showed the total
// or the texts. This suite locks:
//   1. a treatment_item row renders a non-blank name,
//   2. the debrief section renders total points, per-order feedback and the
//      missed-expected list from the /treatment-debrief payload,
//   3. while the server says pending, the missed list stays hidden behind
//      the pending message.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => apiFetchMock(...args),
}));

import CaseSummaryModal from './CaseSummaryModal.jsx';
import { renderWithProviders } from '../../../tests/utils/renderWithProviders.jsx';

const ACTIVE_CASE = { id: 'case-9', name: 'Chest Pain', config: {} };

function mockEndpoints({ debrief }) {
    apiFetchMock.mockImplementation((path) => {
        if (path.endsWith('/treatment-orders')) {
            // Shape of the real GET: SELECT * rows keyed treatment_item.
            return Promise.resolve({
                orders: [{ id: 1, treatment_item: 'Aspirin', dose: '300', route: 'PO' }],
            });
        }
        if (path.endsWith('/treatment-debrief')) {
            return Promise.resolve(debrief);
        }
        return Promise.resolve({});
    });
}

beforeEach(() => {
    apiFetchMock.mockReset();
});

describe('CaseSummaryModal — treatments debrief (bug report 2.9.15 #10)', () => {
    it('renders a non-blank treatment name from a treatment_item row', async () => {
        mockEndpoints({ debrief: { pending: false, total_points: 0, ordered: [], missed: [] } });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        // The column is treatment_item — reading treatment_name rendered ''.
        const name = await screen.findByText('Aspirin');
        expect(name.textContent).toBe('Aspirin');
    });

    it('renders total points, ordered feedback and the missed-expected list once the server unseals it', async () => {
        mockEndpoints({
            debrief: {
                pending: false,
                total_points: 100,
                ordered: [{ treatment_item: 'Aspirin', dose: '300', route: 'PO', points_awarded: 100, feedback: 'Good call — aspirin early.' }],
                missed: [{ treatment_name: 'Heparin', feedback_if_missed: 'Anticoagulation was expected.' }],
            },
        });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        expect(await screen.findByText('Treatments debrief')).toBeTruthy();
        expect(screen.getByText('Total points: 100')).toBeTruthy();
        expect(screen.getByText('+100 points')).toBeTruthy();
        expect(screen.getByText('Good call — aspirin early.')).toBeTruthy();
        expect(screen.getByText('Expected treatments not ordered')).toBeTruthy();
        expect(screen.getByText('Heparin')).toBeTruthy();
        expect(screen.getByText('Anticoagulation was expected.')).toBeTruthy();
    });

    it('keeps the missed list hidden behind the pending message while the session is live', async () => {
        mockEndpoints({
            debrief: {
                pending: true,
                total_points: 100,
                ordered: [{ treatment_item: 'Aspirin', dose: '300', route: 'PO', points_awarded: 100, feedback: null }],
                missed: [],
            },
        });
        renderWithProviders(
            <CaseSummaryModal activeCase={ACTIVE_CASE} sessionId="sess-1" onClose={() => {}} />
        );

        expect(await screen.findByText('Total points: 100')).toBeTruthy();
        expect(screen.getByText('Revealed when the session ends.')).toBeTruthy();
        expect(screen.queryByText('No expected treatments were missed.')).toBeNull();
    });
});
