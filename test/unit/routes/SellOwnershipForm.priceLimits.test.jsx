// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A sale price the network refuses, or one no buyer could ever pay, is
// refused on the form before anything is composed: the network takes at most
// 42 digits before the decimal point, and a token price cannot exceed that
// token's maximum supply.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsellersellersellersellersellersellerx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function messagingWith() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: ADDRESS.address,
                balances: {
                    native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                    tokens: [{ tick: 'GOLD', quantity: '5', divisibility: 0 }],
                },
            }],
        }),
        getTokenInfo: vi.fn(async ({ tick }) => (String(tick).toUpperCase() === 'ALPHA'
            ? { tick: 'ALPHA', creator: ADDRESS.address, locks: {} }
            : { tick: 'GOLD', creator: 'bc1qsomeoneelse', divisibility: 0, maxSupply: '1000', locks: {} })),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
    };
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SellOwnershipForm walletId="wallet-1" chainId={CHAIN} tick="ALPHA" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

async function listAt(price) {
    fireEvent.change(screen.getByRole('textbox', { name: /^Price/ }), { target: { value: price } });
    const list = screen.getByRole('button', { name: 'List name for sale' });
    await waitFor(() => expect(list).not.toBeDisabled());
    fireEvent.click(list);
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SellOwnershipForm price limits', () => {
    it('refuses a coin price with more than 42 digits before the decimal point', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await screen.findByLabelText(/^Price/);

        await listAt('1'.repeat(43));

        expect(await screen.findByText('Price is too large. The network takes at most 42 digits before the decimal point.'))
            .toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        await listAt('1'.repeat(42));
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    });

    it('refuses a token price above that token\'s maximum supply', async () => {
        const messaging = messagingWith();
        mount(messaging);
        await screen.findByLabelText(/^Price/);
        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose price token' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select GOLD on Bitcoin/ }));
        await screen.findByRole('textbox', { name: /^Price \(in GOLD\)/ });

        await listAt('1001');

        expect(await screen.findByText("Price can't be more than the 1000 GOLD that can ever exist."))
            .toBeInTheDocument();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        await listAt('1000');
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
    });
});
