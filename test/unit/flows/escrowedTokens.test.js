// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-tick escrow in an address's own open offers. The anchor case is the TLTC
// report: all 12 BEER escrowed by DISPENSER 18, so the free-balance read had no
// BEER row and the token vanished from Home.

import { describe, it, expect } from 'vitest';
import { escrowedTokens, sumEscrowByTick, addPlainDecimals } from '../../../packages/core/src/flows/escrowedTokens.js';

const OWNER = 'tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37';

// The explorer's /api/dispensers/{addr}/source row for DISPENSER 18, trimmed.
const BEER_DISPENSER = {
    action_index: '18', source: OWNER, current_status: 'open', status: 'valid',
    give_tick: 'BEER', give_amount: '1', give_escrow: '12', escrow_remaining: '12', give_ownership: 0,
};

function fakeSdk({ orders = [], swaps = [], dispensers = [], fail = {} } = {}) {
    const reply = (name, data) => async () => {
        if (fail[name]) throw new Error(`${name} down`);
        return { data };
    };
    return { getOrders: reply('orders', orders), getSwaps: reply('swaps', swaps), getDispensers: reply('dispensers', dispensers) };
}

const registryFor = (sdk) => ({ get: () => sdk });

describe('escrowedTokens', () => {

    it('reports the fully escrowed BEER from its open dispenser', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({ dispensers: [BEER_DISPENSER] })), chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r).toEqual({ rows: [{ tick: 'BEER', amount: '12', offers: { dispenser: 1 } }], partial: false });
    });

    it('sums one tick across orders, swaps and dispensers exactly', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({
                orders: [{ action_index: '1', source: OWNER, status: 'open', give_tick: 'GFL', give_remaining: '0.1' }],
                swaps: [{ action_index: '2', source: OWNER, status: 'open', give_tick: 'GFL', give_amount: '0.2' }],
                dispensers: [{ ...BEER_DISPENSER, give_tick: 'GFL', escrow_remaining: '0.000000000000000001' }],
            })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r.rows).toEqual([{ tick: 'GFL', amount: '0.300000000000000001', offers: { order: 1, swap: 1, dispenser: 1 } }]);
    });

    it('leaves out closed offers, ownership offers, other addresses and empty remainders', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({
                dispensers: [
                    { ...BEER_DISPENSER, current_status: 'closed' },
                    { ...BEER_DISPENSER, give_ownership: 1 },
                    { ...BEER_DISPENSER, source: 'tltc1qsomeoneelse' },
                    { ...BEER_DISPENSER, escrow_remaining: '0' },
                ],
            })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r.rows).toEqual([]);
    });

    it('marks the answer partial when one offer kind fails, keeping the others', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({ dispensers: [BEER_DISPENSER], fail: { orders: true } })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r.partial).toBe(true);
        expect(r.rows.map((x) => x.tick)).toEqual(['BEER']);
    });

    it('returns nothing for a blank address without reading', async () => {
        expect(await escrowedTokens({ sdkRegistry: registryFor(null), chainId: 'c', address: ' ' }))
            .toEqual({ rows: [], partial: false });
    });

});

describe('sumEscrowByTick / addPlainDecimals', () => {

    it('ignores malformed amounts rather than summing them', () => {
        const legs = (rows) => ({ orders: { rows: [], error: null }, swaps: { rows: [], error: null }, dispensers: { rows, error: null } });
        expect(sumEscrowByTick(legs([{ tick: 'X', escrowRemaining: '1e3' }, { tick: 'X', escrowRemaining: null }])).rows)
            .toEqual([]);
    });

    it('adds at the wider scale and trims trailing zeros', () => {
        expect(addPlainDecimals('0', '12')).toBe('12');
        expect(addPlainDecimals('1.5', '2.50')).toBe('4');
        expect(addPlainDecimals('0.1', '0.02')).toBe('0.12');
    });

});
