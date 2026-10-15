// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    createAutopayOrder,
    validateAutopayOrder,
} from '../../../packages/core/src/schemas/autopayOrder.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'bitcoin-mainnet',
    sourceAddress: 'source-address',
    txid: 'ABC',
    giveCoinAmount: '0.5',
    getTick: 'xcp',
    getAmount: '10',
};

describe('autopay order validation edge branches', () => {
    it('rejects non-object records', () => {
        expect(validateAutopayOrder(null).ok).toBe(false);
    });

    it('accepts a populated order action index', () => {
        const order = createAutopayOrder(BASE_INPUT);
        expect(validateAutopayOrder({
            ...order,
            orderActionIndex: '100:2',
        }).ok).toBe(true);
    });

    it('rejects a non-array payment ledger', () => {
        const order = createAutopayOrder(BASE_INPUT);
        const validation = validateAutopayOrder({ ...order, payments: null });
        expect(validation.ok).toBe(false);
        expect(validation.errors).toContain('payments: must be an array');
    });
});
