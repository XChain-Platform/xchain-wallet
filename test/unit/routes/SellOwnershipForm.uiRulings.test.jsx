// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const BITCOIN = 'bitcoin-mainnet';
const LITECOIN = 'litecoin-mainnet';
const BTC_ADDRESS = {
    id: 'address-btc',
    address: 'bc1qsellsell0000000000000000000000000000',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const LTC_ADDRESS = {
    id: 'address-ltc',
    address: 'ltc1qsellsell000000000000000000000000000',
    publicKey: '02bb',
    derivationPath: "m/84'/2'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

vi.mock('../../../packages/core/src/shared/routes/AddressList.jsx', () => ({
    AddressList: ({ onPick }) => (
        <button type="button" onClick={() => onPick(LTC_ADDRESS, LITECOIN)}>
            Pick Litecoin source
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

function messagingWith(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BITCOIN]: [BTC_ADDRESS],
            [LITECOIN]: [LTC_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [BITCOIN]: [{
                address: BTC_ADDRESS.address,
                balances: {
                    native: { tick: 'BTC', quantity: '1', divisibility: 8 },
                    tokens: [{ tick: 'GOLD', quantity: '10', divisibility: 0 }],
                },
            }],
            [LITECOIN]: [{
                address: LTC_ADDRESS.address,
                balances: {
                    native: { tick: 'LTC', quantity: '1', divisibility: 8 },
                    tokens: [],
                },
            }],
        }),
        getTokenInfo: vi.fn(async ({ chainId, tick }) => {
            if (String(tick).toUpperCase() === 'GOLD') {
                return { tick: 'GOLD', creator: BTC_ADDRESS.address, divisibility: 0, maxSupply: '1000' };
            }
            return {
                tick,
                creator: chainId === LITECOIN ? LTC_ADDRESS.address : BTC_ADDRESS.address,
                locks: {},
            };
        }),
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        ...overrides,
    };
}

function mount(messaging = messagingWith()) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SellOwnershipForm
                walletId="wallet-1"
                chainId={BITCOIN}
                tick="ALPHA"
                onBack={vi.fn()}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SellOwnershipForm UI rulings', () => {
    it('starts with Network then the standard From field and puts static help in tips', async () => {
        mount();

        const from = await screen.findByLabelText('From');
        const network = screen.getByRole('button', { name: /^Network:/ });
        expect(network.compareDocumentPosition(from) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(from).toHaveAttribute('readonly');
        expect(from).toHaveValue(BTC_ADDRESS.address);
        expect(screen.getByRole('button', { name: 'Choose source address' })).toBeInTheDocument();
        expect(screen.queryByText('Selling the name')).not.toBeInTheDocument();

        for (const label of ['From', 'How to sell', 'Get paid in', 'Expires after (blocks)', 'Memo']) {
            expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
        }
        expect(screen.getByRole('button', { name: /^About Price/ })).toBeInTheDocument();
        expect(screen.queryByText('Open order: anyone can take the offer at your price; cancel before it matches.'))
            .not.toBeInTheDocument();

        const submit = screen.getByRole('button', { name: 'List name for sale' });
        expect(submit.className).toMatch(/success/);
        expect(submit.querySelector('svg')).not.toBeNull();
    });

    it('uses TokenField and formats Price for the selected currency without changing its raw value', async () => {
        mount();

        const price = await screen.findByRole('textbox', { name: 'Price (BTC)' });
        fireEvent.change(price, { target: { value: '1' } });
        fireEvent.blur(price);
        expect(price).toHaveValue('1.00000000');

        fireEvent.change(price, { target: { value: '1.123456789' } });
        expect(await screen.findByText('Amount can have at most 8 decimal places.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        const tokenField = screen.getByRole('button', { name: 'Price token: Select a token' });
        expect(tokenField).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Price token' })).toBeInTheDocument();
        fireEvent.click(tokenField);
        fireEvent.click(await screen.findByRole('button', { name: /^Select GOLD on Bitcoin/ }));

        expect(await screen.findByRole('button', { name: 'Price token: GOLD on Bitcoin' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Price (GOLD)' })).toHaveValue('1');
    });

    it('switches Network, keeps a cross-chain source pick, and clears the old price token', async () => {
        mount();
        await screen.findByLabelText('From');
        fireEvent.click(screen.getByRole('tab', { name: 'Another token' }));
        fireEvent.click(screen.getByRole('button', { name: 'Price token: Select a token' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Select GOLD on Bitcoin/ }));
        expect(await screen.findByRole('button', { name: 'Price token: GOLD on Bitcoin' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Choose source address' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Pick Litecoin source' }));

        await waitFor(() => expect(screen.getByLabelText('From')).toHaveValue(LTC_ADDRESS.address));
        expect(screen.getByRole('button', { name: /^Network:/ })).toHaveTextContent('Litecoin');
        expect(screen.getByRole('button', { name: 'Price token: Select a token' })).toBeInTheDocument();
    });

    it('keeps the watcher form and review actions green with the sale icon and action name', async () => {
        mount(messagingWith({
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
            buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'aa00' }),
        }));

        fireEvent.change(await screen.findByRole('textbox', { name: 'Price (BTC)' }), { target: { value: '5' } });
        const formSubmit = screen.getByRole('button', { name: 'List name for sale' });
        expect(formSubmit.className).toMatch(/success/);
        expect(formSubmit.querySelector('svg')).not.toBeNull();
        fireEvent.click(formSubmit);

        const reviewSubmit = await screen.findByRole('button', { name: /Create unsigned transaction: list name for sale/i });
        expect(reviewSubmit.className).toMatch(/success/);
        expect(reviewSubmit.querySelector('svg')).not.toBeNull();
    });
});
