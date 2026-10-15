// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';
import { Home } from '../../../packages/core/src/shared/routes/Home.jsx';
import { Receive } from '../../../packages/core/src/shared/routes/Receive.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXI=') },
}));

const CHAIN_ID = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    addressType: 'p2wpkh',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
});
const SETTINGS = Object.freeze({
    ...createDefaultSettings(),
    fees: {
        [CHAIN_ID]: { strategy: null, customSatsPerKb: null, rbfByDefault: true },
    },
});

function startupMessaging() {
    const balances = {
        native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
        tokens: [],
    };
    const methods = {
        getSettings: () => Promise.resolve(SETTINGS),
        updateSettings: () => Promise.resolve(SETTINGS),
        listWallets: () => Promise.resolve([{ id: 'wallet-1', name: 'Main wallet' }]),
        listAccounts: () => Promise.resolve([
            { id: 'account-1', walletId: 'wallet-1', name: 'Account 1', index: 0 },
        ]),
        getAddressesByChain: () => Promise.resolve({ [CHAIN_ID]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({ [CHAIN_ID]: ADDRESS }),
        getNewestAddress: () => Promise.resolve(ADDRESS),
        getWalletBalances: () => Promise.resolve({
            [CHAIN_ID]: [{ address: ADDRESS.address, balances }],
        }),
        getAddressBalances: () => Promise.resolve(balances),
        getAddressHistory: () => Promise.resolve([]),
        getAddressMempool: () => Promise.resolve([]),
        getPendingTxsForAddress: () => Promise.resolve([]),
        getLinksForAddress: () => Promise.resolve([]),
        getIndexerWatermark: () => Promise.resolve({ watermark: null }),
        getCoinpayObligationsForAddress: () => Promise.resolve([]),
        getMultisigReceiveAddress: () => Promise.resolve(null),
        listMultisigReceiveAddresses: () => Promise.resolve([]),
        listPendingAirdropsForWallet: () => Promise.resolve([]),
        listConfirmSessions: () => Promise.resolve({ sessions: [] }),
        listConnectedSites: () => Promise.resolve([]),
        listContacts: () => Promise.resolve([]),
        signerReady: () => Promise.resolve({ ready: true }),
    };
    return new Proxy(methods, {
        get: (target, method) => target[method] || (() => Promise.resolve([])),
    });
}

const routes = [
    [
        'Home',
        <Home activeWalletId="wallet-1" activeAccountId="account-1" />,
        () => screen.findByRole('tablist', { name: 'Wallet view' }),
    ],
    [
        'Send',
        <Send walletId="wallet-1" accountId="account-1" />,
        () => screen.findByLabelText('To'),
    ],
    [
        'Receive',
        <Receive walletId="wallet-1" accountId="account-1" />,
        () => screen.findByDisplayValue(ADDRESS.address),
    ],
    [
        'History',
        <History walletId="wallet-1" accountId="account-1" />,
        () => screen.findByText('No activity yet'),
    ],
    [
        'Settings',
        <Settings
            activeWallet={{ id: 'wallet-1', name: 'Main wallet' }}
            activeAccount={{ id: 'account-1', name: 'Account 1', index: 0 }}
        />,
        () => screen.findByLabelText('Theme'),
    ],
];

const REACT_WARNING = /(?:warning|react|not wrapped in act|configured to support act)/i;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('startup route console audit', () => {
    it.each(routes)('%s starts without console errors or React warnings', async (_name, route, ready) => {
        const errors = vi.spyOn(console, 'error');
        const warnings = vi.spyOn(console, 'warn');

        render(
            <MessagingProvider shell="web" messaging={startupMessaging()}>
                {route}
            </MessagingProvider>,
        );
        await ready();
        cleanup();

        expect(errors.mock.calls).toEqual([]);
        expect(warnings.mock.calls.filter((args) => REACT_WARNING.test(args.join(' '))))
            .toEqual([]);
    });
});
