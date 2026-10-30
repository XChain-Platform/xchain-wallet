// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PlaceOrderPanel } from '../../../packages/core/src/shared/components/PlaceOrderPanel.jsx';

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
// The review prints give and get in the plain spelling the order carries;
// the price row printed the typed text, so 00012 or .5 read differently
// from the amounts beside it.
describe('PlaceOrderPanel review price', () => {
    it.each([
        ['0002', '2'],
        ['.5', '0.5'],
        ['1.50', '1.5'],
    ])('shows the typed price %s as %s', async (typed, shown) => {
        const messaging = messagingFor({ getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }) });
        render(panel(messaging));
        await settle();
        fireEvent.change(screen.getByLabelText('Price (BTC)'), { target: { value: typed } });
        fireEvent.change(screen.getByLabelText('Size (XCHAIN)'), { target: { value: '1' } });
        fireEvent.click(await screen.findByRole('button', { name: 'Review' }));

        const label = await screen.findByText('Price', { selector: 'dt' });
        expect(label.nextElementSibling).toHaveTextContent(`${shown} BTC/XCHAIN`);
        expect(label.nextElementSibling.textContent.trim()).toBe(`${shown} BTC/XCHAIN`);
    });
});
