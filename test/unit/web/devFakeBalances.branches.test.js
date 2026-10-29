// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    fakeBalanceFor,
    fakeDispenserByActionIndex,
    fakeDispensersFor,
    fakeGenesisFor,
    fakeHistoryFor,
    fakeHoldersFor,
    fakeNativeFiatRates,
    fakeOrdersFor,
    fakeOwnedTokensFor,
    fakeSubassetsFor,
    fakeSwapsFor,
    fakeTokenInfoFor,
} from '../../../packages/web/src/devFakeBalances.js';

describe('dev fake balance branches', () => {
    it('selects native and token fixtures for every chain family', () => {
        expect(fakeNativeFiatRates()).toEqual({ bitcoin: 65000, litecoin: 80, dogecoin: 0.1 });

        const bitcoin = fakeBalanceFor('bc1', 'bitcoin-mainnet');
        const litecoin = fakeBalanceFor('ltc1', 'litecoin-mainnet');
        const dogecoin = fakeBalanceFor('D1', 'dogecoin-mainnet');
        const fallback = fakeBalanceFor('fallback', null);

        expect([bitcoin.native.tick, litecoin.native.tick, dogecoin.native.tick, fallback.native.tick])
            .toEqual(['BTC', 'LTC', 'DOGE', 'BTC']);
        expect(bitcoin.tokens).toContainEqual(expect.objectContaining({ tick: 'PEPECASH', kind: 'token' }));
        expect(litecoin.tokens).toContainEqual(expect.objectContaining({ tick: 'LITEGEM' }));
        expect(dogecoin.tokens).toContainEqual(expect.objectContaining({ tick: 'SHIBE' }));
    });

    it('builds owned-token rows across their lock, ownership, and dispenser states', () => {
        for (const chainId of ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet']) {
            const rows = fakeOwnedTokensFor(chainId);
            expect(rows.some((row) => row.locked)).toBe(true);
            expect(rows.some((row) => !row.locked)).toBe(true);
            expect(rows.some((row) => row.youOwn)).toBe(true);
            expect(rows.some((row) => !row.youOwn)).toBe(true);
            expect(rows.some((row) => row.hasOpenDispenser)).toBe(true);
            expect(rows.some((row) => !row.hasOpenDispenser)).toBe(true);
        }
    });

    it('builds deterministic market and history rows for native and token pairs', () => {
        const dispensers = fakeDispensersFor('SHIBE', 'dogecoin-mainnet');
        const orders = fakeOrdersFor('LITEGEM', 'litecoin-mainnet');
        const swaps = fakeSwapsFor('PEPECASH', 'bitcoin-mainnet');
        const holders = fakeHoldersFor('SHIBE', 'dogecoin-mainnet');
        const history = fakeHistoryFor('LITEGEM', 'litecoin-mainnet');

        expect(dispensers).toHaveLength(3);
        expect(dispensers.every((row) => row.get_coin === 'DOGE' && row.get_tick === null)).toBe(true);
        expect(orders.some((row) => row.give_tick === 'WAGMI' || row.get_tick === 'WAGMI')).toBe(true);
        expect(swaps.some((row) => row.give_tick === 'XCP' || row.get_tick === 'XCP')).toBe(true);
        expect(holders).toEqual(expect.objectContaining({
            tick: 'SHIBE',
            supply: '100000',
            decimals: 8,
            total: 12,
        }));
        expect(holders.data).toHaveLength(12);
        expect(holders.data.every((row) => /^\d+$/.test(row.amount))).toBe(true);
        expect(new Set(holders.data.map((row) => row.address)).size).toBe(12);
        expect(history).toHaveLength(15);
        expect(history.every((row) => row.action_index === row.tx_hash)).toBe(true);
    });

    it('serves whole-number dispenser action indexes the detail page can look up', () => {
        const rows = fakeDispensersFor('XCHAIN', 'litecoin-mainnet');
        for (const row of rows) {
            expect(row.action_index).toMatch(/^\d+$/);
            expect(fakeDispenserByActionIndex(row.action_index, 'litecoin-mainnet')).toBe(row);
        }
        expect(fakeDispenserByActionIndex(rows[0].action_index, 'bitcoin-mainnet')).toBeNull();
        expect(fakeDispenserByActionIndex('1', 'litecoin-mainnet')).toBeNull();
    });

    it('returns populated and missing token detail fixtures', () => {
        const locked = fakeTokenInfoFor('pepecash', 'bitcoin-mainnet');
        const unlocked = fakeTokenInfoFor('XCP', 'bitcoin-mainnet');

        expect(locked).toEqual(expect.objectContaining({
            tick: 'PEPECASH',
            supply: expect.objectContaining({ max: locked.supply.current }),
            locks: expect.objectContaining({ mint: true }),
        }));
        expect(unlocked.supply.max).toBeNull();
        expect(unlocked.locks).toEqual({});
        expect(fakeTokenInfoFor('MISSING', 'bitcoin-mainnet')).toBeNull();
        expect(fakeGenesisFor('MISSING', 'bitcoin-mainnet')).toEqual([]);
        expect(fakeSubassetsFor('MISSING', 'bitcoin-mainnet')).toEqual([]);
    });

    it('builds genesis and variable-count subasset rows', () => {
        const genesis = fakeGenesisFor('PEPECASH', 'bitcoin-mainnet');
        const candidates = ['PEPECASH', 'RAREPEPE', 'XCP', 'DANKEST', 'XCHAINGOV'];
        const subassetSets = candidates.map((tick) => fakeSubassetsFor(tick, 'bitcoin-mainnet'));

        expect(genesis).toHaveLength(1);
        expect(genesis[0][4]).toBe('PEPECASH');
        expect(subassetSets.some((rows) => rows.length === 0)).toBe(true);
        expect(subassetSets.some((rows) => rows.length > 0)).toBe(true);
        for (const rows of subassetSets) {
            rows.forEach((row, index) => {
                expect(row[0]).toBe(index + 1);
                expect(row[3]).toMatch(/\.[ABC]$/);
            });
        }
    });
});
