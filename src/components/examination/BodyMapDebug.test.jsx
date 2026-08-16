// Regression locks for the body-map editor:
//  1. (i18n) BodyMapDebug rendered ~20 hardcoded English strings and raw
//     region labels; in Italian nothing but the numbers must still read
//     as English.
//  2. (geometry) the editor canvas must take the silhouette's intrinsic
//     aspect ratio — never the fixed 500x900 box whose object-contain
//     letterboxing put the posterior coordinates in the wrong space
//     ("Regression lock: posterior body-map coordinates were traced in a
//     letterboxed editor").
//  3. (cache) a legacy unversioned localStorage copy is discarded and the
//     server file is fetched instead.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { setAppLanguage } from '../../i18n/index.js';
import defaultRegions from '../../utils/defaultRegions';
import { REGIONS_STORAGE_KEY, REGIONS_CACHE_VERSION } from '../../utils/bodymapRegionsCache';

const apiFetchMock = vi.fn();
const apiPostMock = vi.fn();
vi.mock('../../services/apiClient', () => ({
    apiFetch: (...args) => apiFetchMock(...args),
    apiPost: (...args) => apiPostMock(...args),
}));

const toast = { success: vi.fn(), error: vi.fn(), confirm: vi.fn() };
vi.mock('../../contexts/ToastContext', async (importActual) => {
    const actual = await importActual();
    return { ...actual, useToast: () => toast };
});

import BodyMapDebug from './BodyMapDebug';

beforeEach(() => {
    apiFetchMock.mockReset();
    apiPostMock.mockReset();
    apiFetchMock.mockResolvedValue({ regions: null });
    toast.confirm.mockReset();
    toast.success.mockReset();
});

afterEach(async () => {
    await act(async () => { await setAppLanguage('en'); });
});

describe('BodyMapDebug — i18n (task #12)', () => {
    it('renders no English chrome in Italian: buttons, hints, headings and region labels are localised', async () => {
        await act(async () => { await setAppLanguage('it'); });
        render(<BodyMapDebug gender="female" view="posterior" />);

        // Buttons / toggles
        expect(screen.getByRole('button', { name: 'Salva modifiche' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Ripristina predefiniti' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Copia vista corrente' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Esporta tutte le regioni' })).toBeTruthy();
        expect(screen.getByText('Mostra griglia')).toBeTruthy();
        expect(screen.getByText('Mostra regioni')).toBeTruthy();
        // Title + ICU-select subtitle (enum words go through select, never t(`x_${var}`))
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Editor mappa del corpo');
        expect(screen.getByText('Femminile – Posteriore')).toBeTruthy();
        // Region list uses the same mapRegionLabel() key map as the viewer
        expect(screen.getAllByText('Mano sx').length).toBeGreaterThan(0);

        // Nothing English left
        ['Save Changes', 'Reset to Defaults', 'Show Grid', 'Show Regions', 'Copy Current View',
            'Export All Regions', 'Body Map Editor', 'L. Hand', 'Unsaved changes'].forEach((english) => {
            expect(screen.queryByText(english)).toBeNull();
        });
        expect(screen.queryByText(/Drag the circles/)).toBeNull();
        expect(screen.queryByText(/Click region name/)).toBeNull();
    });

    it('reset goes through toast.confirm with the translated prompt (no window.confirm)', async () => {
        await act(async () => { await setAppLanguage('it'); });
        toast.confirm.mockResolvedValue(false);
        const nativeConfirm = vi.spyOn(window, 'confirm');
        render(<BodyMapDebug gender="male" view="anterior" />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Ripristina predefiniti' }));
        });
        expect(toast.confirm).toHaveBeenCalledWith(
            'Ripristinare tutte le regioni ai valori predefiniti? Tutte le modifiche andranno perse.',
            expect.objectContaining({ type: 'danger' })
        );
        expect(nativeConfirm).not.toHaveBeenCalled();
        nativeConfirm.mockRestore();
    });
});

describe('BodyMapDebug — canvas follows the intrinsic image ratio (task #2)', () => {
    it('does not use the fixed 500px-wide letterboxing box; width tracks the loaded PNG ratio', () => {
        render(<BodyMapDebug gender="female" view="posterior" />);
        const canvas = screen.getByTestId('bodymap-editor-canvas');
        const img = canvas.querySelector('img');
        expect(img.className).not.toMatch(/object-contain/);
        // Seeded posterior ratio before load: 438/1022 * 900 ≈ 386px, never 500.
        expect(canvas.style.width).not.toBe('500px');
        expect(canvas.style.height).toBe('900px');

        // Simulate the woman-back.png load (416x984) — width re-derives from it.
        Object.defineProperty(img, 'naturalWidth', { value: 416, configurable: true });
        Object.defineProperty(img, 'naturalHeight', { value: 984, configurable: true });
        act(() => { fireEvent.load(img); });
        expect(canvas.style.width).toBe(`${Math.round(900 * Number((416 / 984).toFixed(4)))}px`);
    });
});

describe('BodyMapDebug — versioned localStorage cache', () => {
    it('discards a legacy unversioned cache and loads from the server; saves re-stamp the version', async () => {
        // Pre-fix browsers hold the bare regions tree under the key.
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(defaultRegions));
        apiFetchMock.mockResolvedValue({ regions: defaultRegions });
        apiPostMock.mockResolvedValue({ success: true });

        render(<BodyMapDebug gender="male" view="anterior" />);
        await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/bodymap-regions', { auth: false }));
        await waitFor(() => {
            const cached = JSON.parse(localStorage.getItem(REGIONS_STORAGE_KEY));
            expect(cached.version).toBe(REGIONS_CACHE_VERSION);
            expect(cached.regions).toEqual(defaultRegions);
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
        });
        expect(apiPostMock).toHaveBeenCalledWith('/bodymap-regions', { regions: defaultRegions });
        const cached = JSON.parse(localStorage.getItem(REGIONS_STORAGE_KEY));
        expect(cached.version).toBe(REGIONS_CACHE_VERSION);
    });

    it('uses a current-version cache without hitting the server', async () => {
        localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify({ version: REGIONS_CACHE_VERSION, regions: defaultRegions }));
        render(<BodyMapDebug gender="male" view="anterior" />);
        await act(async () => {});
        expect(apiFetchMock).not.toHaveBeenCalled();
    });
});
