// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-148: the pay-to-buy panel told every buyer that "Any LTC wallet can trigger
// a fill", including on dispensers that refuse most of them.
//
// A dispenser may carry an ALLOW_LIST or a BLOCK_LIST, checked in
// `xchain-indexer/src/actions/dispense.js` against the payer. The gate runs
// AFTER the coin has moved, because a dispenser is triggered by a BARE coin
// payment with no XChain action of its own - so a buyer the list refuses does
// not get a rejection, they get a `DISPENSE` recorded
// `invalid: DESTINATION (dispenser allow list)` and no refund.
//
// MEASURED on Litecoin regtest 2026-07-30, driving the lane end to end
// (test/e2e/tests/dispensers/allow-list-gate.regtest.spec.js): two identical
// 0.05 LTC payments to one dispenser, differing only in who sent them. The
// listed buyer was credited 25 XCHAIN; the unlisted buyer was refused and was
// down **5,005,460 sats** - the trigger price plus the miner fee - holding
// nothing. The panel had read neither list field, though the explorer serves
// both on the row it was already reading and the OWNER's own view of the same
// page prints them.
//
// These drive the real component, because the defect was a sentence the panel
// rendered unconditionally rather than a calculation.

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
        id: 'addr-1', address: BUYER, publicKey: '02ab',
        derivationPath: "m/84'/2'/0'/0/0", source: 'hd',
    }],
};

/** An ordinary coin-priced dispenser owned by somebody else. */
const OPEN_DISPENSER = {
    action_index: '1700',
    source: OWNER,
    address: OWNER,
    give_tick: 'XCHAIN',
    give_amount: '25',
    get_tick: null,
    get_coin: 'LTC',
    get_amount: '0.05',
    fiat: null,
    fiat_amount: null,
    oracle_address: null,
    allow_list: null,
    block_list: null,
    escrow_remaining: '100',
    status: 'open',
    current_status: 'open',
};

const ALLOW_GATED = { ...OPEN_DISPENSER, action_index: '1701', allow_list: '1690' };
const BLOCK_GATED = { ...OPEN_DISPENSER, action_index: '1702', block_list: '1691' };
const BOTH_GATED = { ...OPEN_DISPENSER, action_index: '1703', allow_list: '1690', block_list: '1691' };

function mount(dispenser) {
    const messaging = {
        getDispenserByActionIndex: vi.fn().mockResolvedValue(dispenser),
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getDispenses: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: BUYER,
                balances: { native: { tick: 'LTC', quantity: '100000000', divisibility: 8 }, tokens: [] },
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
                walletId: 'w', chainId: CHAIN, actionIndex: dispenser.action_index,
                onBack() {}, onCanceled() {},
            }),
        ),
    );
    return messaging;
}

afterEach(() => cleanup());

describe('restricted dispenser, buyer view (D-148)', () => {
    it('stops claiming any wallet can trigger a gated dispenser', async () => {
        mount(ALLOW_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(/Any LTC wallet can trigger a fill/.test(text),
            'the panel tells a buyer any wallet can trigger a dispenser that will refuse most of '
            + `them, and the refused payment is not returned: ${text.slice(0, 400)}`)
            .toBe(false);
    });

    it('names the allow-list, and says a refused payment is not returned', async () => {
        mount(ALLOW_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text, 'the buyer is not told the dispenser is restricted at all')
            .toMatch(/restricted/i);
        expect(text, 'the buyer cannot see WHICH list decides whether their payment works')
            .toMatch(/list #1690/);
        // The money sentence. Without it "restricted" reads like a rejection
        // the buyer walks away from, which is exactly what it is not.
        expect(text, 'the buyer is not told the coin is spent either way')
            .toMatch(/not returned/i);
    });

    it('names a block-list the same way', async () => {
        mount(BLOCK_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/restricted/i);
        expect(text, 'a block-list gates in the OPPOSITE direction and must be described as such')
            .toMatch(/barred/i);
        expect(text).toMatch(/list #1691/);
    });

    it('describes both lists when a dispenser carries both', async () => {
        mount(BOTH_GATED);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/list #1690/);
        expect(text).toMatch(/list #1691/);
    });

    it('leaves the ungated case exactly as it was', async () => {
        // The control, and it matters: most dispensers carry no list, and
        // warning about a restriction that does not exist would teach buyers to
        // ignore the warning that does.
        mount(OPEN_DISPENSER);
        await screen.findByText(/Pay to buy/);
        const text = document.body.textContent || '';
        expect(text).toMatch(/Any LTC wallet can trigger a fill/);
        expect(text, 'an unrestricted dispenser must not be described as restricted')
            .not.toMatch(/restricted/i);
        expect(text).toMatch(/Send exactly/);
    });
});
