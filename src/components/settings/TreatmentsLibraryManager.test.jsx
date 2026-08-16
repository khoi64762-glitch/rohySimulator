import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import TreatmentsLibraryManager, { bodyFromDraft, canEditRow } from './TreatmentsLibraryManager.jsx';

const toast = { success: vi.fn(), error: vi.fn() };

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
    ...platformRow, id: 3, treatment_type: 'oxygen', treatment_name: 'Nasal cannula 2L', route: 'inhaled', spo2_effect: 3,
};

let fetchSpy;
const callsTo = (pred) => fetchSpy.mock.calls.filter(([url]) => typeof url === 'string' && pred(url));

beforeEach(() => {
    mockUser = { id: 7, username: 'edu', role: 'educator', tenant_id: 1 };
    localStorage.setItem('token', 'edu-token');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init = {}) => {
        if (typeof url === 'string' && url.includes('/api/treatment-effects?include_inactive=1')) {
            return Promise.resolve(jsonResponse({ effects: [platformRow, tenantRow, otherRow] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/treatment-effects') && init.method === 'POST') {
            return Promise.resolve(jsonResponse({ effect: { ...tenantRow, id: 99 } }, { status: 201 }));
        }
        return Promise.resolve(jsonResponse({ effect: tenantRow }));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    window.confirm.mockRestore();
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
        fireEvent.click(screen.getByRole('button', { name: /IV Fluids \(1\)/ }));
        expect(screen.queryByText('Aspirin')).not.toBeInTheDocument();
        expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /All \(3\)/ }));
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

    it('deactivate calls DELETE and restore calls PUT /restore', async () => {
        renderIt();
        await screen.findByText('Aspirin');
        fireEvent.click(screen.getByRole('button', { name: /Deactivate Local Saline Bolus/ }));
        await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects/2')).length).toBe(1));
        expect(callsTo((u) => u.endsWith('/api/treatment-effects/2'))[0][1].method).toBe('DELETE');
    });

    it('shows an inactive row only when the toggle is on, with a Restore action', async () => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.includes('include_inactive')) {
                return Promise.resolve(jsonResponse({ effects: [platformRow, { ...tenantRow, is_active: 0 }] }));
            }
            return Promise.resolve(jsonResponse({ effect: tenantRow }));
        });
        renderIt();
        await screen.findByText('Aspirin');
        expect(screen.queryByText('Local Saline Bolus')).not.toBeInTheDocument();
        fireEvent.click(screen.getByLabelText(/Show deactivated/));
        expect(screen.getByText('Local Saline Bolus')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Restore Local Saline Bolus/ }));
        await waitFor(() => expect(callsTo((u) => u.endsWith('/api/treatment-effects/2/restore')).length).toBe(1));
        expect(callsTo((u) => u.endsWith('/api/treatment-effects/2/restore'))[0][1].method).toBe('PUT');
    });

    it('students see the educator-required notice and no fetch', async () => {
        mockUser = { id: 3, username: 'stu', role: 'student', tenant_id: 1 };
        renderIt();
        expect(await screen.findByText(/requires an educator or administrator/)).toBeInTheDocument();
        expect(callsTo((u) => u.includes('/api/treatment-effects')).length).toBe(0);
    });
});

describe('helpers', () => {
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
