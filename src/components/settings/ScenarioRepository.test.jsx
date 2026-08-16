import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import { setAppLanguage } from '../../i18n/index.js';
import ScenarioRepository from './ScenarioRepository.jsx';

const toast = {
    confirm: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
};

vi.mock('../../contexts/AuthContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useAuth: () => ({ user: { id: 1, role: 'admin' } }),
    };
});

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

// Two rows in different languages plus one carrying the free text the Italian
// pilot actually saved before `scenarios.category` became a keyed enum.
const SCENARIO_ROWS = [
    {
        id: 3,
        name: 'Custom Shock',
        description: 'custom scenario',
        category: 'Sepsis',
        language: 'en',
        duration_minutes: 10,
        timeline: [],
        is_public: true,
    },
    {
        id: 4,
        name: 'Scenario Italiano',
        description: 'scenario tradotto',
        category: 'Emergenza Neurologica / Terapia Intensiva',
        language: 'it',
        duration_minutes: 20,
        timeline: [],
        is_public: true,
    },
];

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

let fetchSpy;

beforeEach(() => {
    localStorage.setItem('token', 'admin-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.endsWith('/api/scenarios')) {
            return Promise.resolve(jsonResponse({ scenarios: SCENARIO_ROWS }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('ScenarioRepository apiFetch migration', () => {
    it('loads scenario repository rows with bearer auth', async () => {
        renderWithProviders(
            <ScenarioRepository onSelectScenario={vi.fn()} />,
            { withAuth: false, withNotifications: false, withToast: false }
        );

        expect(await screen.findByText('Custom Shock')).toBeInTheDocument();

        const [url, init] = fetchSpy.mock.calls.find(([callUrl]) => String(callUrl).endsWith('/api/scenarios'));
        expect(url).toBe('/api/scenarios');
        expect(init.headers).toMatchObject({ Authorization: 'Bearer admin-token' });
        expect(init.headers['X-Request-Id']).toBeTruthy();
        expect(init.headers['Content-Type']).toBeUndefined();
    });
});

describe('ScenarioRepository language + category vocabulary', () => {
    const render = () => renderWithProviders(
        <ScenarioRepository onSelectScenario={vi.fn()} />,
        { withAuth: false, withNotifications: false, withToast: false }
    );

    it('shows a language badge on every card and filters the list by language', async () => {
        const user = userEvent.setup();
        render();
        expect(await screen.findByText('Scenario Italiano')).toBeInTheDocument();
        expect(screen.getByText('Custom Shock')).toBeInTheDocument();

        const languageFilter = screen.getByLabelText('Filter by language');
        expect(within(languageFilter).getByRole('option', { name: /Italiano/ })).toBeInTheDocument();
        await user.selectOptions(languageFilter, 'it');

        expect(screen.getByText('Scenario Italiano')).toBeInTheDocument();
        expect(screen.queryByText('Custom Shock')).not.toBeInTheDocument();
        // Built-ins are English, so they vanish with the English rows.
        expect(screen.queryByText('STEMI Progression')).not.toBeInTheDocument();
    });

    // Regression lock: scenario category was a computed t() key + free text.
    it('renders category labels from the literal key map, translated', async () => {
        render();
        await screen.findByText('Custom Shock');
        const categoryFilter = screen.getByLabelText('Filter by category');
        expect(within(categoryFilter).getByRole('option', { name: /^Cardiac/ })).toBeInTheDocument();

        // Italian is lazily code-split — setAppLanguage loads the chunk first.
        await setAppLanguage('it');
        await waitFor(() => expect(
            within(screen.getByLabelText('Filtra per categoria')).getByRole('option', { name: /^Cardiaco/ })
        ).toBeInTheDocument());
        await setAppLanguage('en');
    });

    // Regression lock: scenario category was a computed t() key + free text.
    it('keeps an unrecognised stored category visible and selectable in the editor', async () => {
        const user = userEvent.setup();
        render();
        await screen.findByText('Scenario Italiano');
        expect(screen.getByText('Emergenza Neurologica / Terapia Intensiva')).toBeInTheDocument();

        const cards = screen.getByText('Scenario Italiano').closest('div.bg-neutral-800');
        await user.click(within(cards).getByTitle('Edit'));

        const categorySelect = await screen.findByLabelText('Category');
        expect(categorySelect.value).toBe('Emergenza Neurologica / Terapia Intensiva');
        expect(within(categorySelect).getByRole('option', {
            name: 'Emergenza Neurologica / Terapia Intensiva',
        })).toBeInTheDocument();
        expect(screen.getByLabelText('Language').value).toBe('it');
    });

    it('posts the selected language when saving a new scenario', async () => {
        const user = userEvent.setup();
        render();
        await screen.findByText('Custom Shock');

        await user.click(screen.getByRole('button', { name: /New Scenario/ }));
        await user.type(await screen.findByPlaceholderText('Scenario name'), 'Nuovo scenario');
        await user.selectOptions(screen.getByLabelText('Language'), 'it');
        await user.selectOptions(screen.getByLabelText('Category'), 'Cardiac');
        await user.click(screen.getByRole('button', { name: /Save Scenario/ }));

        await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
        const [, init] = fetchSpy.mock.calls.find(([, callInit]) => callInit?.method === 'POST');
        expect(JSON.parse(init.body)).toMatchObject({
            name: 'Nuovo scenario',
            language: 'it',
            category: 'Cardiac',
        });
    });

    it('imports a file with language:"it", warning (not rejecting) on free-text values', async () => {
        const user = userEvent.setup();
        const { container } = render();
        await screen.findByText('Custom Shock');

        const file = new File([JSON.stringify({
            name: 'Importato',
            description: 'da un pilota italiano',
            category: 'Emergenza generica del pronto soccorso',
            language: 'it',
            duration_minutes: 15,
            timeline: [{ time: 0, label: 'inizio', params: { hr: 90 }, rhythm: 'Bradicardia Sinusale Marcata' }],
        })], 'scenario.json', { type: 'application/json' });

        await user.upload(container.querySelector('input[type="file"]'), file);

        // The scenario still opens in the editor: import must never reject.
        await waitFor(() => expect(screen.getByDisplayValue('Importato')).toBeInTheDocument());
        expect(screen.getByLabelText('Language').value).toBe('it');
        expect(screen.getByLabelText('Category').value).toBe('Emergenza generica del pronto soccorso');
        expect(toast.warning).toHaveBeenCalledWith(
            expect.stringContaining('Emergenza generica del pronto soccorso')
        );
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalled();

        // A recognised rhythm alias is canonicalised on the way in.
        await user.click(screen.getByRole('button', { name: /Save Scenario/ }));
        await waitFor(() => expect(fetchSpy.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
        const [, init] = fetchSpy.mock.calls.find(([, callInit]) => callInit?.method === 'POST');
        expect(JSON.parse(init.body).timeline[0].rhythm).toBe('Sinus Bradycardia');
    });
});
