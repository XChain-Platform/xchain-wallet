// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : the Approve-time native-coin fee re-check.
//
// The measured case (wallet E2E session 22, LTC regtest): an ISSUE composed at
// LTC/USD 100 attached a 0.02 LTC fee output; the price halved before Approve,
// doubling the requirement to 0.04; the wallet broadcast the stale PSBT and the
// action indexed `invalid: insufficient native coin fee (paid: 0.02000000,
// expected: 0.04000000, min: 0.03800000)` with the 0.02 forfeited. These are
// that arithmetic, plus the band edges either side of it.

import { describe, it, expect } from 'vitest';
import {
    compareNativeFeeQuote,
    isNativeFeeRefusal,
    nativeFeeChangedError,
    nativeFeeRequoteMessage,
    satsFromNativeDecimal,
    NATIVE_FEE_CHANGED,
} from '../../../packages/core/src/flows/nativeFeeRequote.js';

// A quote shaped like the indexer's: 8-dp band strings plus the satoshi amount.
function quote({ requiredFeeSats, minAcceptable, maxAcceptable, ...rest }) {
    return {
        supported: true, valid: true, coin: 'LTC', feeDestination: 'feeDest',
        toleranceMin: '0.95000000', toleranceMax: '1.10000000',
        requiredFeeSats, minAcceptable, maxAcceptable, ...rest,
    };
}

// The composed side carries only what the compose-time quote left on the
// envelope; `requiredFeeSats` is the output that was actually attached.
const composedTwoHundredth = { requiredFeeSats: 2000000 };   // 0.02 LTC

describe('compareNativeFeeQuote', () => {

    it('D-101: the measured LTC case refuses - 0.02 attached, 0.04 now required', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 4000000, minAcceptable: '0.03800000', maxAcceptable: '0.04400000' }),
        });
        expect(cmp.verdict).toBe('short');
        expect(isNativeFeeRefusal(cmp)).toBe(true);
        expect(cmp.paidSats).toBe(2000000);
        expect(cmp.expectedSats).toBe(4000000);
        expect(cmp.minSats).toBe(3800000);
    });

    it('an unchanged quote passes', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 2000000, minAcceptable: '0.01900000', maxAcceptable: '0.02200000' }),
        });
        expect(cmp.verdict).toBe('ok');
        expect(isNativeFeeRefusal(cmp)).toBe(false);
    });

    it('a move INSIDE the band passes: the exposure starts just past 5 %', () => {
        // Exactly at minAcceptable, the lowest amount consensus accepts.
        const atMin = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 2105263, minAcceptable: '0.02000000', maxAcceptable: '0.02315789' }),
        });
        expect(atMin.verdict).toBe('ok');
        // One satoshi under it is the whole fee forfeited on chain.
        const oneUnder = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 2105264, minAcceptable: '0.02000001', maxAcceptable: '0.02315790' }),
        });
        expect(oneUnder.verdict).toBe('short');
    });

    it('a favourable move past the top of the band refuses too, as a material overpay', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 1000000, minAcceptable: '0.00950000', maxAcceptable: '0.01100000' }),
        });
        expect(cmp.verdict).toBe('excess');
        expect(isNativeFeeRefusal(cmp)).toBe(true);
    });

    it('an action that no longer carries a protocol fee at all is an overpay, not an ok', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 0, minAcceptable: '0.00000000', maxAcceptable: '0.00000000' }),
        });
        expect(cmp.verdict).toBe('excess');
    });

    it('falls back to the tolerances when a quote omits its band', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 4000000, minAcceptable: undefined, maxAcceptable: undefined }),
        });
        expect(cmp.minSats).toBe(3800000);   // 0.95 x 0.04
        expect(cmp.maxSats).toBe(4400000);   // 1.10 x 0.04
        expect(cmp.verdict).toBe('short');
    });

    it('and to the consensus defaults when it omits the tolerances too', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: { supported: true, valid: true, requiredFeeSats: 4000000 },
        });
        expect(cmp.minSats).toBe(3800000);
        expect(cmp.verdict).toBe('short');
    });

    it('nothing attached means nothing to check', () => {
        expect(compareNativeFeeQuote({ composed: null, fresh: quote({ requiredFeeSats: 4000000 }) }).verdict)
            .toBe('none');
        expect(compareNativeFeeQuote({ composed: { requiredFeeSats: 0 }, fresh: null }).verdict)
            .toBe('none');
    });

    it('a static (verdict-free) quote is still judged: DEPLOY/EXECUTE price without a dry-run', () => {
        const cmp = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({
                requiredFeeSats: 4000000, minAcceptable: '0.03800000', maxAcceptable: '0.04400000',
                valid: null, staticQuote: true, validated: false,
            }),
        });
        expect(cmp.verdict).toBe('short');
    });

    describe('a quote that could not judge never blocks a probably-good transaction', () => {
        const cases = [
            ['offline / no answer', null],
            ['unsupported action', quote({ requiredFeeSats: 4000000, supported: false, error: 'not quotable' })],
            ['busy admission cap', quote({ requiredFeeSats: 0, valid: false, busy: true, retryable: true, error: 'fee quote busy' })],
            ['stale oracle price', quote({ requiredFeeSats: 0, valid: false, error: 'no usable price' })],
            ['answer with no amount', quote({ requiredFeeSats: undefined })],
        ];
        for (const [label, fresh] of cases) {
            it(label, () => {
                const cmp = compareNativeFeeQuote({ composed: composedTwoHundredth, fresh });
                expect(cmp.verdict).toBe('unavailable');
                expect(isNativeFeeRefusal(cmp)).toBe(false);
            });
        }
    });
});

describe('satsFromNativeDecimal', () => {
    it('converts 8-dp strings exactly, without a float round-trip', () => {
        expect(satsFromNativeDecimal('0.03800000')).toBe(3800000);
        expect(satsFromNativeDecimal('1.00000000')).toBe(100000000);
        expect(satsFromNativeDecimal('0.00000001')).toBe(1);
        expect(satsFromNativeDecimal('12')).toBe(1200000000);
        // 0.07 x 1e8 is 7000000.000000001 in IEEE754; the band comparison
        // cannot inherit that.
        expect(satsFromNativeDecimal('0.07000000')).toBe(7000000);
    });

    it('answers null for anything that is not a plain decimal', () => {
        for (const bad of [null, undefined, '', 'abc', '-1', '1e8', {}]) {
            expect(satsFromNativeDecimal(bad)).toBe(null);
        }
    });
});

describe('nativeFeeRequoteMessage', () => {
    const short = compareNativeFeeQuote({
        composed: composedTwoHundredth,
        fresh: quote({ requiredFeeSats: 4000000, minAcceptable: '0.03800000', maxAcceptable: '0.04400000' }),
    });

    it('names both amounts, the forfeiture, and what to do next', () => {
        const msg = nativeFeeRequoteMessage(short);
        expect(msg).toContain('0.04 LTC');
        expect(msg).toContain('0.02 LTC');
        expect(msg).toMatch(/nothing was signed or sent/i);
        expect(msg).toMatch(/start the action again/i);
        expect(msg).toMatch(/reject/i);
    });

    it('does not claim a rejection when the fee merely fell', () => {
        const excess = compareNativeFeeQuote({
            composed: composedTwoHundredth,
            fresh: quote({ requiredFeeSats: 1000000, minAcceptable: '0.00950000', maxAcceptable: '0.01100000' }),
        });
        const msg = nativeFeeRequoteMessage(excess);
        expect(msg).toContain('0.01 LTC');
        expect(msg).not.toMatch(/would reject/i);
        expect(msg).toMatch(/nothing was signed or sent/i);
    });

    it('carries the ticker from the quote, and an explicit one wins', () => {
        expect(nativeFeeRequoteMessage(short)).toContain('LTC');
        expect(nativeFeeRequoteMessage(short, { coinTicker: 'DOGE' })).toContain('DOGE');
        expect(nativeFeeRequoteMessage(short, { coinTicker: 'DOGE' })).not.toContain('LTC');
    });

    it('the error form carries the code and the comparison', () => {
        const err = nativeFeeChangedError(short);
        expect(err.code).toBe(NATIVE_FEE_CHANGED);
        expect(err.message).toBe(nativeFeeRequoteMessage(short));
        expect(err.requote.verdict).toBe('short');
    });
});
