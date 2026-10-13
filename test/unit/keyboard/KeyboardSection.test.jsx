// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings → Keyboard rebinding UI (§34.1): capture flow, conflict refusal,
// persistence via messaging.updateSettings, and reset.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor, act } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { KeyboardSection } from '../../../packages/core/src/shared/components/settings/KeyboardSection.jsx';
import { DisplaySection } from '../../../packages/core/src/shared/components/settings/DisplaySection.jsx';
import { updateSettings } from '../../../packages/core/src/flows/settings.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

function makeMessaging(initialBindings = {}) {
    let settings = { keyboard: { bindings: { ...initialBindings } } };
    return {
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = { ...settings, ...patch };
            return Promise.resolve(settings);
        }),
        _get: () => settings,
    };
}

async function setup(initialBindings) {
    const messaging = makeMessaging(initialBindings);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <KeyboardSection />
        </MessagingProvider>,
    );
    await waitFor(() => expect(screen.getByText('Lock wallet')).toBeTruthy());
    return messaging;
}

// The capture listener is on window with capture=true.
const press = (init) => act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
});

describe('KeyboardSection', () => {
    it('lists rebindable rows with Rebind buttons and fixed context rows without', () => {
        return setup().then(() => {
            expect(screen.getByText(
                'Select Rebind, then press the new key combination. Screen-specific shortcuts are fixed and only work on their screen.',
            )).toBeTruthy();
            expect(screen.queryByText(/Click Rebind/)).toBeNull();
            expect(screen.getByText('Export history')).toBeTruthy();
            expect(screen.getByText('? / Ctrl+/')).toBeTruthy();
            expect(screen.getByText('Requires “Show pin button on rows” in Display.')).toBeTruthy();
            expect(screen.getByText('Requires “Show hide button on rows” in Display.')).toBeTruthy();
            const rebinds = screen.getAllByRole('button', { name: 'Rebind' });
            // General (5, incl. palette) + Go to (6) are rebindable; the six
            // context shortcuts are not.
            expect(rebinds).toHaveLength(11);
        });
    });

    it('captures a new combo and persists it', async () => {
        const messaging = await setup();
        const lockRow = screen.getByText('Lock wallet').closest('div');
        fireEvent.click(lockRow.querySelector('button'));
        press({ key: 'j', ctrlKey: true });
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: { lock: 'mod+j' } },
        }));
    });

    it('refuses a conflicting binding', async () => {
        const messaging = await setup();
        const lockRow = screen.getByText('Lock wallet').closest('div');
        fireEvent.click(lockRow.querySelector('button'));
        press({ key: 'n', ctrlKey: true }); // taken by New send
        await waitFor(() => expect(screen.getByText(/already used by/)).toBeTruthy());
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });

    it('resets an override back to the default', async () => {
        const messaging = await setup({ lock: 'mod+j' });
        const lockRow = await waitFor(() => screen.getByText('Lock wallet').closest('div'));
        const reset = screen.getByRole('button', { name: 'Reset' });
        fireEvent.click(reset);
        expect(messaging.updateSettings).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: 'Reset shortcut?' })).toHaveTextContent(
            'Restore "Lock wallet" to its built-in binding?',
        );
        fireEvent.click(screen.getByRole('button', { name: 'Reset shortcut' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: {} },
        }));
        expect(lockRow).toBeTruthy();
    });

    it('removes an override when capture returns to the built-in binding', async () => {
        const messaging = await setup({ lock: 'mod+j' });
        const lockRow = screen.getByText('Lock wallet').closest('div');
        fireEvent.click(lockRow.querySelector('button'));
        press({ key: 'l', ctrlKey: true });
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: {} },
        }));
    });

    it('resets every override in one persisted update', async () => {
        const messaging = await setup({ lock: 'mod+j', settings: 'mod+.' });
        fireEvent.click(screen.getByRole('button', { name: 'Reset all shortcuts' }));
        expect(messaging.updateSettings).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Reset shortcuts' }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            keyboard: { bindings: {} },
        }));
        expect(await screen.findByText('All shortcuts reset to defaults.')).toBeTruthy();
    });
});

describe('Settings reset boundaries', () => {
    it('replaces reset maps while leaving wallets, contacts, and other settings untouched', async () => {
        let stored = {
            ...createDefaultSettings(),
            theme: 'dark',
            keyboard: { bindings: { lock: 'mod+j', settings: 'mod+.' } },
            pinnedTokensByWallet: {
                'wallet-a': ['bitcoin-mainnet:BTC'],
                'wallet-b': ['litecoin-mainnet:LTC'],
            },
        };
        const vault = {
            settings: {
                get: vi.fn(async () => stored),
                put: vi.fn(async (next) => { stored = next; }),
            },
            wallets: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
            contacts: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
        };

        await updateSettings(vault, { keyboard: { bindings: { settings: 'mod+.' } } });
        await updateSettings(vault, { pinnedTokensByWallet: {} });

        expect(stored.keyboard.bindings).toEqual({ settings: 'mod+.' });
        expect(stored.pinnedTokensByWallet).toEqual({});
        expect(stored.theme).toBe('dark');
        expect(vault.wallets.get).not.toHaveBeenCalled();
        expect(vault.wallets.put).not.toHaveBeenCalled();
        expect(vault.wallets.delete).not.toHaveBeenCalled();
        expect(vault.contacts.get).not.toHaveBeenCalled();
        expect(vault.contacts.put).not.toHaveBeenCalled();
        expect(vault.contacts.delete).not.toHaveBeenCalled();
    });

    it('confirms before clearing only saved list-filter storage', async () => {
        localStorage.setItem('xc:chainFilter:history', '["bitcoin-mainnet"]');
        localStorage.setItem('unrelated', 'keep');
        const settings = {
            privacy: { hideSmallBalances: false },
            pinnedTokens: [],
            watchedTokens: [],
            hiddenTokens: [],
            pinnedTokensByWallet: {},
            showPinAffordance: false,
            showHideAffordance: false,
            smallBalanceThreshold: 'dust',
            numberFormat: 'full',
        };
        const messaging = {
            getSettings: vi.fn(async () => settings),
            updateSettings: vi.fn(async () => settings),
            getTokenInfo: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DisplaySection />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Reset list preferences' }));
        expect(localStorage.getItem('xc:chainFilter:history')).not.toBeNull();
        expect(screen.getByRole('dialog', { name: 'Reset list preferences?' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reset preferences' }));

        await waitFor(() => expect(localStorage.getItem('xc:chainFilter:history')).toBeNull());
        expect(localStorage.getItem('unrelated')).toBe('keep');
        expect(messaging.updateSettings).not.toHaveBeenCalled();
    });
});
