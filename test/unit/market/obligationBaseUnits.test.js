// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A CoinPay obligation's coin_amount is the match's DECIMAL coin figure in
// every shape the indexer serves: "0.5" for half a coin, "10" for ten coins.
//
// Two readings of it have each broken the settlement lane. Requiring all
// digits (base units) rejected "0.5", so the queue mislabelled the debt,
// auto-pay scored every obligation amount-mismatch and the manual Pay path
// refused to sign. Then reading a bare integer as base units paid a 10 DOGE
// debt as 10 base units: the transaction confirmed, the indexer found the
// payee output short and settled nothing, and the match expired.
//
// The parser is deliberately narrow: it feeds a signing-path equality check,
// where a lenient parse is a wrong payment rather than a display glitch.

import { describe, it, expect } from 'vitest';
import { obligationBaseUnits } from '../../../packages/core/src/market/obligationStatus.js';

describe('obligationBaseUnits', () => {
    it('[REGRESSION] reads the decimal coin figure the explorer actually serves', () => {
        expect(obligationBaseUnits('0.5')).toBe(50_000_000n);
        expect(obligationBaseUnits('0.50000000')).toBe(50_000_000n);
        expect(obligationBaseUnits('1.00000001')).toBe(100_000_001n);
        expect(obligationBaseUnits('10.5')).toBe(1_050_000_000n);
    });

    it('[REGRESSION] scales a whole-coin figure by 1e8 too, never as base units', () => {
        // A 10 DOGE debt arrives as "10". Read as base units it is paid at
        // 0.0000001 DOGE and the indexer skips the COINPAY as short.
        expect(obligationBaseUnits('10')).toBe(1_000_000_000n);
        expect(obligationBaseUnits(10)).toBe(1_000_000_000n);
        expect(obligationBaseUnits('1')).toBe(100_000_000n);
        expect(obligationBaseUnits('50000000')).toBe(5_000_000_000_000_000n);
        expect(obligationBaseUnits(50_000_000)).toBe(5_000_000_000_000_000n);
        expect(obligationBaseUnits('0')).toBe(0n);
    });

    it('holds exact past 2^53, where Number() would collide two different debts', () => {
        // A DOGE-scale obligation: 9,007,199.25474099 coins.
        expect(obligationBaseUnits('9007199.25474099')).toBe(900_719_925_474_099n);
        expect(obligationBaseUnits('90071992547.40993')).toBe(9_007_199_254_740_993_000n);
        expect(obligationBaseUnits('90071992547409931')).toBe(9_007_199_254_740_993_100_000_000n);
    });

    it('refuses everything else, because this feeds a signing comparison', () => {
        for (const bad of ['0x10', '1e8', ' -1', '-1', '1.', '.5', '1.2.3', 'abc', '',
            null, undefined, {}, '1 000', '0.123456789']) {
            expect(obligationBaseUnits(bad), `accepted ${JSON.stringify(bad)}`).toBeNull();
        }
    });

    it('refuses more precision than the coin has, rather than silently truncating', () => {
        // Nine decimals is not a coin amount; rounding it would sign a number
        // the user never agreed to.
        expect(obligationBaseUnits('0.123456789')).toBeNull();
        expect(obligationBaseUnits('0.000000001')).toBeNull();
        expect(obligationBaseUnits('0.12345678')).toBe(12_345_678n);
        expect(obligationBaseUnits('0.00000001')).toBe(1n);
    });
});
