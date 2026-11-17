// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A protocol fee known in XCHAIN but paid in the chain's coin with no oracle
// price to convert at (Litecoin or Dogecoin, where paying in coin is locked
// on): the fee is still known, so Speed and Fees shows it in XCHAIN and only
// the coin amount under the switch waits for review.

import { describe, expect, it } from 'vitest';
import {
    feeSummaryParts,
    protocolFeeState,
} from '../../../packages/core/src/shared/components/formStandard/FeeSection.jsx';

const quote = { xchainFee: '1.00000000', scheduleEstimate: true };

describe('Speed and Fees with an unpriced coin payment', () => {
    it('keeps the fee known in XCHAIN when the coin amount cannot be converted', () => {
        const state = protocolFeeState({
            quote,
            pending: false,
            nativeFeeProps: { checked: true, mandatory: true, coinTicker: 'LTC' },
        }, 'LTC');
        expect(state.unavailable).toBe(false);
        expect(state.nativeUnpriced).toBe(true);
        expect(state.xchain).toBe('1');
        expect(state.nativeAmount).toBeNull();
    });

    it('stays unavailable when neither the XCHAIN nor the coin amount is known', () => {
        const state = protocolFeeState({
            quote: null,
            pending: false,
            nativeFeeProps: { checked: true, mandatory: true, coinTicker: 'LTC' },
        }, 'LTC');
        expect(state.unavailable).toBe(true);
        expect(state.nativeUnpriced).toBe(false);
    });

    it('is priced in coin when the quote carries the converted amount', () => {
        const state = protocolFeeState({
            quote: { ...quote, requiredFeeSats: 263 },
            pending: false,
            nativeFeeProps: { checked: true, mandatory: true, coinTicker: 'LTC' },
        }, 'LTC');
        expect(state.nativeUnpriced).toBe(false);
        expect(state.nativeAmount).toBe('0.00000263');
    });

    it('counts the XCHAIN figure in the closed summary instead of leaving the fee out', () => {
        const protocol = protocolFeeState({
            quote,
            pending: false,
            nativeFeeProps: { checked: true, mandatory: true, coinTicker: 'LTC' },
        }, 'LTC');
        const summary = feeSummaryParts({
            tiers: { normal: { coinAmount: '0.0000042' } },
            value: { mode: 'normal' },
            coinTicker: 'LTC',
            protocol,
            fiat: null,
        });
        expect(summary.text).toBe('Normal · 0.0000042 LTC + 1 XCHAIN');
    });
});
