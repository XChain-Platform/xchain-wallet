// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Send review copy for a destination that runs open dispensers: the
// arithmetic (whole fills, capped at the escrow left) and the refusal
// warnings, without mounting Send.

import { describe, it, expect } from 'vitest';
import { dispenserDestinationNotice } from '../../../packages/core/src/shared/hooks/useDispenserDestination.js';

const PAY_TO = 'bc1qpaytopaytopaytopaytopaytopaytopaytopa';
const PAYER = 'bc1qpayerpayerpayerpayerpayerpayerpayerpa';

function entry(row = {}, extra = {}) {
    return {
        row: {
            action_index: '9001', address: PAY_TO, give_tick: 'DOGI', give_amount: '5',
            get_coin: 'BTC', get_amount: '0.01', current_status: 'open', escrow_remaining: '500',
            ...row,
        },
        allowMembers: null,
        blockMembers: null,
        oracle: null,
        ...extra,
    };
}

describe('dispenserDestinationNotice', () => {
    it('is null when the destination runs no open dispenser', () => {
        expect(dispenserDestinationNotice({ dispensers: [], payer: PAYER, amount: '1' })).toBeNull();
    });

    it('counts whole fills exactly, never by float division', () => {
        // 0.03 / 0.01 in floats is 2.9999999999999996, which floors to 2.
        const n = dispenserDestinationNotice({ dispensers: [entry()], payer: PAYER, amount: '0.03' });
        expect(n.summary).toBe('This pays dispenser #9001: you would receive 15 DOGI.');
        expect(n.warnings).toEqual([]);
    });

    it('caps at the escrow left and says the rest is not refunded', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry({ escrow_remaining: '10' })], payer: PAYER, amount: '0.05',
        });
        expect(n.summary).toMatch(/you would receive 10 DOGI, all it has left; the rest of this payment is not refunded/);
    });

    it('names the payment token when the amount buys no whole fill', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry({ get_tick: 'XCHAIN', get_amount: '5' })], payer: PAYER, amount: '4',
        });
        expect(n.summary).toMatch(/below its price of 5 XCHAIN a fill and would buy nothing/);
    });

    it('says a payment below the price buys nothing', () => {
        const n = dispenserDestinationNotice({ dispensers: [entry()], payer: PAYER, amount: '0.005' });
        expect(n.summary).toMatch(/below its price of 0\.01 BTC a fill and would buy nothing/);
    });

    it('does not size a fiat-priced purchase', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry({ get_amount: '0', fiat_code: 'USD' }, { oracle: 'live' })],
            payer: PAYER,
            amount: '1',
        });
        expect(n.summary).toMatch(/priced in USD, so what you would receive is fixed only when the payment lands/);
        expect(n.summary).not.toMatch(/\b0 BTC\b/);
    });

    it('warns when the payer is off the allow list, and when the oracle is dark', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry({ get_amount: '0', fiat_code: 'USD' }, {
                allowMembers: [PAY_TO, 'bc1qsomeoneelse'], oracle: 'dark',
            })],
            payer: PAYER,
            amount: '1',
        });
        expect(n.warnings).toHaveLength(2);
        expect(n.warnings[0]).toMatch(/address you are sending from is not allowed to buy/);
        expect(n.warnings[1]).toMatch(/oracle has no current price/);
    });

    it('uses explicit stale, available, and unknown price states', () => {
        const stale = dispenserDestinationNotice({
            dispensers: [entry({ price_stale: true }, { oracle: 'dark' })], payer: PAYER, amount: '1',
        });
        const available = dispenserDestinationNotice({
            dispensers: [entry({ price_stale: false }, { oracle: 'dark' })], payer: PAYER, amount: '1',
        });
        const unknown = dispenserDestinationNotice({
            dispensers: [entry({}, { oracle: 'dark' })], payer: PAYER, amount: '1',
        });
        expect(stale.warnings).toEqual([
            'Not selling right now: no price in the last 24 hours. '
                + 'A payment made now would be refused and kept.',
        ]);
        expect(available.warnings).toEqual([]);
        expect(unknown.warnings).toEqual([expect.stringMatching(/oracle has no current price/)]);
    });

    it('says a dispenser whose own pay-to is off its allow list sells to nobody', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry({}, { allowMembers: [PAYER] })], payer: PAYER, amount: '0.01',
        });
        expect(n.warnings).toHaveLength(1);
        expect(n.warnings[0]).toMatch(/cannot sell to anyone/);
    });

    it('names every dispenser at a shared address and gives no estimate', () => {
        const n = dispenserDestinationNotice({
            dispensers: [entry(), entry({ action_index: '9002' }, { oracle: 'dark' })],
            payer: PAYER,
            amount: '0.03',
        });
        expect(n.summary).toMatch(/the 2 open dispensers at this address \(#9001, #9002\)/);
        expect(n.summary).not.toMatch(/you would receive \d/);
        expect(n.warnings).toEqual([expect.stringMatching(/^Dispenser #9002: .*oracle has no current price/)]);
    });
});
