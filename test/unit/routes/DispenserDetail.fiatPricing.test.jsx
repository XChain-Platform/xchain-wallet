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

/**
 * A USER-ORACLE (Mode B) dispenser, shaped as the explorer serves one: a fiat
 * code and an ORACLE_ADDRESS, and NO fiat amount - the price is not on this row
 * at all, it is on the oracle's own published feed. Taken from the real regtest
 * row DISPENSER 1955 (`DISPENSER|0|LTC|XCHAIN|5||100|LTC||0||USD||rltc1qguj…`).
 */
const ORACLE_ADDRESS = 'rltc1qguj32tkf0lx9dtr3pgega4rxjl980rjdh8h6la';
const ORACLE_DISPENSER = {
    ...FIAT_DISPENSER,
    action_index: '1955',
    give_amount: '5',
    fiat_amount: null,
    oracle_address: ORACLE_ADDRESS,
};

/** What `oracle.feeds` answers for that address: one live quote, one still maturing. */
const ORACLE_FEEDS = [{
    key: 'LTC/XCHAIN/USD',
    coin: 'LTC',
    tick: 'XCHAIN',
    fiat: 'USD',
    live: { value: '1.5', fee: '0.01', effective: true },
    pending: { value: '9.99', fee: '0.01', effective: false },
    history: [],
}];

function mount(dispenser, extraMessaging = {}) {
    const messaging = {
        ...extraMessaging,
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

    // A Mode B dispenser is the harder half of the same rule. Its price is not on
    // the dispenser row - it is published by a THIRD PARTY at the oracle address
    // the row names - so the panel said only "Set by an oracle, in USD" and left
    // the buyer with no number at all. That is unactionable in a way that costs
    // money in both directions: pay too little and the dispense is refused with
    // the coin KEPT (dispense.js runs its price match after the payment has
    // moved), pay too much and the remainder is floored away as a tip.
    it('reads the oracle price and states it, for a user-oracle dispenser', async () => {
        const messaging = mount(ORACLE_DISPENSER, {
            oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS),
        });
        // The label is "Price per fill" and this dispenser gives 5 tokens a fill,
        // so the number under it has to be 5 x the oracle's per-token quote. The
        // oracle publishes the price of ONE TOKEN (its publishing form says so,
        // and settlement divides by GIVE_AMOUNT under
        // DISPENSER_ORACLE_PER_TOKEN_PRICE), so printing the bare 1.5 here
        // under-stated what this dispenser costs by a factor of five.
        expect(await screen.findByText(/7\.5 USD/)).toBeInTheDocument();
        expect(messaging.oracleFeeds).toHaveBeenCalledWith({
            chainId: CHAIN, address: ORACLE_ADDRESS,
        });
    });

    it('shows the per-token quote beside the fill price, so the two can be reconciled', async () => {
        // The oracle's own feed publishes 1.5, and a buyer who looks it up must
        // not read the panel's 7.5 as a contradiction.
        mount(ORACLE_DISPENSER, { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        await screen.findByText(/7\.5 USD/);
        expect(document.body.textContent || '').toMatch(/5 XCHAIN at 1\.5 USD each/);
    });

    it('adds no breakdown when a fill IS one token', async () => {
        // At GIVE_AMOUNT 1 the fill price and the per-token price are the same
        // number, and restating it would read as two different prices.
        mount({ ...ORACLE_DISPENSER, give_amount: '1' }, {
            oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS),
        });
        expect(await screen.findByText(/1\.5 USD/)).toBeInTheDocument();
        expect(document.body.textContent || '').not.toMatch(/at 1\.5 USD each/);
    });

    it('quotes the LIVE feed, never the one still maturing', async () => {
        // Every PRICE v1 publish is inert for 24 hours, so the pending row
        // prices nothing yet. Showing it would be a price no payment made today
        // can buy at - worse than no number, because it looks like one.
        mount(ORACLE_DISPENSER, { oracleFeeds: vi.fn().mockResolvedValue(ORACLE_FEEDS) });
        await screen.findByText(/7\.5 USD/);
        expect(document.body.textContent || '').not.toMatch(/9\.99/);
    });

    it('says the oracle is dark rather than implying a price, when it publishes none', async () => {
        // A feed with nothing effective settles nothing, and a payment sent to
        // a dispenser priced by it is refused and not returned. Silence here
        // reads as "the price is just not shown yet".
        mount(ORACLE_DISPENSER, {
            oracleFeeds: vi.fn().mockResolvedValue([{ ...ORACLE_FEEDS[0], live: null }]),
        });
        await screen.findByText(/Pay to buy/);
        expect(await screen.findByText(/publishing no price/i)).toBeInTheDocument();
    });

    it('does not quote another feed from the same oracle', async () => {
        // One publisher may run many feeds; only the one matching this
        // dispenser's own tick and currency prices it. Quoting a sibling would
        // put another asset's price on this screen with total confidence.
        mount(ORACLE_DISPENSER, {
            oracleFeeds: vi.fn().mockResolvedValue([{
                key: 'LTC/OTHER/USD', coin: 'LTC', tick: 'OTHER', fiat: 'USD',
                live: { value: '42', fee: '0' }, pending: null, history: [],
            }]),
        });
        await screen.findByText(/Pay to buy/);
        expect(document.body.textContent || '').not.toMatch(/42 USD/);
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
