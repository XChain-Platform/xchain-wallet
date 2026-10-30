// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';
import { normalizeMarket } from '../../../packages/core/src/shared/routes/MarketsList.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'a1', address: 'bc1qexample', publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 's1',
};

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

function balances({ xchain = '123456789', xchainDivisibility = 2, btc = '500000000' } = {}) {
    return {
        [CHAIN]: [{
            address: ADDRESS.address,
            balances: {
                native: { tick: 'BTC', quantity: btc, divisibility: 8 },
                tokens: [{ tick: 'XCHAIN', quantity: xchain, divisibility: xchainDivisibility }],
            },
        }],
    };
}

function messagingFor(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS.id }),
        getWalletBalances: vi.fn().mockResolvedValue(balances()),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 2 }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...overrides,
    };
}

function panel(messaging, tick1 = 'XCHAIN', tick2 = 'BTC') {
    return (
        <MessagingProvider shell="desktop" messaging={messaging}>
            <PlaceOrderPanel walletId="w" chainId={CHAIN} tick1={tick1} tick2={tick2} />
        </MessagingProvider>
    );
}

async function settle() {
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
}
// A market row or route naming one token on both sides composes give X for
// get X, which consensus accepts; whoever matches it takes the difference.
describe('PlaceOrderPanel on a market with the same token on both sides', () => {
    it.each([
        ['XCHAIN', 'XCHAIN'],
        ['xchain', 'XCHAIN'],
        ['BTC', 'BTC'],
    ])('refuses to compose on %s/%s', async (tick1, tick2) => {
        const messaging = messagingFor();
        render(panel(messaging, tick1, tick2));
        await settle();
        fireEvent.change(screen.getByLabelText(`Price (${tick2})`), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText(`Size (${tick1})`), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place buy order' }));
        await settle();

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'This market has the same token on both sides, so it cannot take an order.',
        );
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('still composes on a market with two different tokens', async () => {
        const messaging = messagingFor();
        render(panel(messaging));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: '0.001' } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Place buy order' }));
        await settle();

        expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1);
    });
});

describe('normalizeMarket', () => {
    it.each([
        [{ tick1: 'XCP', tick2: 'XCP' }],
        [{ tick1: 'xcp', tick2: 'XCP' }],
        [{ give_tick: 'PEPE', get_tick: ' pepe ' }],
    ])('drops a row that names one token on both sides: %j', (row) => {
        expect(normalizeMarket(row)).toBeNull();
    });

    it('keeps a row with two different tokens', () => {
        expect(normalizeMarket({ tick1: 'XCP', tick2: 'BTC' })).toMatchObject({ tick1: 'XCP', tick2: 'BTC' });
    });
});
