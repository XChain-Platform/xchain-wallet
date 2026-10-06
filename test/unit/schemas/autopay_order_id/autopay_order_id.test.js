// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    autopayOrderId,
    createAutopayOrder,
} from '../../../../packages/core/src/schemas/autopayOrder.js';

const BASE_INPUT = {
    walletId: 'wallet-1',
    chainId: 'BTC-XCP',
    sourceAddress: 'source-address',
    txid: 'ABC',
    giveCoinAmount: '0.5',
    getTick: 'xcp',
    getAmount: '10',
};

describe('autopayOrderId', () => {
    it('lowercases the txid and preserves the chain id case', () => {
        expect(autopayOrderId({ chainId: 'BTC-XCP', txid: 'ABCdef' }))
            .toBe('BTC-XCP::abcdef');
    });

    it('stringifies a numeric txid', () => {
        expect(autopayOrderId({ chainId: 'x', txid: 12 })).toBe('x::12');
    });

    it('is case-insensitive for txids and chain-specific', () => {
        const upper = autopayOrderId({ chainId: 'BTC-XCP', txid: 'ABC' });
        const lower = autopayOrderId({ chainId: 'BTC-XCP', txid: 'abc' });
        const otherChain = autopayOrderId({ chainId: 'btc-xcp', txid: 'ABC' });

        expect(upper).toBe(lower);
        expect(upper).not.toBe(otherChain);
    });
});

describe('createAutopayOrder', () => {
    it('creates a normalized record with autopay enabled by default', () => {
        const order = createAutopayOrder(BASE_INPUT);

        expect(order.id).toBe(autopayOrderId(BASE_INPUT));
        expect(order.txid).toBe('abc');
        expect(order.getTick).toBe('XCP');
        expect(order.autopay).toBe(true);
        expect(order.payments).toEqual([]);
        expect(order.orderActionIndex).toBeNull();
    });

    it('disables autopay only when explicitly false', () => {
        expect(createAutopayOrder({ ...BASE_INPUT, autopay: false }).autopay).toBe(false);
        expect(createAutopayOrder({ ...BASE_INPUT, autopay: true }).autopay).toBe(true);
        expect(createAutopayOrder({ ...BASE_INPUT, autopay: 0 }).autopay).toBe(true);
    });
});
