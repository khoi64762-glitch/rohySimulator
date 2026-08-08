// Regression lock: TreatmentPanel showed the answer key and hidden rows to students (bug report 2.9.15 #7/#9)
//
// The panel used to render "Expected"/"CI" badges and green/red row tints
// straight from is_expected/is_contraindicated, listed treatments with
// is_available: 0, and — because SQLite booleans arrive as JSON 0/1 —
// `{0 && <span/>}` printed a literal "00" after a hidden/neutral
// treatment's name. This suite feeds the panel an educator-shaped payload
// (integer flags present) and locks: no badges, no stray "0"s, no hidden
// rows.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../../tests/utils/renderWithProviders.jsx';
import TreatmentPanel from './TreatmentPanel.jsx';

const toast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
};

vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        useToast: () => toast,
    };
});

vi.mock('../../services/PatientRecord', () => ({
    usePatientRecord: () => ({
        ordered: vi.fn(),
        administered: vi.fn(),
    }),
}));

function jsonResponse(payload, init = {}) {
    return new Response(JSON.stringify(payload), {
        status: init.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
}

// Educator-shaped rows: the integer grading flags are present. (A student
// payload no longer carries them at all — absent fields are trivially safe;
// this locks the harder case.) Names/routes deliberately contain no digits
// so any digit in the rendered row is a leaked integer flag.
const medicationRows = [
    {
        id: 1,
        treatment_type: 'medication',
        treatment_name: 'Aspirin',
        route: 'PO',
        description: 'antiplatelet agent',
        is_available: 1,
        is_expected: 1,
        is_contraindicated: 0,
    },
    {
        id: 2,
        treatment_type: 'medication',
        treatment_name: 'Warfarin',
        route: 'PO',
        description: 'anticoagulant',
        is_available: 1,
        is_expected: 0,
        is_contraindicated: 1,
    },
    {
        // Neutral row: pre-fix, {0 && …}{0 && …} rendered a literal "00".
        id: 3,
        treatment_type: 'medication',
        treatment_name: 'Paracetamol',
        route: 'PO',
        description: 'analgesic',
        is_available: 1,
        is_expected: 0,
        is_contraindicated: 0,
    },
    {
        id: 4,
        treatment_type: 'medication',
        treatment_name: 'Secretol',
        route: 'PO',
        description: 'hidden for this case',
        is_available: 0,
        is_expected: 0,
        is_contraindicated: 0,
    },
];

let fetchSpy;

beforeEach(() => {
    localStorage.setItem('token', 'student-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
        if (typeof url === 'string' && url.includes('/available-treatments')) {
            return Promise.resolve(jsonResponse({
                treatments: {
                    medication: medicationRows,
                    iv_fluid: [],
                    oxygen: [],
                    nursing: [],
                },
                config: {},
            }));
        }
        if (typeof url === 'string' && url.includes('/treatment-orders')) {
            return Promise.resolve(jsonResponse({ orders: [] }));
        }
        return Promise.resolve(jsonResponse({}));
    });
});

afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
    vi.clearAllMocks();
});

function renderPanel() {
    return renderWithProviders(
        <TreatmentPanel sessionId="sess-a" />,
        { withAuth: false, withNotifications: false, withToast: false, withVoice: false }
    );
}

describe('TreatmentPanel student surface (bug report 2.9.15 #7/#9)', () => {
    it('renders no Expected/CI badges for integer grading flags (#7)', async () => {
        renderPanel();

        expect(await screen.findByText('Aspirin')).toBeInTheDocument();
        expect(screen.getByText('Warfarin')).toBeInTheDocument();

        // The badge strings from src/locales/en/treatments.json.
        expect(screen.queryByText('Expected')).toBeNull();
        expect(screen.queryByText('CI')).toBeNull();
    });

    it('renders no stray "0"/"00" from integer flags next to treatment names (#9b)', async () => {
        renderPanel();
        await screen.findByText('Paracetamol');

        ['Aspirin', 'Warfarin', 'Paracetamol'].forEach((name) => {
            const row = screen.getByText(name).closest('button');
            expect(row).toBeTruthy();
            // No digit anywhere in the row: the fixture contains none, so any
            // digit is a leaked integer flag rendered by a `{flag && …}` guard.
            expect(row.textContent).not.toMatch(/\d/);
        });
    });

    it('does not list treatments with is_available: 0 (#9a)', async () => {
        renderPanel();
        await screen.findByText('Aspirin');

        expect(screen.queryByText('Secretol')).toBeNull();
    });
});
