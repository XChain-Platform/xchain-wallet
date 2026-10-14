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

import { describe, it, expect, vi } from 'vitest';
import { escrowedTokens, sumEscrowByTick, addPlainDecimals } from '../../../packages/core/src/flows/escrowedTokens.js';
import {
    assertReferencedOfferActionable,
    readMarketExpiryClock,
    withMarketExpiry,
} from '../../../packages/core/src/flows/marketExpiry.js';

const OWNER = 'tltc1ql05c4je6cjg5ejzyrrr2nxvdr7htmf5eelek37';

// The explorer's /api/dispensers/{addr}/source row for DISPENSER 18, trimmed.
const BEER_DISPENSER = {
    action_index: '18', source: OWNER, current_status: 'open', status: 'valid',
    give_tick: 'BEER', give_amount: '1', give_escrow: '12', escrow_remaining: '12', give_ownership: 0,
};

function fakeSdk({ orders = [], swaps = [], dispensers = [], fail = {}, status, details } = {}) {
    const reply = (name, data) => async () => {
        if (fail[name]) throw new Error(`${name} down`);
        return { data };
    };
    return {
        explorer: { coin: 'TLTC' },
        getOrders: reply('orders', orders),
        getSwaps: reply('swaps', swaps),
        getDispensers: reply('dispensers', dispensers),
        ...(status ? { getStatus: vi.fn(async () => status) } : {}),
        ...(details ? { getAction: vi.fn(async (index) => details[index] ?? null) } : {}),
    };
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

    it('keeps counting a dispenser in its close window, since the escrow is still locked', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({ dispensers: [{ ...BEER_DISPENSER, current_status: 'cancelling' }] })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r).toEqual({ rows: [{ tick: 'BEER', amount: '12', offers: { dispenser: 1 }, closing: '12' }], partial: false });
    });

    it('splits the closing share from open escrow of the same tick', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({
                dispensers: [
                    { ...BEER_DISPENSER, current_status: 'cancelling' },
                    { ...BEER_DISPENSER, action_index: '20', escrow_remaining: '3' },
                    { ...BEER_DISPENSER, action_index: '21', current_status: 'cancelled' },
                ],
            })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r.rows).toEqual([{ tick: 'BEER', amount: '15', offers: { dispenser: 2 }, closing: '12' }]);
    });

    it('marks the answer partial when one offer kind fails, keeping the others', async () => {
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({ dispensers: [BEER_DISPENSER], fail: { orders: true } })),
            chainId: 'litecoin-testnet', address: OWNER,
        });
        expect(r.partial).toBe(true);
        expect(r.rows.map((x) => x.tick)).toEqual(['BEER']);
    });

    it('does not count expired order, swap, or dispenser escrow as locked', async () => {
        const status = {
            last_block: { TLTC: 500 },
            chain_tip: { TLTC: 500 },
            last_block_time: { TLTC: 2_000 },
        };
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({
                status,
                orders: [{ action_index: '1', source: OWNER, status: 'open', give_tick: 'OLD', give_amount: '2', expiration: 1_999 }],
                swaps: [{ action_index: '2', source: OWNER, status: 'open', give_tick: 'OLD', give_amount: '3', expiration: 2_000 }],
                dispensers: [{ ...BEER_DISPENSER, give_tick: 'OLD', expiration: 1_500 }],
            })),
            chainId: 'litecoin-testnet',
            address: OWNER,
        });

        expect(r).toEqual({ rows: [], partial: false });
    });

    it('uses edited live expirations instead of the frozen list values', async () => {
        const status = {
            last_block: { TLTC: 500 },
            chain_tip: { TLTC: 500 },
            last_block_time: { TLTC: 2_000 },
        };
        const r = await escrowedTokens({
            sdkRegistry: registryFor(fakeSdk({
                status,
                orders: [{ action_index: '1', source: OWNER, status: 'valid', give_tick: 'LIVE', give_amount: '2', expiration: 1_000 }],
                swaps: [{ action_index: '2', source: OWNER, status: 'valid', give_tick: 'OLD', give_amount: '3', expiration: 3_000 }],
                dispensers: [{ ...BEER_DISPENSER, action_index: '3', give_tick: 'OLD', expiration: 3_000 }],
                details: {
                    1: { state: { status: 'open', expiration: 3_000, give_remaining: '1.5' } },
                    2: { state: { status: 'open', expiration: 2_000 } },
                    3: { state: { status: 'open', expiration: 1_999 } },
                },
            })),
            chainId: 'litecoin-testnet',
            address: OWNER,
        });

        expect(r.rows).toEqual([{ tick: 'LIVE', amount: '1.5', offers: { order: 1 } }]);
    });

    it('returns nothing for a blank address without reading', async () => {
        expect(await escrowedTokens({ sdkRegistry: registryFor(null), chainId: 'c', address: ' ' }))
            .toEqual({ rows: [], partial: false });
    });

});

describe('market expiry clock and action guard', () => {
    const currentStatus = {
        last_block: { TLTC: 800 },
        chain_tip: { TLTC: 800 },
        last_block_time: { TLTC: 4_000 },
    };

    it('marks list and detail fixtures expired from the current chain block time', async () => {
        const sdk = fakeSdk({ status: currentStatus });
        const list = await withMarketExpiry(sdk, { data: [
            { action_index: '9', status: 'valid', swap_status: 'open', expiration: 3_999 },
            { action_index: '10', status: 'valid', swap_status: 'open', expiration: 4_001 },
        ] }, 'swap');
        const detail = await withMarketExpiry(sdk, {
            action_index: '11', status: 'valid', state: { status: 'open', expiration: 4_000 },
        }, 'order');

        expect(list.data[0]).toMatchObject({ status: 'valid', current_status: 'expired', swap_status: 'expired' });
        expect(list.data[1].swap_status).toBe('open');
        expect(list.data[1].state.expiry_status).toBe('open');
        expect(detail.state.status).toBe('expired');
    });

    it('rejects an expired referenced action with a plain message', async () => {
        const sdk = {
            ...fakeSdk({ status: currentStatus }),
            getAction: vi.fn(async () => ({ state: { status: 'open', expiration: 4_000 } })),
        };
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor(sdk),
            chainId: 'litecoin-testnet',
            actionData: { action: 'DISPENSER', params: { VERSION: '1', DISPENSER_ACTION_INDEX: '18' } },
        })).rejects.toThrow('This dispenser has expired.');
    });

    it('allows a referenced offer that expires after the current chain block time', async () => {
        const sdk = {
            ...fakeSdk({ status: currentStatus }),
            getAction: vi.fn(async () => ({ state: { status: 'open', expiration: 4_001 } })),
        };
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor(sdk),
            chainId: 'litecoin-testnet',
            actionData: { action: 'SWAP', params: { VERSION: '1', SWAP_ACTION_INDEX: '17' } },
        })).resolves.toBeUndefined();
    });

    it('refuses to decide from a stale indexed height', async () => {
        const sdk = {
            ...fakeSdk({ status: {
                last_block: { TLTC: 799 },
                chain_tip: { TLTC: 800 },
                last_block_time: { TLTC: 4_000 },
            } }),
            getAction: vi.fn(async () => ({ state: { status: 'open', expiration: 4_001 } })),
        };
        const clock = await readMarketExpiryClock(sdk);
        expect(clock).toMatchObject({ blockTime: null, indexedHeight: 799, chainHeight: 800, stale: true });
        await expect(assertReferencedOfferActionable({
            sdkRegistry: registryFor(sdk),
            chainId: 'litecoin-testnet',
            actionData: { action: 'ORDER', params: { VERSION: '1', ORDER_ACTION_INDEX: '9' } },
        })).rejects.toThrow('chain height is still syncing');
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
