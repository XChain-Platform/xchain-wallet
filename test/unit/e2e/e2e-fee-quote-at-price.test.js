// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: test/e2e/fixtures/feeQuoteAtPrice.js - the compose-time quote the
// native-fee re-quote spec serves while the venue's own oracle prices the coin.

import { describe, it, expect } from 'vitest';
import { feeQuoteAtCoinPriceFactor } from '../../e2e/fixtures/feeQuoteAtPrice.js';
import { compareNativeFeeQuote } from '../../../packages/core/src/flows/nativeFeeRequote.js';

// A regtest RBTC ISSUE quote, as /feequote answered it.
const VENUE_QUOTE = Object.freeze({
    supported: true, action: 'ISSUE', coin: 'BTC', feeDestination: 'mfeesX6rLE6V3WPg9tsbL2fHNS7E4rDAim',
    toleranceMin: '0.95000000', toleranceMax: '1.10000000', blockIndex: 3116, blockTime: 1793152220,
    status: 'valid', validated: true, xchainFee: '1.00000000', valid: true, error: null, oracleRound: 135870,
    xchainUsdPrice: '1.80000000', coinUsdPrice: '80793.54000000', expectedNative: '0.00002228',
    minAcceptable: '0.00002117', maxAcceptable: '0.00002451', requiredFeeNative: '0.00002228',
    requiredFeeSats: 2228, requiredFeeSatsExact: '2228',
});

describe('feeQuoteAtCoinPriceFactor', () => {
    it('halves every coin amount at twice the coin price and keeps the identity fields', () => {
        const q = feeQuoteAtCoinPriceFactor(VENUE_QUOTE, 2);
        expect(q).toMatchObject({
            requiredFeeSats: 1114,
            requiredFeeSatsExact: '1114',
            requiredFeeNative: '0.00001114',
            expectedNative: '0.00001114',
            minAcceptable: '0.00001059',
            maxAcceptable: '0.00001225',
            coinUsdPrice: '161587.08000000',
        });
        for (const field of ['coin', 'feeDestination', 'oracleRound', 'blockIndex', 'blockTime', 'status',
            'valid', 'xchainFee', 'xchainUsdPrice', 'action', 'supported']) {
            expect(q[field], field).toEqual(VENUE_QUOTE[field]);
        }
    });

    it('never widens the band and keeps the fee inside it', () => {
        for (const factor of [1.5, 2, 3, 7]) {
            const q = feeQuoteAtCoinPriceFactor(VENUE_QUOTE, factor);
            const sats = (d) => Math.round(Number(d) * 1e8);
            expect(sats(q.minAcceptable)).toBeGreaterThanOrEqual(2117 / factor);
            expect(sats(q.maxAcceptable)).toBeLessThanOrEqual(2451 / factor);
            expect(q.requiredFeeSats).toBeGreaterThanOrEqual(sats(q.minAcceptable));
            expect(q.requiredFeeSats).toBeLessThanOrEqual(sats(q.maxAcceptable));
        }
    });

    it('composes a fee the venue\'s own quote then refuses as short', () => {
        const composed = feeQuoteAtCoinPriceFactor(VENUE_QUOTE, 2);
        const cmp = compareNativeFeeQuote({ composed, fresh: VENUE_QUOTE });
        expect(cmp.verdict).toBe('short');
        expect(compareNativeFeeQuote({ composed, fresh: composed }).verdict).toBe('ok');
    });

    it('passes through a quote that prices nothing', () => {
        expect(feeQuoteAtCoinPriceFactor(null, 2)).toBeNull();
        expect(feeQuoteAtCoinPriceFactor({ ...VENUE_QUOTE, valid: false }, 2)).toBeNull();
        expect(feeQuoteAtCoinPriceFactor({ ...VENUE_QUOTE, requiredFeeSats: 0 }, 2)).toBeNull();
        expect(() => feeQuoteAtCoinPriceFactor(VENUE_QUOTE, 0)).toThrow(/positive/);
    });
});
