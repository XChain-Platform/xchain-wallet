// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// . `useFiatRate` prices a COIN FAMILY (BTC / LTC / DOGE) and knows
// nothing about tokens, so handing its rate to a field holding a TOKEN amount
// prices that amount as if it were the coin. The operator-visible symptom was
// a 50,000 XCHAIN send previewing as billions of dollars, rendered with the
// same confident "≈ $X.XX" styling a correct figure gets.
//
// `fiatRateForTick` is the gate. Its contract is deliberately conservative:
// return the rate ONLY when the thing being priced is provably the native
// coin, and null otherwise, because null is AmountField's documented "hide the
// fiat toggle and the preview" input. Showing nothing is the only honest
// option until per-tick rates exist.

import { describe, it, expect } from 'vitest';
import { fiatRateForTick } from '../../../packages/core/src/shared/hooks/useFiatRate.js';

const RATE = { rate: 67000, fiatCurrency: 'USD' };

describe('fiatRateForTick', () => {
    it('prices a blank tick, which every form treats as the native coin', () => {
        expect(fiatRateForTick({ rate: RATE, tick: '', nativeTicker: 'BTC' })).toBe(RATE);
        expect(fiatRateForTick({ rate: RATE, tick: null, nativeTicker: 'BTC' })).toBe(RATE);
        expect(fiatRateForTick({ rate: RATE, tick: '   ', nativeTicker: 'BTC' })).toBe(RATE);
    });

    it('prices the native ticker spelled out, case- and space-insensitively', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'BTC', nativeTicker: 'BTC' })).toBe(RATE);
        expect(fiatRateForTick({ rate: RATE, tick: 'btc', nativeTicker: 'BTC' })).toBe(RATE);
        expect(fiatRateForTick({ rate: RATE, tick: ' BTC ', nativeTicker: 'btc' })).toBe(RATE);
    });

    // The defect itself.
    it('refuses to price a token at the coin rate', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'XCHAIN', nativeTicker: 'BTC' })).toBeNull();
        expect(fiatRateForTick({ rate: RATE, tick: 'PEPECASH', nativeTicker: 'BTC' })).toBeNull();
    });

    // A token whose ticker merely resembles the coin must not slip through: the
    // comparison is equality, not prefix or substring.
    it('refuses a token whose ticker contains the native one', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'BTCX', nativeTicker: 'BTC' })).toBeNull();
        expect(fiatRateForTick({ rate: RATE, tick: 'WBTC', nativeTicker: 'BTC' })).toBeNull();
    });

    // Cross-chain confusion: an LTC-family rate must not price a tick named BTC.
    it('refuses when the tick names a different chain coin', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'BTC', nativeTicker: 'LTC' })).toBeNull();
    });

    // Fail closed while the descriptor is still loading. A blank tick would
    // otherwise be priced against a native ticker we have not resolved.
    it('refuses when the native ticker is unknown and a tick was given', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'BTC', nativeTicker: null })).toBeNull();
        expect(fiatRateForTick({ rate: RATE, tick: 'BTC', nativeTicker: '' })).toBeNull();
    });

    it('returns null when there is no rate to gate', () => {
        expect(fiatRateForTick({ rate: null, tick: '', nativeTicker: 'BTC' })).toBeNull();
        expect(fiatRateForTick({ rate: undefined, tick: 'BTC', nativeTicker: 'BTC' })).toBeNull();
    });

    it('returns the identical object, not a copy, so callers can compare by reference', () => {
        expect(fiatRateForTick({ rate: RATE, tick: 'BTC', nativeTicker: 'BTC' })).toBe(RATE);
    });
});
