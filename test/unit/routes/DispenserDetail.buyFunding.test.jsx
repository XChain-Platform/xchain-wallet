// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-37: the dispenser Buy panel used to show no balance, no Max and
// no pre-flight, so a buyer holding zero of the payment token could click
// through Review buy and broadcast a SEND the chain then rejected as
// `invalid: insufficient funds` - a network fee paid for nothing. These drive
// the real component: the panel must state what the paying address actually
// holds, size Max off it, and stop an unfunded buy at the form.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
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

function mount({ buyerHolds, dispenser = DISPENSER }) {
    const tokens = buyerHolds == null
        ? []
        : [{ tick: 'MEMEVALID', quantity: buyerHolds, divisibility: 0 }];
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
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
        getSettings: vi.fn().mockResolvedValue({}),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|MEMEVALID', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
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

const buyButton = () => screen.getByRole('button', { name: /^Buy \d+ fills?$/ });

async function settle() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => {
            await vi.advanceTimersByTimeAsync(400);
        });
    }
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('dispenser Buy panel funding check (D-37)', () => {
    it('states what the paying address holds of the payment token', async () => {
        mount({ buyerHolds: '250' });
        await settle();
        expect(screen.getByText(/250 MEMEVALID available/)).toBeInTheDocument();
    });

    it('says "0 available" rather than nothing when the buyer holds none', async () => {
        mount({ buyerHolds: null });
        await settle();
        expect(screen.getByText(/0 MEMEVALID available/)).toBeInTheDocument();
    });

    it('blocks the buy before broadcast when the buyer holds none of the payment token', async () => {
        const messaging = mount({ buyerHolds: null });
        await settle();
        expect(screen.getByText(/0 MEMEVALID available/)).toBeInTheDocument();
        const buy = buyButton();
        expect(buy).toBeDisabled();
        // The pre-flight verdict is on screen, and no signing path was entered.
        const panel = screen.getByTestId('preflight-chip');
        expect(panel).toHaveTextContent(/Will likely fail/);
        fireEvent.click(buy);
        expect(screen.queryByRole('button', { name: /Sign buy/ })).not.toBeInTheDocument();
        expect(messaging.sendToken).not.toHaveBeenCalled();
    });

    it('blocks a fill count the balance cannot cover, and allows one it can', async () => {
        mount({ buyerHolds: '12' });
        await settle();
        expect(screen.getByText(/12 MEMEVALID available/)).toBeInTheDocument();
        // 3 fills = 15 MEMEVALID against a 12 balance.
        fireEvent.change(screen.getByLabelText(/Fills/i), { target: { value: '3' } });
        expect(buyButton()).toBeDisabled();
        // 2 fills = 10 MEMEVALID, affordable.
        fireEvent.change(screen.getByLabelText(/Fills/i), { target: { value: '2' } });
        expect(buyButton()).toBeEnabled();
    });

    it('Max fills the largest affordable whole fill count', async () => {
        mount({ buyerHolds: '12' });
        await settle();
        expect(screen.getByText(/12 MEMEVALID available/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Max$/ }));
        // floor(12 / 5) = 2, never 2.4 and never a float-misfloored 1.
        expect(screen.getByLabelText(/Fills/i)).toHaveValue('2');
        expect(buyButton()).toBeEnabled();
    });

    it('lets a funded buyer reach the shared Confirm screen', async () => {
        mount({ buyerHolds: '250' });
        await settle();
        expect(screen.getByText(/250 MEMEVALID available/)).toBeInTheDocument();
        fireEvent.click(buyButton());
        await settle();
        expect(screen.getByTestId('confirm-approve')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-source')).toHaveTextContent(BUYER.slice(0, 6));
    });

    it('keeps fill counts above the safe integer limit exact', async () => {
        const messaging = mount({
            buyerHolds: '90071992.54740993',
            dispenser: {
                ...DISPENSER,
                get_amount: '0.00000001',
                escrow_remaining: '900719925474099300',
            },
        });
        await settle();
        expect(screen.getByText(/90,071,992\.54740993 MEMEVALID available/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Fills/i), {
            target: { value: '9007199254740993' },
        });
        fireEvent.click(buyButton());
        await settle();
        expect(messaging.composeForConfirm).toHaveBeenCalled();
        expect(messaging.composeForConfirm).toHaveBeenCalledWith(expect.objectContaining({
            amount: '90071992.54740993',
        }));
    });
});
