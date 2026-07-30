// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-144: the pay-to-buy panel told a buyer to send ZERO coin for a FIAT-priced
// dispenser.
//
// A fiat dispenser stores no coin price. GET_AMOUNT is 0 by protocol convention
// and the real price is derived at settlement from FIAT_AMOUNT and the validator
// price snapshot for the coin being paid (xchain-indexer dispense.js ->
// reversePriceMatch). This panel priced straight off GET_AMOUNT and rendered
// "Send exactly 0 LTC per fill", with a Copy amount button beside it. A buyer who
// followed that pays a network fee and receives nothing; a buyer who reads it
// concludes the goods are free.
//
// The explorer serves `fiat`, `fiat_amount` and `oracle_address` on the same
// dispenser row the panel already reads, so the fix is to say what is true.
//
// These drive the real component rather than the formatter, because the defect
// was a rendering decision (which branch of the panel runs), not arithmetic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DispenserDetail } from '../../../packages/core/src/shared/routes/DispenserDetail.jsx';

const CHAIN = 'litecoin-mainnet';
const BUYER = 'ltc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbu';
const OWNER = 'ltc1qownerownerownerownerownerownerownerow';

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: BUYER,
        publicKey: '02ab',
        derivationPath: "m/84'/2'/0'/0/0",
        source: 'hd',
    }],
};

/**
 * A validator-priced (Mode A) fiat dispenser, shaped exactly as the explorer
 * serves one: GET_AMOUNT "0", no GET_TICK, and the fiat fields beside them.
 * Taken from a real regtest row (DISPENSER 1642, `DISPENSER|0|LTC|XCHAIN|25||100|LTC||0||USD|3`).
 */
const FIAT_DISPENSER = {
    action_index: '1642',
    source: OWNER,
    address: OWNER,
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_tick: null,
    get_coin: 'LTC',
    get_amount: '0',
    fiat: 'USD',
    fiat_amount: '3',
    oracle_address: null,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
};

/** The same dispenser priced the ordinary way, as the control. */
const COIN_DISPENSER = {
    ...FIAT_DISPENSER,
    action_index: '1643',
    get_amount: '0.1',
    fiat: null,
    fiat_amount: null,
};

function mount(dispenser) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: BUYER,
                balances: {
                    native: { tick: 'LTC', quantity: '100000000', divisibility: 8 },
                    tokens: [],
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
                actionIndex: dispenser.action_index,
                onBack() {},
                onCanceled() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('fiat-priced dispenser, buyer view (D-144)', () => {
    it('never quotes a coin price of zero', async () => {
        mount(FIAT_DISPENSER);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(/(send|pay)[^.]*\b0(\.0+)?\s*LTC\b/i.test(text),
            `the panel quotes zero coin for a fiat dispenser: ${text.slice(0, 400)}`)
            .toBe(false);
    });

    it('names the price a buyer actually has to meet, in the currency it is set in', async () => {
        // Saying nothing is not a fix for saying zero: a buyer who cannot learn
        // the price cannot pay it.
        mount(FIAT_DISPENSER);
        expect(await screen.findByText(/3 USD/)).toBeInTheDocument();
    });

    it('says the coin amount is resolved when the payment lands, not now', async () => {
        // The honest part, and the reason the panel does not simply compute a
        // number: the rate that decides the fill is the one in force at
        // settlement, which is not the one on screen.
        mount(FIAT_DISPENSER);
        expect(await screen.findByText(/rate when your payment lands/i)).toBeInTheDocument();
    });

    it('still gives an exact coin figure for an ordinary coin-priced dispenser', async () => {
        // The control. The fix must not blur the normal case, where the price
        // IS stored and an exact "send this much" is the right instruction.
        mount(COIN_DISPENSER);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/Send exactly/);
        expect(text).toMatch(/0\.1 LTC/);
    });
});
