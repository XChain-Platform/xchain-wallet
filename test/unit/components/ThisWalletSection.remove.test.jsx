// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const { wipeWalletStorage } = vi.hoisted(() => ({
    wipeWalletStorage: vi.fn(async () => {}),
}));

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', () => ({
    wipeWalletStorage,
}));

const ACTIVE_WALLET = { id: 'wallet-active', name: 'Active Wallet' };
const OTHER_WALLET = { id: 'wallet-other', name: 'Other Wallet' };

function mount(walletsAfterRemoval, overrides = {}) {
    const reload = vi.fn();
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        listConnectedSites: vi.fn().mockResolvedValue([]),
        removeWallet: vi.fn().mockResolvedValue({ removed: { wallet: 1 } }),
        listWallets: vi.fn().mockResolvedValue(walletsAfterRemoval),
        ...overrides,
    };

    render(
        <MessagingContext.Provider value={{ messaging, shell: 'web' }}>
            <Settings
                onBack={() => {}}
                activeWallet={ACTIVE_WALLET}
                initialSubpageId="this-wallet"
                reload={reload}
            />
        </MessagingContext.Provider>,
    );

    return { messaging, reload };
}

async function removeActiveWallet() {
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    fireEvent.change(screen.getByLabelText('Confirm wallet name'), {
        target: { value: ACTIVE_WALLET.name },
    });
    const confirm = screen.getByRole('button', { name: 'Remove wallet' });
    expect(confirm.style.color).toBe('var(--xc-on-accent)');
    fireEvent.click(confirm);
    await screen.findByText('Wallet removed.');
}

beforeEach(() => {
    globalThis.localStorage.clear();
    globalThis.localStorage.setItem('xc:activeWallet', ACTIVE_WALLET.id);
    wipeWalletStorage.mockClear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('ThisWalletSection removal completion', () => {
    it('submits an exact wallet-name confirmation with Enter', async () => {
        const { messaging } = mount([OTHER_WALLET]);

        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        const confirmation = screen.getByLabelText('Confirm wallet name');
        expect(screen.getByText('Remove Active Wallet?')).toBeTruthy();
        expect(screen.getByText(/Removing this wallet deletes its accounts, addresses, signers, and pending transactions/)).toBeTruthy();
        expect(screen.getByText(/This cannot be undone/)).toBeTruthy();
        expect(confirmation).toHaveAttribute('enterkeyhint', 'done');
        fireEvent.change(confirmation, { target: { value: ACTIVE_WALLET.name } });
        fireEvent.keyDown(confirmation, { key: 'Enter' });

        await screen.findByText('Wallet removed.');
        expect(messaging.removeWallet).toHaveBeenCalledWith({ walletId: ACTIVE_WALLET.id });
    });

    it('locks confirmation and Settings navigation while removal is in flight', async () => {
        let finishRemoval;
        mount([OTHER_WALLET], {
            removeWallet: vi.fn(() => new Promise((resolve) => {
                finishRemoval = resolve;
            })),
        });
        fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
        const input = screen.getByLabelText('Confirm wallet name');
        fireEvent.change(input, { target: { value: ACTIVE_WALLET.name } });
        fireEvent.click(screen.getByRole('button', { name: 'Remove wallet' }));

        expect(input.disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Cancel' }).disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Back to settings' }).disabled).toBe(true);

        finishRemoval({ removed: { wallet: 1 } });
        await screen.findByText('Wallet removed.');
    });

    it('selects another wallet after removing the active wallet', async () => {
        const { messaging, reload } = mount([OTHER_WALLET]);

        await removeActiveWallet();

        expect(messaging.removeWallet).toHaveBeenCalledWith({ walletId: ACTIVE_WALLET.id });
        await waitFor(() => {
            expect(messaging.listWallets).toHaveBeenCalledOnce();
            expect(globalThis.localStorage.getItem('xc:activeWallet')).toBe(OTHER_WALLET.id);
        });
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(reload).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove wallet' })).toBeNull();
    });

    it('clears the empty vault after removing its last wallet', async () => {
        const { messaging, reload } = mount([]);

        await removeActiveWallet();

        await waitFor(() => expect(wipeWalletStorage).toHaveBeenCalledOnce());
        expect(messaging.removeWallet).toHaveBeenCalledWith({ walletId: ACTIVE_WALLET.id });
        expect(globalThis.localStorage.getItem('xc:activeWallet')).toBeNull();
        expect(reload).toHaveBeenCalledOnce();
        expect(screen.queryByRole('button', { name: 'Remove…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Remove wallet' })).toBeNull();
    });

    it('clears the removed selection and reloads when fallback selection fails', async () => {
        const { reload } = mount([], {
            listWallets: vi.fn().mockRejectedValue(new Error('List failed')),
        });

        await removeActiveWallet();

        expect(await screen.findByText(/could not finish switching wallets: List failed/)).toBeTruthy();
        expect(globalThis.localStorage.getItem('xc:activeWallet')).toBeNull();
        expect(reload).toHaveBeenCalledOnce();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });
});
