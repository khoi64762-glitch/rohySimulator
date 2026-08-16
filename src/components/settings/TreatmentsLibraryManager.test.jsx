import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import TreatmentsLibraryManager, { bodyFromDraft, canEditRow, guessRouteFromName, prefillFromHit } from './TreatmentsLibraryManager.jsx';

const toast = { success: vi.fn(), error: vi.fn(), confirm: vi.fn() };

let mockUser = { id: 7, username: 'edu', role: 'educator', tenant_id: 1 };

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: mockUser, isAdmin: () => mockUser?.role === 'admin' }),
    };
});

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

const platformRow = {
    id: 1, treatment_type: 'medication', treatment_name: 'Aspirin', route: 'oral',
    onset_minutes: 15, peak_minutes: 60, duration_minutes: 240,
    hr_effect: 0, bp_sys_effect: 0, bp_dia_effect: 0, rr_effect: 0, spo2_effect: 0, temp_effect: 0, etco2_effect: 0,
    dose_dependent: 0, base_dose: null, base_dose_unit: null, max_effect_multiplier: 2,
    description: 'Antiplatelet', rxcui: '1191', is_active: 1, scope: 'platform', tenant_id: 1, created_by: null,
};
const tenantRow = {
    ...platformRow, id: 2, treatment_type: 'iv_fluid', treatment_name: 'Local Saline Bolus', route: 'IV',
    bp_sys_effect: 8, description: 'Tenant protocol', rxcui: null, scope: 'tenant', tenant_id: 1, created_by: 7,
};
const otherRow = {
    ...platformRow, id: 3, treatment_type: 'oxygen', treatment_name: 'Nasal cannula 2L', route: 'inhaled', spo2_effect: 3, rxcui: null,
};

// What /catalogue/medications/search returns (rxnorm hits already sorted
// IN-first by the server; openFDA hit appended). Aspirin's rxcui 1191 is
// already in the library (platformRow).
const searchHits = [
    { external_source: 'rxnorm', external_id: '2193', rxcui: '2193', display_name: 'ceftriaxone', score: 12.6, synonym: null, tty: 'IN', name_source: 'properties' },
    { external_source: 'rxnorm', external_id: '1665021', rxcui: '1665021', display_name: 'ceftriaxone 1000 MG Injection', score: 12.1, synonym: null, tty: 'SCD', name_source: 'approximateTerm' },
    { external_source: 'rxnorm', external_id: '1191', rxcui: '1191', display_name: 'aspirin', score: 9, synonym: null, tty: 'IN', name_source: 'approximateTerm' },
    { external_source: 'openfda', external_id: 'set-1', rxcui: null, display_name: 'ROCEPHIN', generic_name: 'CEFTRIAXONE SODIUM', brand_name: 'ROCEPHIN' },
];

let fetchSpy;
const callsTo = (pred) => fetchSpy.mock.calls.filter(([url]) => typeof url === 'string' && pred(url));

beforeEach(() => {
    mockUser = { id: 7, username: 'edu', role: 'educator', tenant_id: 1 };
    localStorage.setItem('token', 'edu-token');
    toast.confirm.mockResolvedValue(true);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init = {}) => {
        if (typeof url === 'string' && url.includes('/api/treatment-effects?include_inactive=1')) {
            return Promise.resolve(jsonResponse({ effects: [platformRow, tenantRow, otherRow] }));
        }
        if (typeof url === 'string' && url.includes('/api/catalogue/medications/search')) {
            return Promise.resolve(jsonResponse({ q: 'x', hits: searchHits, errors: [], sources: ['rxnorm', 'openfda'] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/treatment-effects') && init.method === 'POST') {
            return Promise.resolve(jsonResponse({ effect: { ...tenantRow, id: 99 } }, { status: 201 }));
        }
        return Promise.resolve(jsonResponse({ effect: tenantRow }));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

const renderIt = () => renderWithProviders(<TreatmentsLibraryManager />, {
    withAuth: false, withNotifications: false, withToast: false,
});

describe('TreatmentsLibraryManager', () => {
    it('renders every visible row with type, route and scope badges', async () => {
        renderIt();
        expect(await screen.findByText('Aspirin')).toBeInTheDocument();
        expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
        expect(screen.getByText('Nasal cannula 2L')).toBeInTheDocument();

        const [url, init] = callsTo((u) => u.includes('/api/treatment-effects'))[0];
        expect(url).toBe('/api/treatment-effects?include_inactive=1');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer edu-token' });

        const saline = screen.getByTestId('tl-row-2');
        expect(within(saline).getByText('Tenant')).toBeInTheDocument();
        expect(within(saline).getByText('SBP +8')).toBeInTheDocument();
        const aspirin = screen.getByTestId('tl-row-1');
        expect(within(aspirin).getByText('Platform')).toBeInTheDocument();
    });

    it('type filter pills narrow the table', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        const typeGroup = screen.getByRole('group', { name: 'Type' });
        fireEvent.click(within(typeGroup).getByRole('button', { name: /IV Fluids \(1\)/ }));
        expect(screen.queryByText('Aspirin')).not.toBeInTheDocument();
        expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
        fireEvent.click(within(typeGroup).getByRole('button', { name: /All \(3\)/ }));
        expect(screen.getByText('Aspirin')).toBeInTheDocument();
    });

    it('search narrows by name / description', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.change(screen.getByPlaceholderText(/Search by name/), { target: { value: 'protocol' } });
        expect(screen.queryByText('Aspirin')).not.toBeInTheDocument();
        expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
    });

    it('platform rows are read-only for an educator; own tenant rows are editable', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        const aspirin = screen.getByTestId('tl-row-1');
        expect(within(aspirin).getByText('Read-only')).toBeInTheDocument();
        expect(within(aspirin).queryByRole('button', { name: /Edit Aspirin/ })).not.toBeInTheDocument();

        const saline = screen.getByTestId('tl-row-2');
        expect(within(saline).getByRole('button', { name: /Edit Local Saline Bolus/ })).toBeInTheDocument();
        expect(within(saline).getByRole('button', { name: /Deactivate Local Saline Bolus/ })).toBeInTheDocument();
    });

    it('admins can edit platform rows', async () => {
        mockUser = { id: 1, username: 'admin', role: 'admin', tenant_id: 1 };
        renderIt();
        await screen.findByText('Aspirin');
        const aspirin = screen.getByTestId('tl-row-1');
        expect(within(aspirin).getByRole('button', { name: /Edit Aspirin/ })).toBeInTheDocument();
        expect(within(aspirin).queryByText('Read-only')).not.toBeInTheDocument();
    });

    it('the add form posts the typed body (numbers as numbers, dose flag as boolean)', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Add treatment/ }));
        const dialog = await screen.findByRole('dialog');

        const q = (name) => dialog.querySelector(`[name="${name}"]`);
        fireEvent.change(q('treatment_type'), { target: { value: 'medication' } });
        fireEvent.change(q('treatment_name'), { target: { value: '  Metoprolol  ' } });
        fireEvent.change(q('route'), { target: { value: 'IV' } });
        fireEvent.change(q('onset_minutes'), { target: { value: '2' } });
        fireEvent.change(q('peak_minutes'), { target: { value: '5' } });
        fireEvent.change(q('duration_minutes'), { target: { value: '30' } });
        fireEvent.change(q('hr_effect'), { target: { value: '-12' } });
        fireEvent.change(q('bp_sys_effect'), { target: { value: '-10' } });
        fireEvent.click(q('dose_dependent'));
        fireEvent.change(q('base_dose'), { target: { value: '5' } });
        fireEvent.change(q('base_dose_unit'), { target: { value: 'mg' } });
        fireEvent.change(q('rxcui'), { target: { value: '6918' } });
        fireEvent.change(q('pk_evidence_url'), { target: { value: 'https://example.org/pk' } });

        // Educators get no scope picker — the server forces 'tenant'.
        expect(q('scope')).toBeNull();

        fireEvent.click(within(dialog).getAllByRole('button', { name: /Add treatment/ }).at(-1));

        await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects')).length).toBe(1));
        const [, init] = callsTo((u) => u.endsWith('/api/treatment-effects'))[0];
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toMatchObject({
            treatment_type: 'medication',
            treatment_name: 'Metoprolol',
            route: 'IV',
            onset_minutes: 2,
            peak_minutes: 5,
            duration_minutes: 30,
            hr_effect: -12,
            bp_sys_effect: -10,
            dose_dependent: true,
            base_dose: 5,
            base_dose_unit: 'mg',
            rxcui: '6918',
            pk_evidence_url: 'https://example.org/pk',
        });
        expect(JSON.parse(init.body).scope).toBeUndefined();
        await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it('admins get a scope picker and it rides along in the POST body', async () => {
        mockUser = { id: 1, username: 'admin', role: 'admin', tenant_id: 1 };
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Add treatment/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(dialog.querySelector('[name="treatment_name"]'), { target: { value: 'Platformol' } });
        fireEvent.change(dialog.querySelector('[name="scope"]'), { target: { value: 'tenant' } });
        fireEvent.click(within(dialog).getAllByRole('button', { name: /Add treatment/ }).at(-1));
        await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects')).length).toBe(1));
        const [, init] = callsTo((u) => u.endsWith('/api/treatment-effects'))[0];
        expect(JSON.parse(init.body)).toMatchObject({ treatment_name: 'Platformol', scope: 'tenant' });
    });

    it('surfaces the server 409 message inside the dialog', async () => {
        fetchSpy.mockImplementation((url, init = {}) => {
            if (typeof url === 'string' && url.includes('include_inactive')) {
                return Promise.resolve(jsonResponse({ effects: [platformRow] }));
            }
            if (init.method === 'POST') {
                return Promise.resolve(jsonResponse({ error: 'A treatment named "Aspirin" already exists.', code: 'duplicate_treatment' }, { status: 409 }));
            }
            return Promise.resolve(jsonResponse({}));
        });
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Add treatment/ }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.change(dialog.querySelector('[name="treatment_name"]'), { target: { value: 'Aspirin' } });
        fireEvent.click(within(dialog).getAllByRole('button', { name: /Add treatment/ }).at(-1));
        expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already exists/);
    });

    it('deactivate asks through toast.confirm (danger) and then calls DELETE', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Deactivate Local Saline Bolus/ }));
        await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects/2')).length).toBe(1));
        expect(callsTo((u) => u.endsWith('/api/treatment-effects/2'))[0][1].method).toBe('DELETE');
        expect(toast.confirm).toHaveBeenCalledWith(
            expect.stringContaining('Local Saline Bolus'),
            expect.objectContaining({ type: 'danger' }),
        );
    });

    it('a declined confirm does not DELETE', async () => {
        toast.confirm.mockResolvedValue(false);
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Deactivate Local Saline Bolus/ }));
        await waitFor(() => expect(toast.confirm).toHaveBeenCalled());
        expect(callsTo((u) => u.endsWith('/api/treatment-effects/2')).length).toBe(0);
    });

    describe('status segment', () => {
        const rowsWithInactive = [platformRow, { ...tenantRow, is_active: 0 }, otherRow];
        beforeEach(() => {
            fetchSpy.mockImplementation((url) => {
                if (typeof url === 'string' && url.includes('include_inactive')) {
                    return Promise.resolve(jsonResponse({ effects: rowsWithInactive }));
                }
                return Promise.resolve(jsonResponse({ effect: tenantRow }));
            });
        });
        const statusGroup = () => screen.getByRole('group', { name: 'Status' });
        const typeGroup = () => screen.getByRole('group', { name: 'Type' });

        it('defaults to Active; Deactivated view lists only inactive rows with badge + Restore; All shows both', async () => {
            // Regression lock: "Show deactivated" toggle read as a no-op — it
            // mixed inactive rows into the active list and the counts ignored
            // them. The status segment gives deactivated rows their own view.
            renderIt();
            await screen.findByText('Aspirin');
            expect(within(statusGroup()).getByRole('button', { name: 'Active (2)' })).toHaveAttribute('aria-pressed', 'true');
            expect(within(statusGroup()).getByRole('button', { name: 'Deactivated (1)' })).toBeInTheDocument();
            expect(within(statusGroup()).getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
            expect(screen.queryByText('Local Saline Bolus')).not.toBeInTheDocument();

            fireEvent.click(within(statusGroup()).getByRole('button', { name: 'Deactivated (1)' }));
            expect(screen.queryByText('Aspirin')).not.toBeInTheDocument();
            expect(screen.queryByText('Nasal cannula 2L')).not.toBeInTheDocument();
            const saline = screen.getByTestId('tl-row-2');
            expect(within(saline).getByText('Deactivated')).toBeInTheDocument();
            expect(within(saline).getByRole('button', { name: /Restore Local Saline Bolus/ })).toBeInTheDocument();
            expect(within(saline).queryByRole('button', { name: /Deactivate Local Saline Bolus/ })).not.toBeInTheDocument();

            fireEvent.click(within(statusGroup()).getByRole('button', { name: 'All (3)' }));
            expect(screen.getByText('Aspirin')).toBeInTheDocument();
            expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
            expect(screen.getByText('Nasal cannula 2L')).toBeInTheDocument();
        });

        it('type pill counts follow the status view', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            expect(within(typeGroup()).getByRole('button', { name: /All \(2\)/ })).toBeInTheDocument();
            expect(within(typeGroup()).getByRole('button', { name: /IV Fluids \(0\)/ })).toBeInTheDocument();
            fireEvent.click(within(statusGroup()).getByRole('button', { name: 'Deactivated (1)' }));
            expect(within(typeGroup()).getByRole('button', { name: /All \(1\)/ })).toBeInTheDocument();
            expect(within(typeGroup()).getByRole('button', { name: /IV Fluids \(1\)/ })).toBeInTheDocument();
            expect(within(typeGroup()).getByRole('button', { name: /Medications \(0\)/ })).toBeInTheDocument();
            fireEvent.click(within(statusGroup()).getByRole('button', { name: 'All (3)' }));
            expect(within(typeGroup()).getByRole('button', { name: /All \(3\)/ })).toBeInTheDocument();
        });

        it('Restore from the Deactivated view calls PUT /restore', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.click(within(statusGroup()).getByRole('button', { name: 'Deactivated (1)' }));
            fireEvent.click(screen.getByRole('button', { name: /Restore Local Saline Bolus/ }));
            await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects/2/restore')).length).toBe(1));
            expect(callsTo((u) => u.endsWith('/api/treatment-effects/2/restore'))[0][1].method).toBe('PUT');
        });
    });

    describe('add from RxNorm / openFDA', () => {
        const searchBox = () => screen.getByPlaceholderText(/Search RxNorm \/ openFDA/);
        const searchCalls = () => callsTo((u) => u.includes('/api/catalogue/medications/search'));

        it('does not search under 2 characters; searches debounced with both sources', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'c' } });
            expect(await screen.findByText(/Type at least 2 characters/)).toBeInTheDocument();
            await new Promise((r) => setTimeout(r, 500));
            expect(searchCalls().length).toBe(0);

            fireEvent.change(searchBox(), { target: { value: 'ceftr' } });
            await screen.findByTestId('tl-external-hits');
            expect(searchCalls().length).toBe(1);
            const [url] = searchCalls()[0];
            expect(url).toContain('/api/catalogue/medications/search?q=ceftr');
            expect(url).toContain('sources=rxnorm,openfda');
        });

        it('lists name, term type, RxCUI and source per hit', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'ceftriaxone' } });
            const list = await screen.findByTestId('tl-external-hits');
            const ingredient = within(list).getByTestId('tl-hit-rxnorm-2193');
            expect(within(ingredient).getByText('ceftriaxone')).toBeInTheDocument();
            expect(within(ingredient).getByText('Ingredient')).toBeInTheDocument();
            expect(within(ingredient).getByText('RxCUI 2193')).toBeInTheDocument();
            expect(within(ingredient).getByText('RxNorm')).toBeInTheDocument();
            const scd = within(list).getByTestId('tl-hit-rxnorm-1665021');
            expect(within(scd).getByText('Clinical drug')).toBeInTheDocument();
            const fda = within(list).getByTestId('tl-hit-openfda-set-1');
            expect(within(fda).getByText('ROCEPHIN')).toBeInTheDocument();
            expect(within(fda).getByText('openFDA')).toBeInTheDocument();
            expect(within(fda).getByText('FDA label')).toBeInTheDocument();
        });

        it('picking a hit opens the add editor prefilled with name, rxcui and route guess, effects at zero', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'ceftriaxone' } });
            const list = await screen.findByTestId('tl-external-hits');
            fireEvent.click(within(list).getByRole('button', { name: 'Add ceftriaxone 1000 MG Injection' }));
            const dialog = await screen.findByRole('dialog');
            const q = (name) => dialog.querySelector(`[name="${name}"]`);
            expect(q('treatment_name').value).toBe('ceftriaxone 1000 MG Injection');
            expect(q('rxcui').value).toBe('1665021');
            expect(q('route').value).toBe('IV');
            expect(q('treatment_type').value).toBe('medication');
            expect(q('hr_effect').value).toBe('0');
            expect(q('bp_sys_effect').value).toBe('0');
            expect(within(dialog).getByTestId('tl-prefill-hint')).toHaveTextContent(/Effects default to none/);

            fireEvent.click(within(dialog).getAllByRole('button', { name: /Add treatment/ }).at(-1));
            await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects')).length).toBe(1));
            const [, init] = callsTo((u) => u.endsWith('/api/treatment-effects'))[0];
            expect(JSON.parse(init.body)).toMatchObject({
                treatment_type: 'medication', treatment_name: 'ceftriaxone 1000 MG Injection', rxcui: '1665021', route: 'IV',
                hr_effect: 0, bp_sys_effect: 0, spo2_effect: 0,
            });
        });

        it('an ingredient hit prefills a blank route; an openFDA hit uses the generic name', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'ceftriaxone' } });
            const list = await screen.findByTestId('tl-external-hits');
            fireEvent.click(within(list).getByRole('button', { name: 'Add ceftriaxone' }));
            let dialog = await screen.findByRole('dialog');
            expect(dialog.querySelector('[name="treatment_name"]').value).toBe('ceftriaxone');
            expect(dialog.querySelector('[name="rxcui"]').value).toBe('2193');
            expect(dialog.querySelector('[name="route"]').value).toBe('');
            fireEvent.click(within(dialog).getAllByRole('button', { name: /Cancel/ }).at(-1));

            fireEvent.click(within(list).getByRole('button', { name: 'Add ROCEPHIN' }));
            dialog = await screen.findByRole('dialog');
            expect(dialog.querySelector('[name="treatment_name"]').value).toBe('CEFTRIAXONE SODIUM');
            expect(dialog.querySelector('[name="rxcui"]').value).toBe('');
        });

        it('marks hits already in the library and offers Open, which filters the table to that row', async () => {
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'aspirin' } });
            const list = await screen.findByTestId('tl-external-hits');
            const hit = within(list).getByTestId('tl-hit-rxnorm-1191');
            expect(within(hit).getByText('In library')).toBeInTheDocument();
            expect(within(hit).queryByRole('button', { name: /^Add / })).not.toBeInTheDocument();
            fireEvent.click(within(hit).getByRole('button', { name: 'Open aspirin' }));
            expect(screen.getByPlaceholderText(/Search by name/).value).toBe('Aspirin');
            expect(screen.getByTestId('tl-row-1')).toBeInTheDocument();
            expect(screen.queryByTestId('tl-row-2')).not.toBeInTheDocument();
        });

        it('shows the empty state and an error state', async () => {
            fetchSpy.mockImplementation((url) => {
                if (typeof url === 'string' && url.includes('include_inactive')) {
                    return Promise.resolve(jsonResponse({ effects: [platformRow] }));
                }
                if (typeof url === 'string' && url.includes('/api/catalogue/medications/search?q=nothing')) {
                    return Promise.resolve(jsonResponse({ q: 'nothing', hits: [], errors: [], sources: [] }));
                }
                return Promise.resolve(jsonResponse({ error: 'upstream down' }, { status: 502 }));
            });
            renderIt();
            await screen.findByText('Aspirin');
            fireEvent.change(searchBox(), { target: { value: 'nothing' } });
            expect(await screen.findByText(/No matches in RxNorm/)).toBeInTheDocument();
            fireEvent.change(searchBox(), { target: { value: 'boom' } });
            expect(await screen.findByRole('alert')).toHaveTextContent(/External search failed/);
        });
    });

    it('students see the educator-required notice and no fetch', async () => {
        mockUser = { id: 3, username: 'stu', role: 'student', tenant_id: 1 };
        renderIt();
        expect(await screen.findByText(/requires an educator or administrator/)).toBeInTheDocument();
        expect(callsTo((u) => u.includes('/api/treatment-effects')).length).toBe(0);
    });
});

describe('helpers', () => {
    it('guessRouteFromName maps only unambiguous dose forms', () => {
        expect(guessRouteFromName('ceftriaxone 1000 MG Injection')).toBe('IV');
        expect(guessRouteFromName('morphine sulfate 10 MG/ML Injectable Solution')).toBe('IV');
        expect(guessRouteFromName('metoprolol tartrate 50 MG Oral Tablet')).toBe('oral');
        expect(guessRouteFromName('amoxicillin 500 MG Oral Capsule')).toBe('oral');
        expect(guessRouteFromName('albuterol 0.09 MG/ACTUAT Inhalant')).toBe('inhaled');
        expect(guessRouteFromName('nitroglycerin 0.4 MG Sublingual Tablet')).toBe('');
        expect(guessRouteFromName('ceftriaxone')).toBe('');
        expect(guessRouteFromName(null)).toBe('');
    });

    it('prefillFromHit builds a medication draft with name, rxcui and route', () => {
        expect(prefillFromHit({ external_source: 'rxnorm', rxcui: '2193', display_name: 'ceftriaxone', tty: 'IN' }))
            .toEqual({ treatment_type: 'medication', treatment_name: 'ceftriaxone', rxcui: '2193', route: '' });
        expect(prefillFromHit({ external_source: 'openfda', rxcui: null, display_name: 'ROCEPHIN', generic_name: 'CEFTRIAXONE SODIUM' }))
            .toEqual({ treatment_type: 'medication', treatment_name: 'CEFTRIAXONE SODIUM', rxcui: '', route: '' });
    });

    it('canEditRow mirrors the server rule', () => {
        expect(canEditRow({ role: 'educator', tenant_id: 1 }, { scope: 'platform', tenant_id: 1 })).toBe(false);
        expect(canEditRow({ role: 'admin', tenant_id: 1 }, { scope: 'platform', tenant_id: 1 })).toBe(true);
        expect(canEditRow({ role: 'educator', tenant_id: 1 }, { scope: 'tenant', tenant_id: 1 })).toBe(true);
        expect(canEditRow({ role: 'educator', tenant_id: 2 }, { scope: 'tenant', tenant_id: 1 })).toBe(false);
    });

    it('bodyFromDraft turns blanks into null and strings into numbers', () => {
        const body = bodyFromDraft({
            treatment_type: 'nursing', treatment_name: ' Reposition ', route: '', onset_minutes: '0',
            peak_minutes: '1', duration_minutes: '5', hr_effect: '', bp_sys_effect: '2', bp_dia_effect: '',
            rr_effect: '', spo2_effect: '', temp_effect: '', etco2_effect: '', dose_dependent: false,
            base_dose: '', base_dose_unit: '', max_effect_multiplier: '', description: '', rxcui: '',
            pk_source: '', pk_evidence_url: '',
        });
        expect(body).toMatchObject({
            treatment_name: 'Reposition', route: null, onset_minutes: 0, hr_effect: 0, bp_sys_effect: 2,
            base_dose: null, max_effect_multiplier: 2, description: null,
        });
    });
});
