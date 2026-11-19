// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A demo wallet opened Send and sat on "Loading…" for 20 s or more while the
// wallet-wide balance read ran against fixture addresses. Send now opens at
// once, with no demo notice; pressing Send is refused instead.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { clearDemoWalletId, markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function mount(walletId) {
    const balances = { native: { tick: 'BTC', quantity: '100000000', divisibility: 8 }, tokens: [] };
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue(balances),
        // Never settles, like the slow balance read the device pass hit.
        getWalletBalances: vi.fn(() => new Promise(() => {})),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', grace: { testSendThresholdSats: 0 } }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId, onBack() {} }),
    ));
    return messaging;
}

beforeEach(() => { clearDemoWalletId(); });
afterEach(() => { cleanup(); clearDemoWalletId(); });

describe('Send in a demo wallet', () => {
    it('opens the form at once with no demo notice and refuses Send when pressed', async () => {
        markDemoWallet('demo-w');
        const messaging = mount('demo-w');

        const form = await screen.findByRole('form', { name: 'Send' });
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
        expect(screen.queryByText(/Demo wallets can't move funds/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Create a Real Wallet' })).toBeNull();
        const submit = form.querySelector('button[type="submit"]');
        expect(submit).toBeEnabled();

        fireEvent.click(submit);
        expect(await screen.findByText(/Demo wallets can't move funds/)).toBeInTheDocument();
        const composeCalls = Object.keys(messaging).filter((name) => /compose|broadcast|sign[A-Z]/.test(name)
            && messaging[name].mock?.calls.length > 0);
        expect(composeCalls).toEqual([]);

        fireEvent.click(screen.getByRole('button', { name: 'Create a Real Wallet' }));
        expect(await screen.findByRole('dialog', { name: 'Exit demo and delete its data?' })).toBeInTheDocument();
    });

    it('keeps the balance check for a real wallet', async () => {
        const messaging = mount('real-w');
        expect(await screen.findByText('Loading…')).toBeInTheDocument();
        expect(messaging.getWalletBalances).toHaveBeenCalled();
        expect(screen.queryByText(/Demo wallets can't move funds/)).toBeNull();
    });
});
