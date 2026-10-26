// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a Send draft saved on mainnet is not offered on testnet,
// and a fiat-mode draft restored under another display currency keeps its coin
// amount instead of reading the old fiat text as the new currency.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { Send } from '../../packages/core/src/shared/routes/Send.jsx';

// A priced coin keeps the fiat entry mode alive; without a rate Send falls back
// to coin entry on its own and the currency check would pass by accident.
vi.mock('../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => ({
    ...(await importOriginal()),
    useTickFiatRate: ({ fiatCurrency }) => ({
        rate: 50000, chainCoin: 'bitcoin', fiatCurrency, source: 'oracle',
        fetchedAt: '2026-10-24T00:00:00.000Z', stale: false,
    }),
}));

const WALLET_ID = 'net-draft-wallet';
const KEY = `xc:formdraft:send:${WALLET_ID}`;
const SOURCE = {
    id: 'source-1',
    address: 'tb1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aa',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};

function createMessaging({ network, chainId, fiatCurrency = 'USD' }) {
    const target = {
        getSettings: vi.fn().mockResolvedValue({
            walletMode: 'full',
            activeNetwork: network,
            fiatCurrency,
            privacy: { formDraftTtlMs: 86_400_000 },
            grace: { testSendThresholdSats: 0 },
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [chainId]: SOURCE }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [],
        }),
        getWalletBalances: vi.fn().mockResolvedValue({ [chainId]: [] }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked', unlocked: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            object[property] = stub;
            return stub;
        },
    });
}

function mountSend(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ToastHost><Send walletId={WALLET_ID} onBack={() => {}} /></ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('Send draft across a network switch', () => {
    it('does not offer a mainnet draft on testnet', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values: {
                chainId: 'bitcoin-mainnet',
                toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                tick: 'BTC',
                amount: '1.5',
                memo: '',
            },
        }));

        mountSend(createMessaging({ network: 'testnet', chainId: 'bitcoin-testnet' }));

        expect(await screen.findByLabelText(/^To$/)).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
        });
        // The mainnet record stays for the user's return to mainnet.
        expect(localStorage.getItem(KEY)).toContain('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    });

    it('keeps the coin amount when a fiat draft restores under another currency', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'mainnet',
            values: {
                chainId: 'bitcoin-mainnet',
                toAddress: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
                tick: 'BTC',
                amount: '0.002',
                amountInputMode: 'fiat',
                fiatAmount: '100',
                fiatCurrency: 'USD',
                memo: '',
            },
        }));

        mountSend(createMessaging({ network: 'mainnet', chainId: 'bitcoin-mainnet', fiatCurrency: 'EUR' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

        await waitFor(() => {
            expect(document.getElementById('send-amount')).toHaveValue('0.002');
        });
    });
});
