// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An address whose token balance could not be read is unknown, not empty: the
// escrow footer says nothing about it and the form never moves the source
// away from the default because another address looks richer.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserForm } from '../../../packages/core/src/shared/routes/DispenserForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source',
    address: 'bc1qsourcesourcesourcesourcesourcesources',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const OTHER = {
    id: 'other',
    address: 'bc1qotherotherotherotherotherotherotherot',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
};

const THIRD = {
    id: 'third',
    address: 'bc1qthirdthirdthirdthirdthirdthirdthirdth',
    publicKey: '02cc',
    derivationPath: "m/84'/0'/0'/0/2",
    source: 'hd',
};

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function mountForm(entries, active = SOURCE) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE, OTHER, THIRD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: active }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: entries }),
        getTokenInfo: vi.fn().mockResolvedValue({ tick: 'JDOG', divisibility: 0 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
    });
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DispenserForm walletId="w" initialChainId={CHAIN} initialTick="JDOG" onBack={vi.fn()} />
            </MessagingProvider>,
        );
        await drainMicrotasks();
    });
    return utils;
}

const holding = (address, quantity, extra = {}) => ({
    address,
    balances: { tokens: [{ tick: 'JDOG', quantity, divisibility: 0 }], ...extra },
});

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('DispenserForm with an unreadable balance', () => {
    it('moves to the address that holds the most when every read answered', async () => {
        const utils = await mountForm([holding(SOURCE.address, '5'), holding(OTHER.address, '9')]);
        await waitFor(() => expect(utils.getAllByText('9 JDOG available').length).toBeGreaterThan(0));
    });

    it('keeps the default source when another address could not be read', async () => {
        const utils = await mountForm([
            holding(SOURCE.address, '5'),
            holding(OTHER.address, '9'),
            { address: THIRD.address, balances: { tokens: [], unavailable: ['tokens'] } },
        ]);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
        await waitFor(() => expect(utils.getAllByText('5 JDOG available').length).toBeGreaterThan(0));
    });

    it('shows no available figure for a source whose token ledger could not be read', async () => {
        const utils = await mountForm([
            { address: SOURCE.address, balances: { tokens: [], unavailable: ['tokens'] } },
        ]);
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
        expect(utils.queryAllByText(/JDOG available/)).toHaveLength(0);
    });

    it('still shows 0 for a source that was read in full and holds none', async () => {
        const utils = await mountForm([{ address: SOURCE.address, balances: { tokens: [] } }]);
        await waitFor(() => expect(utils.getAllByText('0 JDOG available').length).toBeGreaterThan(0));
    });
});
