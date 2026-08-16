import React, { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import RadiologyEditor from './RadiologyEditor.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useToast: () => toast,
    };
});

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

const study = {
    id: 11,
    name: 'Chest X-Ray',
    modality: 'X-Ray',
    body_region: 'Chest',
    turnaround_minutes: 15,
};

let fetchSpy;

function mount(initialRadiology = []) {
    const captured = { current: null };
    function Harness() {
        const [caseData, setCaseData] = useState({
            id: 'case-1',
            config: { radiology: initialRadiology },
        });
        useEffect(() => {
            captured.current = caseData;
        }, [caseData]);
        return (
            <RadiologyEditor
                caseData={caseData}
                setCaseData={(updater) => setCaseData(prev => typeof updater === 'function' ? updater(prev) : updater)}
            />
        );
    }

    const utils = renderWithProviders(
        <Harness />,
        { withAuth: false, withNotifications: false, withToast: false }
    );
    return { ...utils, captured };
}

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
            return Promise.resolve(jsonResponse({ studies: [study], modalities: ['X-Ray'] }));
        }
        if (typeof url === 'string' && url.endsWith('/api/upload')) {
            return Promise.resolve(jsonResponse({ imageUrl: '/uploads/cxr.png' }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('RadiologyEditor apiFetch migration', () => {
    it('loads radiology studies with bearer auth and the correct path', async () => {
        mount();

        expect(await screen.findByText('Chest X-Ray')).toBeInTheDocument();

        const [url, init] = fetchSpy.mock.calls.find(([callUrl]) =>
            typeof callUrl === 'string' && callUrl.endsWith('/api/radiology-database')
        );
        expect(url).toBe('/api/radiology-database');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });

    it('POSTs uploaded result images as FormData and stores the returned URL', async () => {
        const { captured } = mount([{
            id: 1,
            studyId: 11,
            studyName: 'Chest X-Ray',
            modality: 'X-Ray',
            bodyRegion: 'Chest',
            turnaroundMinutes: 15,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
        }]);

        await screen.findByText('Chest X-Ray');
        const uploadLabel = screen.getByText(/upload image/i);
        const input = uploadLabel.closest('label').querySelector('input[type="file"]');
        const file = new File(['png'], 'cxr.png', { type: 'image/png' });
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() => {
            expect(fetchSpy.mock.calls.some(([url, init]) => url === '/api/upload' && init?.method === 'POST')).toBe(true);
        });

        const [, init] = fetchSpy.mock.calls.find(([url, callInit]) => url === '/api/upload' && callInit?.method === 'POST');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
        expect(init.body).toBeInstanceOf(FormData);
        expect(init.body.get('photo')).toBe(file);

        await waitFor(() => {
            expect(captured.current.config.radiology[0].imageUrl).toBe('/uploads/cxr.png');
        });
        expect(toast.success).toHaveBeenCalledWith('Image uploaded successfully');
    });

    it('surfaces the master normal_findings / normal_interpretation defaults at edit time', async () => {
        // Regression for "the IMPRESSION text in the rendered report wasn't
        // visible when editing the case". Master JSON ships normal_findings +
        // normal_interpretation; the server falls back to them when the case
        // config left those fields empty. Editor used to render empty
        // textareas with generic placeholders, leaving admins unable to see
        // (let alone edit) the text that would appear in the report.
        const studyWithDefaults = {
            ...study,
            normal_findings: 'Lungs clear. No effusion.',
            normal_interpretation: '1. No acute cardiopulmonary disease.',
        };
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
                return Promise.resolve(jsonResponse({ studies: [studyWithDefaults], modalities: ['X-Ray'] }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        const { captured } = mount([{
            id: 1,
            studyId: 11,
            studyName: 'Chest X-Ray',
            modality: 'X-Ray',
            bodyRegion: 'Chest',
            turnaroundMinutes: 15,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
            isCustom: false,
        }]);

        // Wait for master DB to load — the existing study row only knows the
        // defaults after `studies` populates from /api/radiology-database.
        await waitFor(() => {
            const findingsBox = screen.getByPlaceholderText('Lungs clear. No effusion.');
            expect(findingsBox).toBeInTheDocument();
            const interpBox = screen.getByPlaceholderText('1. No acute cardiopulmonary disease.');
            expect(interpBox).toBeInTheDocument();
        });

        // Two "Use default" affordances — one per empty field.
        const useDefaultButtons = screen.getAllByRole('button', { name: /use default/i });
        expect(useDefaultButtons).toHaveLength(2);

        // Clicking the first ("Findings") copies the master default into the
        // case config so the admin can edit it from there.
        fireEvent.click(useDefaultButtons[0]);
        await waitFor(() => {
            expect(captured.current.config.radiology[0].findings).toBe('Lungs clear. No effusion.');
        });
        // Interpretation still empty until its own button fires.
        expect(captured.current.config.radiology[0].interpretation).toBe('');
    });

    it('surfaces an API error toast when image upload fails', async () => {
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
                return Promise.resolve(jsonResponse({ studies: [study], modalities: ['X-Ray'] }));
            }
            if (typeof url === 'string' && url.endsWith('/api/upload')) {
                return Promise.resolve(jsonResponse({ error: 'forbidden' }, { status: 403 }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        mount([{
            id: 1,
            studyId: 11,
            studyName: 'Chest X-Ray',
            modality: 'X-Ray',
            bodyRegion: 'Chest',
            turnaroundMinutes: 15,
            imageUrl: '',
            videoUrl: '',
            findings: '',
            interpretation: '',
        }]);

        await screen.findByText('Chest X-Ray');
        const uploadLabel = screen.getByText(/upload image/i);
        const input = uploadLabel.closest('label').querySelector('input[type="file"]');
        fireEvent.change(input, {
            target: { files: [new File(['png'], 'cxr.png', { type: 'image/png' })] },
        });

        await waitFor(() => expect(toast.error).toHaveBeenCalledWith('forbidden'));
    });
});

describe('RadiologyEditor modality vocabulary (server/shared/diagnostics.js)', () => {
    // Regression lock: editor modality list drifted from radiology_database.json
    it('custom-study modality options include DEXA and Mammography', async () => {
        mount();
        await screen.findByText('Chest X-Ray');
        fireEvent.click(screen.getByRole('button', { name: /custom/i }));
        const modalitySelect = screen.getByLabelText(/^modality$/i);
        const values = Array.from(modalitySelect.options).map((o) => o.value);
        expect(values).toEqual(expect.arrayContaining(['DEXA', 'Mammography', 'Cardiac', 'X-Ray']));
        // Stored value stays the English modality string; the label is translated.
        const dexa = Array.from(modalitySelect.options).find((o) => o.value === 'DEXA');
        expect(dexa.textContent).toBe('DEXA');
        // Adding a custom DEXA study persists the English value.
        fireEvent.change(screen.getByPlaceholderText(/chest x-ray pa\/lateral/i), { target: { value: 'Hip DEXA' } });
        fireEvent.change(modalitySelect, { target: { value: 'DEXA' } });
        fireEvent.click(screen.getByRole('button', { name: /^add study$/i }));
        await waitFor(() => expect(screen.getByText('Hip DEXA')).toBeInTheDocument());
    });

    it('Imaging | Diagnostics segment narrows the catalogue browser to Cardiac studies', async () => {
        const ecg = { id: 22, name: '12-Lead ECG', modality: 'Cardiac', body_region: 'Chest', turnaround_minutes: 5 };
        fetchSpy.mockImplementation((url) => {
            if (typeof url === 'string' && url.endsWith('/api/radiology-database')) {
                return Promise.resolve(jsonResponse({ studies: [study, ecg], modalities: ['Cardiac', 'X-Ray'] }));
            }
            return Promise.resolve(jsonResponse({}));
        });
        mount();
        await screen.findByText('12-Lead ECG');
        expect(screen.getByText('Chest X-Ray')).toBeInTheDocument();

        const group = screen.getByTestId('editor-family-filter');
        fireEvent.click(within(group).getByRole('radio', { name: /Diagnostics/ }));
        expect(screen.getByText('12-Lead ECG')).toBeInTheDocument();
        expect(screen.queryByText('Chest X-Ray')).toBeNull();
        // Modality dropdown only offers the diagnostic modality.
        const filter = screen.getByDisplayValue(/^All \(1\)$/);
        expect(Array.from(filter.options).map((o) => o.value)).toEqual(['all', 'Cardiac']);

        fireEvent.click(within(group).getByRole('radio', { name: /Imaging/ }));
        expect(screen.getByText('Chest X-Ray')).toBeInTheDocument();
        expect(screen.queryByText('12-Lead ECG')).toBeNull();
    });
});

// Regression lock: educators can narrow the radiology catalogue
// (bug report 2.9.15 #5). Mirrors the labs editor's defaultLabsEnabled
// header: checked by default (absent flag = full catalogue), writes
// `config.investigations.defaultRadiologyEnabled` without disturbing the
// sibling labs flag, and warns when narrowing would leave students with an
// empty catalogue.
describe('RadiologyEditor catalogue narrowing (bug report 2.9.15 #5)', () => {
    function mountWithConfig(config) {
        const captured = { current: null };
        function Harness() {
            const [caseData, setCaseData] = useState({ id: 'case-1', config });
            useEffect(() => { captured.current = caseData; }, [caseData]);
            return (
                <RadiologyEditor
                    caseData={caseData}
                    setCaseData={(updater) => setCaseData(prev => typeof updater === 'function' ? updater(prev) : updater)}
                />
            );
        }
        const utils = renderWithProviders(<Harness />, { withAuth: false, withNotifications: false, withToast: false });
        return { ...utils, captured };
    }

    it('is checked when the flag is absent (pre-existing cases keep the full catalogue)', async () => {
        mountWithConfig({ radiology: [] });
        const box = await screen.findByRole('checkbox', { name: /All Radiology & Diagnostic Studies Available by Default/i });
        expect(box.checked).toBe(true);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('unchecking writes investigations.defaultRadiologyEnabled=false and keeps the labs flag', async () => {
        const { captured } = mountWithConfig({
            radiology: [],
            investigations: { defaultLabsEnabled: false, labs: [] },
        });
        const box = await screen.findByRole('checkbox', { name: /All Radiology & Diagnostic Studies Available by Default/i });
        fireEvent.click(box);
        await waitFor(() => {
            expect(captured.current.config.investigations.defaultRadiologyEnabled).toBe(false);
        });
        // Sibling flag under the same object is untouched.
        expect(captured.current.config.investigations.defaultLabsEnabled).toBe(false);
        expect(captured.current.config.radiology).toEqual([]);
        // Off + nothing configured → the empty-catalogue warning shows.
        expect(screen.getByRole('alert').textContent).toMatch(/NO radiology or diagnostic studies/i);
    });

    it('does not warn when narrowed but studies are configured', async () => {
        mountWithConfig({
            investigations: { defaultRadiologyEnabled: false },
            radiology: [{ studyId: 'xray_chest_pa', studyName: 'Chest X-Ray', modality: 'X-Ray' }],
        });
        const box = await screen.findByRole('checkbox', { name: /All Radiology & Diagnostic Studies Available by Default/i });
        expect(box.checked).toBe(false);
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
