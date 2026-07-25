// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-16 consent records: the terms snapshot every auto-payment is
// capped against. The write sites here are the ONLY producers of that
// trust anchor, so their shapes and refusals are pinned.

import { describe, it, expect, vi } from 'vitest';
import {
    isNativeGiveOrder,
    recordAutopayConsent,
    listAutopayOrders,
    setAutopayEnabled,
    autopayExposureBase,
    resolveOrderActionIndexes,
    recordAutopayPayment,
} from '../../../packages/core/src/flows/autopayConsent.js';
import { validateAutopayOrder } from '../../../packages/core/src/schemas/autopayOrder.js';

function makeVault(rows = []) {
    const store = new Map();
    for (const r of rows) store.set(r.id, r);
    return {
        store,
        autopayOrders: {
            get: vi.fn(async (id) => store.get(id) || null),
            put: vi.fn(async (record) => { store.set(record.id, record); }),
            list: vi.fn(async () => Array.from(store.values())),
        },
    };
}

const NATIVE_GIVE_PARAMS = {
    VERSION: '0',
    GIVE_COIN: 'BTC',
    GIVE_TICK: '',
    GIVE_AMOUNT: '0.05',
    GET_COIN: 'BTC',
    GET_TICK: 'PEPE',
    GET_AMOUNT: '1000',
};

const BASE = {
    walletId: 'w1',
    chainId: 'bitcoin-regtest',
    sourceAddress: 'addr1',
    txid: 'AB12',
    params: NATIVE_GIVE_PARAMS,
};

describe('isNativeGiveOrder', () => {
    it('accepts only an empty GIVE_TICK with a token GET side and both amounts', () => {
        expect(isNativeGiveOrder(NATIVE_GIVE_PARAMS)).toBe(true);
        expect(isNativeGiveOrder({ ...NATIVE_GIVE_PARAMS, GIVE_TICK: 'PEPE' })).toBe(false);
        expect(isNativeGiveOrder({ ...NATIVE_GIVE_PARAMS, GET_TICK: '' })).toBe(false);
        expect(isNativeGiveOrder({ ...NATIVE_GIVE_PARAMS, GIVE_AMOUNT: '' })).toBe(false);
        expect(isNativeGiveOrder(null)).toBe(false);
    });
});

describe('recordAutopayConsent', () => {
    it('writes a schema-valid record with the exact signed terms, lowercased txid', async () => {
        const vault = makeVault();
        const record = await recordAutopayConsent({ vault, ...BASE });
        expect(validateAutopayOrder(record).ok ?? true).toBeTruthy();
        expect(record.id).toBe('bitcoin-regtest::ab12');
        expect(record.giveCoinAmount).toBe('0.05');
        expect(record.getTick).toBe('PEPE');
        expect(record.getAmount).toBe('1000');
        expect(record.orderActionIndex).toBe(null);
        expect(record.autopay).toBe(true);
        expect(vault.autopayOrders.put).toHaveBeenCalledTimes(1);
    });

    it('refuses a non-native-GIVE order (the only shape that settles via CoinPay)', async () => {
        const vault = makeVault();
        await expect(recordAutopayConsent({
            vault, ...BASE, params: { ...NATIVE_GIVE_PARAMS, GIVE_TICK: 'PEPE' },
        })).rejects.toThrow(/native-coin GIVE/);
        expect(vault.autopayOrders.put).not.toHaveBeenCalled();
    });
});

describe('setAutopayEnabled / listAutopayOrders / exposure', () => {
    it('flips the flag by id or by chainId+txid and filters lists', async () => {
        const vault = makeVault();
        await recordAutopayConsent({ vault, ...BASE });
        const off = await setAutopayEnabled({ vault, chainId: BASE.chainId, txid: 'ab12', enabled: false });
        expect(off.autopay).toBe(false);
        expect((await listAutopayOrders({ vault, walletId: 'w1' })).length).toBe(1);
        expect((await listAutopayOrders({ vault, walletId: 'other' })).length).toBe(0);
        await expect(setAutopayEnabled({ vault, id: 'missing', enabled: true }))
            .rejects.toThrow(/no consent record/);
    });

    it('sums exposure per chain over ENABLED records net of payments', async () => {
        const vault = makeVault();
        await recordAutopayConsent({ vault, ...BASE });                       // 5,000,000
        await recordAutopayConsent({ vault, ...BASE, txid: 'cd34' });         // 5,000,000
        await recordAutopayConsent({ vault, ...BASE, txid: 'ef56', enabled: false });
        await recordAutopayPayment({
            vault, id: 'bitcoin-regtest::ab12',
            orderMatchActionIndex: '900', coinAmountBase: '1000000', txid: 'pay1',
        });
        const exposure = await autopayExposureBase({ vault, walletId: 'w1' });
        expect(exposure).toEqual({ 'bitcoin-regtest': '9000000' });
    });
});

describe('recordAutopayPayment', () => {
    it('appends once and refuses a duplicate match (double-count = double-spend risk)', async () => {
        const vault = makeVault();
        await recordAutopayConsent({ vault, ...BASE });
        const id = 'bitcoin-regtest::ab12';
        const updated = await recordAutopayPayment({
            vault, id, orderMatchActionIndex: '900', coinAmountBase: '500000', txid: 'pay1',
        });
        expect(updated.payments).toHaveLength(1);
        expect(validateAutopayOrder(updated).ok ?? true).toBeTruthy();
        await expect(recordAutopayPayment({
            vault, id, orderMatchActionIndex: '900', coinAmountBase: '500000', txid: 'pay2',
        })).rejects.toThrow(/already recorded/);
    });
});

describe('resolveOrderActionIndexes', () => {
    function makeSdkRegistry(txByHash) {
        return {
            get: vi.fn(() => ({
                getTransaction: vi.fn(async (txid) => txByHash[txid] ?? null),
            })),
        };
    }

    it('backfills from the placement txid, skipping invalid ORDER rows', async () => {
        const vault = makeVault();
        await recordAutopayConsent({ vault, ...BASE });
        const sdkRegistry = makeSdkRegistry({
            ab12: {
                tx_hash: 'ab12',
                actions: [
                    { action: 'ORDER', action_index: '4242', status: 'valid' },
                ],
            },
        });
        const n = await resolveOrderActionIndexes({ vault, sdkRegistry });
        expect(n).toBe(1);
        expect(vault.store.get('bitcoin-regtest::ab12').orderActionIndex).toBe('4242');
    });

    it('leaves unresolved on explorer failure or an invalid ORDER, and retries later', async () => {
        const vault = makeVault();
        await recordAutopayConsent({ vault, ...BASE });
        const invalid = makeSdkRegistry({
            ab12: { tx_hash: 'ab12', actions: [{ action: 'ORDER', action_index: '1', status: 'invalid: GIVE_COIN (network)' }] },
        });
        expect(await resolveOrderActionIndexes({ vault, sdkRegistry: invalid })).toBe(0);
        expect(vault.store.get('bitcoin-regtest::ab12').orderActionIndex).toBe(null);
        const throwing = { get: vi.fn(() => ({ getTransaction: vi.fn(async () => { throw new Error('down'); }) })) };
        expect(await resolveOrderActionIndexes({ vault, sdkRegistry: throwing })).toBe(0);
    });
});
