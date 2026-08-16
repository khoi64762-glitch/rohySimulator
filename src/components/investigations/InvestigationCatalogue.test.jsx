// Contract for InvestigationCatalogue's radiology family filter — the
// All | Imaging | Diagnostics segment that makes the diagnostic tests
// (12-lead ECG, Holter, echo, cath — stored under the 'Cardiac' modality)
// discoverable inside the "Radiology & diagnostics" room without a new
// room. Labs get no segment; stored modality strings stay English while
// the visible group labels are translated.

import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import InvestigationCatalogue from './InvestigationCatalogue';

const theme = {
    kindIcon: () => null,
    accentText: 'text-cyan-300',
    accentBg: 'bg-cyan-600',
    accentRow: 'bg-cyan-900/30',
    accentRail: 'border-l-cyan-500',
    accentChip: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
};

// Shape of the items InvestigationsScreen derives from
// GET /sessions/:id/available-radiology (`test_group` = stored modality).
const radiologyItems = [
    { id: 'ecg_12lead', test_name: '12-Lead ECG', test_group: 'Cardiac', turnaround_minutes: 5, body_region: 'Chest' },
    { id: 'echo_tte', test_name: 'Transthoracic Echo', test_group: 'Cardiac', turnaround_minutes: 30, body_region: 'Chest' },
    { id: 'ct_head', test_name: 'CT Head', test_group: 'CT', turnaround_minutes: 20, body_region: 'Head' },
    { id: 'xray_chest', test_name: 'Chest X-Ray', test_group: 'X-Ray', turnaround_minutes: 10, body_region: 'Chest' },
    { id: 'dexa_spine', test_name: 'DEXA Bone Density', test_group: 'DEXA', turnaround_minutes: 30, body_region: 'Spine' },
];
const radiologyGroups = ['CT', 'Cardiac', 'DEXA', 'X-Ray'];

function Harness({ kind = 'radiology', items = radiologyItems, groups = radiologyGroups, withFamily = true }) {
    const [groupFilter, setGroupFilter] = useState('all');
    const [familyFilter, setFamilyFilterState] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const setFamilyFilter = (family) => { setFamilyFilterState(family); setGroupFilter('all'); };
    return (
        <InvestigationCatalogue
            kind={kind}
            theme={theme}
            items={items}
            groups={groups}
            orders={[]}
            selectedIds={[]}
            onToggleSelect={vi.fn()}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            groupFilter={groupFilter}
            onGroupFilterChange={setGroupFilter}
            familyFilter={withFamily ? familyFilter : undefined}
            onFamilyFilterChange={withFamily ? setFamilyFilter : undefined}
            loading={false}
            onSubmit={vi.fn()}
        />
    );
}

const rowNames = () => screen.queryAllByRole('checkbox').map((box) => box.closest('label').textContent);

afterEach(() => cleanup());

describe('InvestigationCatalogue — radiology family filter', () => {
    it('renders All | Imaging | Diagnostics chips with counts for radiology', () => {
        render(<Harness />);
        const group = screen.getByRole('radiogroup', { name: /filter studies by type/i });
        const chips = within(group).getAllByRole('radio');
        expect(chips.map((chip) => chip.textContent)).toEqual(['All5', 'Imaging3', 'Diagnostics2']);
        expect(chips[0].getAttribute('aria-checked')).toBe('true');
    });

    it('Diagnostics shows only Cardiac studies; Imaging hides them; All restores', () => {
        render(<Harness />);
        expect(rowNames()).toHaveLength(5);

        fireEvent.click(screen.getByRole('radio', { name: /Diagnostics/ }));
        const diagnostic = rowNames();
        expect(diagnostic).toHaveLength(2);
        expect(diagnostic.join(' ')).toMatch(/12-Lead ECG/);
        expect(diagnostic.join(' ')).toMatch(/Transthoracic Echo/);
        expect(diagnostic.join(' ')).not.toMatch(/CT Head|Chest X-Ray|DEXA/);
        // The group dropdown only offers diagnostic modalities now.
        const options = within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent);
        expect(options).toEqual(['All groups', 'Cardiac (2)']);

        fireEvent.click(screen.getByRole('radio', { name: /Imaging/ }));
        const imaging = rowNames();
        expect(imaging).toHaveLength(3);
        expect(imaging.join(' ')).not.toMatch(/ECG|Echo/);

        fireEvent.click(screen.getByRole('radio', { name: /All/ }));
        expect(rowNames()).toHaveLength(5);
    });

    it('arrow keys move the active chip (roving radiogroup)', () => {
        render(<Harness />);
        const group = screen.getByRole('radiogroup', { name: /filter studies by type/i });
        fireEvent.keyDown(group, { key: 'ArrowRight' });
        expect(screen.getByRole('radio', { name: /Imaging/ }).getAttribute('aria-checked')).toBe('true');
        expect(rowNames()).toHaveLength(3);
        fireEvent.keyDown(group, { key: 'ArrowLeft' });
        expect(screen.getByRole('radio', { name: /All/ }).getAttribute('aria-checked')).toBe('true');
    });

    it('group headers and dropdown show translated modality labels while values stay stored strings', () => {
        render(<Harness />);
        const options = within(screen.getByRole('combobox')).getAllByRole('option');
        const dexa = options.find((o) => o.textContent.startsWith('DEXA'));
        expect(dexa.value).toBe('DEXA');
        // Header rows render the label (English == stored value here, but
        // through the label map — the en catalogue owns the string).
        expect(screen.getByText('Cardiac', { selector: 'span' })).toBeInTheDocument();
    });

    it('lab catalogue renders no family segment', () => {
        render(<Harness kind="lab" items={[{ id: 1, test_name: 'CBC', test_group: 'Hematology' }]} groups={['Hematology']} withFamily={false} />);
        expect(screen.queryByRole('radiogroup')).toBeNull();
        expect(rowNames()).toHaveLength(1);
    });
});
