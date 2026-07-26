// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-37 / : the dispenser Buy panel used to show no balance, no Max and
// no pre-flight, so a buyer holding zero of the payment token could click
// through Review buy and broadcast a SEND the chain then rejected as
// `invalid: insufficient funds` - a network fee paid for nothing. These drive
// the real component: the panel must state what the paying address actually
// holds, size Max off it, and stop an unfunded buy at the form.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';
const OWNER = 'bc1qownerownerownerownerownerownerownerow';

const ADDRESSES = {
    [CHAIN]: [
        {
            id: 'addr-1',
            address: BUYER,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
};

// Token-paid dispenser: 5 MEMEVALID per fill buys 100 PEPECREATURE.
const DISPENSER = {
    action_index: '3543',
    source: OWNER,
    address: OWNER,
    give_tick: 'PEPECREATURE',
    give_amount: '100',
    get_tick: 'MEMEVALID',
    get_amount: '5',
    escrow_remaining: '1000',
    status: 'open',
    current_status: 'open',
};

function mount({ buyerHolds }) {
    const tokens = buyerHolds == null
        ? []
        : [{ tick: 'MEMEVALID', quantity: buyerHolds, divisibility: 0 }];
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(DISPENSER),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: BUYER,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens,
                },
            }],
        }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(DispenserDetail, {
                walletId: 'w',
                chainId: CHAIN,
                actionIndex: '3543',
                onBack() {},
                onCanceled() {},
            }),
        ),
    );
    return messaging;
}

const buyButton = () => screen.findByRole('button', { name: /^Buy \d+ fills?$/ });

afterEach(() => cleanup());

describe('dispenser Buy panel funding check (D-37)', () => {
    it('states what the paying address holds of the payment token', async () => {
        mount({ buyerHolds: '250' });
        expect(await screen.findByText(/250 MEMEVALID available/)).toBeInTheDocument();
    });

    it('says "0 available" rather than nothing when the buyer holds none', async () => {
        mount({ buyerHolds: null });
        expect(await screen.findByText(/0 MEMEVALID available/)).toBeInTheDocument();
    });

    it('blocks the buy before broadcast when the buyer holds none of the payment token', async () => {
        const messaging = mount({ buyerHolds: null });
        await screen.findByText(/0 MEMEVALID available/);
        const buy = await buyButton();
        await waitFor(() => expect(buy).toBeDisabled());
        // The pre-flight verdict is on screen, and no signing path was entered.
        const panel = await screen.findByTestId('preflight-chip');
        expect(panel).toHaveTextContent(/Will likely fail/);
        fireEvent.click(buy);
        expect(screen.queryByRole('button', { name: /Sign buy/ })).not.toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('blocks a fill count the balance cannot cover, and allows one it can', async () => {
        mount({ buyerHolds: '12' });
        await screen.findByText(/12 MEMEVALID available/);
        // 3 fills = 15 MEMEVALID against a 12 balance.
        fireEvent.change(await screen.findByLabelText(/Fills/i), { target: { value: '3' } });
        await waitFor(async () => expect(await buyButton()).toBeDisabled());
        // 2 fills = 10 MEMEVALID, affordable.
        fireEvent.change(await screen.findByLabelText(/Fills/i), { target: { value: '2' } });
        await waitFor(async () => expect(await buyButton()).toBeEnabled());
    });

    it('Max fills the largest affordable whole fill count', async () => {
        mount({ buyerHolds: '12' });
        await screen.findByText(/12 MEMEVALID available/);
        fireEvent.click(await screen.findByRole('button', { name: /^Max$/ }));
        // floor(12 / 5) = 2, never 2.4 and never a float-misfloored 1.
        await waitFor(() => expect(screen.getByLabelText(/Fills/i)).toHaveValue('2'));
        expect(await buyButton()).toBeEnabled();
    });

    it('lets a funded buyer reach the signing step', async () => {
        mount({ buyerHolds: '250' });
        await screen.findByText(/250 MEMEVALID available/);
        fireEvent.click(await buyButton());
        expect(await screen.findByRole('button', { name: /Sign buy/ })).toBeInTheDocument();
    });
});
