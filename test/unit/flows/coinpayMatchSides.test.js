// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// What each payment due buys, read in bulk: two explorer list reads per payer
// address (its matches and its orders), whatever the number of payments. The
// match row's amounts belong to the order named by get_action_index, so the
// payer's coin and token fills swap when its order is the other one; a row
// whose coin side does not equal the amount owed answers null, never a guess.

import { describe, expect, it, vi } from 'vitest';
import { getCoinpayMatchSides, matchSideKey } from '../../../packages/core/src/flows/coinpayMatchSides.js';

const PAYER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const CHAIN = 'bitcoin-mainnet';

// N matches: even ones triggered by the payer's order, odd ones by the seller's.
function fixture(count) {
    const matches = [];
    const orders = [];
    const obligations = [];
    for (let i = 0; i < count; i += 1) {
        const mine = String(5000 + i);
        const theirs = String(6000 + i);
        const coin = `0.00${10 + i}`;
        const tokens = String(100 * (i + 1));
        const triggeredByMe = i % 2 === 0;
        matches.push({
            action_index: String(7000 + i),
            give_action_index: triggeredByMe ? theirs : mine,
            get_action_index: triggeredByMe ? mine : theirs,
            // Amounts are the triggering order's give and get.
            give_amount: triggeredByMe ? coin : tokens,
            get_amount: triggeredByMe ? tokens : coin,
            timestamp: 1_800_000_000 + i,
            status: 'pending_coinpay',
        });
        orders.push({ action_index: mine, source: PAYER, give_tick: '', get_tick: 'XCHAIN' });
        obligations.push({
            chainId: CHAIN,
            address: PAYER,
            orderMatchActionIndex: String(7000 + i),
            coinAmount: coin,
            coinTicker: 'BTC',
        });
    }
    const sdk = {
        getOrderMatches: vi.fn(async () => ({ data: matches })),
        getOrders: vi.fn(async () => ({ data: orders })),
        getAction: vi.fn(),
    };
    return { sdk, obligations, sdkRegistry: { get: () => sdk } };
}

describe('getCoinpayMatchSides', () => {
    it('answers every payment from two list reads per payer address, at any row count', async () => {
        for (const count of [2, 12]) {
            const { sdk, obligations, sdkRegistry } = fixture(count);
            const sides = await getCoinpayMatchSides({ sdkRegistry, obligations });
            expect(sdk.getOrderMatches).toHaveBeenCalledTimes(1);
            expect(sdk.getOrders).toHaveBeenCalledTimes(1);
            expect(sdk.getAction).not.toHaveBeenCalled();
            expect(sdk.getOrderMatches).toHaveBeenCalledWith(PAYER, 'address');
            expect(Object.keys(sides)).toHaveLength(count);
            for (let i = 0; i < count; i += 1) {
                expect(sides[matchSideKey(CHAIN, String(7000 + i))]).toEqual({
                    tick: 'XCHAIN',
                    amount: String(100 * (i + 1)),
                    matchedAt: 1_800_000_000 + i,
                });
            }
        }
    });

    it('answers null when the coin side is not the amount owed', async () => {
        const { obligations, sdkRegistry } = fixture(1);
        obligations[0].coinAmount = '0.5';
        const sides = await getCoinpayMatchSides({ sdkRegistry, obligations });
        expect(sides[matchSideKey(CHAIN, '7000')]).toBeNull();
    });

    it('answers null when the match is not on the read page', async () => {
        const { obligations, sdkRegistry } = fixture(1);
        obligations[0].orderMatchActionIndex = '9999';
        const sides = await getCoinpayMatchSides({ sdkRegistry, obligations });
        expect(sides[matchSideKey(CHAIN, '9999')]).toBeNull();
    });

    it('answers null for one failed address and keeps the others', async () => {
        const good = fixture(1);
        const other = 'bc1qother';
        const failing = { getOrderMatches: vi.fn().mockRejectedValue(new Error('down')), getOrders: vi.fn() };
        const sdkRegistry = { get: () => ({
            getOrderMatches: (address, type) => (address === other ? failing.getOrderMatches(address, type) : good.sdk.getOrderMatches()),
            getOrders: (address) => (address === other ? failing.getOrders() : good.sdk.getOrders()),
        }) };
        const sides = await getCoinpayMatchSides({
            sdkRegistry,
            obligations: [...good.obligations, { ...good.obligations[0], address: other, orderMatchActionIndex: '7100' }],
        });
        expect(sides[matchSideKey(CHAIN, '7000')]?.tick).toBe('XCHAIN');
        expect(sides[matchSideKey(CHAIN, '7100')]).toBeNull();
    });
});
