// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The My Wallets and My Accounts search: a filter button beside the plus, a
// match on name and address (and on kind for wallets), an active state and an
// empty result. My Wallets reads every wallet's addresses with ONE host call
// made when a search is first typed; My Accounts reads one wallet's addresses
// with one getAddressesByChain(walletId) call.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { AccountPicker } from '../../../packages/core/src/shared/routes/AccountPicker.jsx';

afterEach(() => cleanup());

const noop = () => {};

async function renderWith(messaging, element) {
    await act(async () => {
        render(<MessagingProvider shell="popup" messaging={messaging}>{element}</MessagingProvider>);
        await Promise.resolve();
    });
}

function walletPicker() {
    return <WalletPicker activeWalletId={null} onSwitch={noop} onAddWallet={noop} onBack={noop} />;
}

function accountPicker() {
    return <AccountPicker walletId="w1" activeAccountId={null} onSwitch={noop} onAddAccount={noop} onBack={noop} />;
}

async function type(label, filterName, value) {
    if (!screen.queryByLabelText(label)) fireEvent.click(screen.getByRole('button', { name: filterName }));
    await act(async () => {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        await Promise.resolve();
    });
}

const typeWallet = (value) => type('Search wallets', 'Filter wallets', value);
const typeAccount = (value) => type('Search accounts', 'Filter accounts', value);

async function mountWallets(count) {
    const wallets = Array.from({ length: count }, (_, i) => ({ id: `w${i}`, name: `Wallet ${i}`, format: 'bip39' }));
    const byWallet = Object.fromEntries(wallets.map((w, i) => [w.id, [`bc1qAddress${i}`, `bc1qSecond${i}`]]));
    const messaging = {
        listWallets: vi.fn(() => Promise.resolve(wallets)),
        getAddressesByWallet: vi.fn(() => Promise.resolve(byWallet)),
        getAddressesByChain: vi.fn(() => Promise.resolve({})),
    };
    await renderWith(messaging, walletPicker());
    return messaging;
}

describe('My Wallets search', () => {
    it('puts a Filter wallets button beside the plus', async () => {
        await mountWallets(2);
        const filter = screen.getByRole('button', { name: 'Filter wallets' });
        const plus = screen.getAllByRole('button', { name: 'Add Wallet' })[0];
        expect(filter.parentElement.parentElement.contains(plus)).toBe(true);
    });

    it('filters by name and by kind, and marks the filter active', async () => {
        const wallets = [
            { id: 'a', name: 'Alpha', format: 'bip39' },
            { id: 'b', name: 'Beta', format: 'counterwallet-legacy' },
            { id: 'c', name: 'Gamma', format: 'wif-only' },
        ];
        await renderWith({ listWallets: () => Promise.resolve(wallets), getAddressesByWallet: () => Promise.resolve({}) }, walletPicker());
        const filter = screen.getByRole('button', { name: 'Filter wallets' });
        expect(filter.getAttribute('data-active')).toBeNull();
        await typeWallet('beta');
        expect(screen.queryByText('Alpha')).toBeNull();
        expect(screen.getByText('Beta')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Filter wallets' }).getAttribute('data-active')).toBe('true');
        await typeWallet('imported key');
        await waitFor(() => expect(screen.queryByText('Beta')).toBeNull());
        expect(screen.getByText('Gamma')).toBeTruthy();
        await typeWallet('');
        expect(screen.getByText('Alpha')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Filter wallets' }).getAttribute('data-active')).toBeNull();
    });

    it('shows No matching wallets when nothing matches', async () => {
        await mountWallets(2);
        await typeWallet('zzz-no-such-wallet');
        expect(await screen.findByText('No matching wallets')).toBeTruthy();
    });

    for (const count of [2, 20]) {
        it(`makes one address read at ${count} wallets, only after a search is typed`, async () => {
            const messaging = await mountWallets(count);
            expect(messaging.getAddressesByWallet).toHaveBeenCalledTimes(0);
            await typeWallet('b');
            await typeWallet('bc1qaddress1');
            await typeWallet('bc1qsecond0');
            await waitFor(() => expect(messaging.getAddressesByWallet).toHaveBeenCalledTimes(1));
            expect(messaging.getAddressesByChain).not.toHaveBeenCalled();
        });
    }

    it('filters wallets by any of their addresses, case-insensitively', async () => {
        await mountWallets(3);
        await typeWallet('BC1QSECOND2');
        await waitFor(() => expect(screen.queryByText('Wallet 0')).toBeNull());
        expect(screen.getByText('Wallet 2')).toBeTruthy();
        expect(screen.queryByText('Wallet 1')).toBeNull();
    });

    it('still filters by name when the address read fails', async () => {
        const wallets = [{ id: 'w0', name: 'Alpha', format: 'bip39' }, { id: 'w1', name: 'Beta', format: 'bip39' }];
        await renderWith({
            listWallets: () => Promise.resolve(wallets),
            getAddressesByWallet: vi.fn(() => Promise.reject(new Error('locked'))),
        }, walletPicker());
        await typeWallet('beta');
        await waitFor(() => expect(screen.queryByText('Alpha')).toBeNull());
        expect(screen.getByText('Beta')).toBeTruthy();
    });
});

describe('My Accounts search', () => {
    const accounts = [
        { id: 'acct-0', index: 0, name: 'Savings' },
        { id: 'acct-1', index: 1, name: '' },
        { id: 'acct-2', index: 2, name: 'Trading' },
    ];
    const byChain = {
        'bitcoin-mainnet': [
            { accountId: 'acct-0', address: 'bc1qSavingsAddr' },
            { accountId: 'acct-2', address: 'bc1qTradingAddr' },
        ],
    };
    function mountAccounts() {
        const messaging = {
            listAccounts: vi.fn(() => Promise.resolve(accounts)),
            getAddressesByChain: vi.fn(() => Promise.resolve(byChain)),
        };
        return renderWith(messaging, accountPicker()).then(() => messaging);
    }

    it('puts a Filter accounts button beside the plus', async () => {
        await mountAccounts();
        const filter = screen.getByRole('button', { name: 'Filter accounts' });
        const plus = screen.getByRole('button', { name: 'Add Account' });
        expect(filter.parentElement.parentElement.contains(plus)).toBe(true);
    });

    it('filters by name and marks the filter active', async () => {
        await mountAccounts();
        expect(screen.getByRole('button', { name: 'Filter accounts' }).getAttribute('data-active')).toBeNull();
        await typeAccount('trad');
        expect(screen.queryByText('Savings')).toBeNull();
        expect(screen.getByText('Trading')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Filter accounts' }).getAttribute('data-active')).toBe('true');
        await typeAccount('account 2');
        expect(screen.queryByText('Trading')).toBeNull();
    });

    it('filters by address with one getAddressesByChain(walletId) read', async () => {
        const messaging = await mountAccounts();
        await typeAccount('BC1QSAVINGSADDR');
        await waitFor(() => expect(screen.queryByText('Trading')).toBeNull());
        expect(screen.getByText('Savings')).toBeTruthy();
        await typeAccount('bc1qtradingaddr');
        await waitFor(() => expect(screen.queryByText('Savings')).toBeNull());
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(1);
        expect(messaging.getAddressesByChain).toHaveBeenCalledWith('w1');
    });

    it('shows No matching accounts when nothing matches', async () => {
        await mountAccounts();
        await typeAccount('zzz-no-such-account');
        expect(await screen.findByText('No matching accounts')).toBeTruthy();
    });
});
