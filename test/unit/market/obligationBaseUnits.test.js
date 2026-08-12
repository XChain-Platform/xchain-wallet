// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A CoinPay obligation's amount arrives in one of two shapes, and reading only
// one of them made the whole settlement lane unusable.
//
// MEASURED on Litecoin regtest 2026-07-29 while driving the first ORDER match
// this campaign has produced: the indexer stores an obligation's COIN_AMOUNT as
// the match's own DECIMAL coin figure (`order_match.js`:
// `COIN_AMOUNT: nativeCoinAmount`) and the explorer serves that column verbatim,
// so a 0.5 LTC debt arrives as "0.5". Three wallet readers required all digits:
//
//   - ObligationsView labelled the row "0.5 base units" - the wrong unit, and a
//     figure 100,000,000x smaller than the debt;
//   - autopayPolicy's cap 2 scored every obligation `amount-mismatch`, so PC-16
//     auto-pay could never pay one (it failed CLOSED, which is the right
//     direction, but the feature was inert);
//   - verifyCoinpayObligation threw "unusable coin_amount", so the manual Pay
//     path refused to sign.
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
    });

    it('still reads a bare integer as base units, which is what other callers pass', () => {
        expect(obligationBaseUnits('50000000')).toBe(50_000_000n);
        expect(obligationBaseUnits(50_000_000)).toBe(50_000_000n);
        expect(obligationBaseUnits('0')).toBe(0n);
    });

    it('holds exact past 2^53, where Number() would collide two different debts', () => {
        // A DOGE-scale obligation: 9,007,199.254740993 coins.
        expect(obligationBaseUnits('9007199.25474099')).toBe(900_719_925_474_099n);
        expect(obligationBaseUnits('90071992547409931')).toBe(90_071_992_547_409_931n);
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
        expect(obligationBaseUnits('0.12345678')).toBe(12_345_678n);
    });
});
