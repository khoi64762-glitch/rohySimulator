// Tests for ToastContext.jsx — the confirm() modal primitive.
//
// CONTRACT (locked from src/contexts/ToastContext.jsx):
//   - toast.confirm(message, options?) resolves true on the confirm button,
//     false on cancel / Escape / backdrop click.
//   - Button labels and the title default to the ACTIVE LOCALE's
//     common:confirm / common:cancel; explicit options always win.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { setAppLanguage } from '../i18n/index.js';
import renderWithProviders from '../../tests/utils/renderWithProviders.jsx';
import { useToast } from './ToastContext.jsx';

let lastResult;

function Trigger({ options }) {
    const toast = useToast();
    return (
        <button onClick={() => { lastResult = toast.confirm('Are you sure?', options); }}>
            open
        </button>
    );
}

function mount(options) {
    lastResult = undefined;
    renderWithProviders(<Trigger options={options} />, { withVoice: false });
    fireEvent.click(screen.getByText('open'));
}

beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(async () => {
    await setAppLanguage('en');
    cleanup();
    vi.restoreAllMocks();
});

describe('toast.confirm defaults', () => {
    it('reads English confirm/cancel by default', async () => {
        mount();
        expect(await screen.findByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    });

    // Regression lock: confirm dialog defaults were hardcoded English
    // ('Confirm' / 'Cancel') regardless of the active locale, so every
    // toast.confirm() that passed no texts showed English buttons in
    // Italian/German/… UIs.
    it('follows the active locale when no texts are passed (it → Annulla / Conferma)', async () => {
        await act(async () => { await setAppLanguage('it'); });
        mount();
        expect(await screen.findByRole('button', { name: 'Annulla' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Conferma' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Conferma' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    });

    it('lets explicit options win over the locale defaults', async () => {
        await act(async () => { await setAppLanguage('it'); });
        mount({ title: 'Delete case', confirmText: 'Delete', cancelText: 'Keep' });
        expect(await screen.findByRole('button', { name: 'Delete' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Keep' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Delete case' })).toBeInTheDocument();
    });
});

describe('toast.confirm promise contract', () => {
    it('resolves true on confirm and closes the modal', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
        await expect(lastResult).resolves.toBe(true);
        await waitFor(() => expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument());
    });

    it('resolves false on cancel', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
        await expect(lastResult).resolves.toBe(false);
    });

    it('resolves false on Escape', async () => {
        mount();
        await screen.findByText('Are you sure?');
        fireEvent.keyDown(window, { key: 'Escape' });
        await expect(lastResult).resolves.toBe(false);
    });
});
