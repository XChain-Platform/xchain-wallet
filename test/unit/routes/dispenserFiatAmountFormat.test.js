// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// D-142: the Create Dispenser form refused fiat prices the CHAIN accepts.
//
// The protocol rule is `isValidFiatFormat(2, amount)` - an ordinary amount whose
// fractional part is at most 2 digits - and the form tested `/^\d+\.\d{2}$/`,
// which demands the decimal point AND both digits. So `3` was refused for a
// price the indexer would have stored, and on JPY or KRW (both offered by the
// form's own currency list, neither having a minor unit) every natural price was
// refused: 500 yen had to be typed 500.00.
//
// This is a PARITY test rather than a second copy of the regex: the second
// opinion below is written as the protocol writes it (split on the point, count
// the fractional digits) rather than as a pattern, so the two implementations
// can only agree by both being right. The wallet tree does not resolve
// xchain-sdk at unit-test time - it is loaded through a runtime factory, not a
// dependency - so the rule is restated here from its source rather than
// imported, and the source is named so a drift is traceable:
// `xchain-indexer/src/utility.js isValidFiatFormat` + `isValidAmountFormat`,
// mirrored in `xchain-sdk/src/utility.js`.

import { describe, it, expect } from 'vitest';
import { isValidFiatAmount } from '../../../packages/core/src/shared/utils/fiatAmountFormat.js';

/** `isValidFiatFormat(2, amount)`, restated the way the protocol states it. */
function chainAccepts(amount) {
    const s = String(amount ?? '');
    if (s === '' || s.startsWith('-')) return false;
    const [int, frac, ...rest] = s.split('.');
    if (rest.length > 0) return false;
    if (!/^\d+$/.test(int)) return false;
    if (frac === undefined) return true;
    return /^\d+$/.test(frac) && frac.length <= 2;
}

describe('dispenser FIAT_AMOUNT format (D-142)', () => {
    // Each case is a price a seller could reasonably type. The expectation is
    // the CHAIN's answer, so a wrong one here is a claim about the protocol.
    const CASES = [
        ['3', true, 'a whole-dollar price, which the old regex refused'],
        ['3.5', true, 'one decimal place, which the old regex refused'],
        ['3.50', true, 'two decimal places, the only shape the old regex allowed'],
        ['500', true, 'a yen price: JPY has no minor unit and the form offers it'],
        ['0.01', true, 'the smallest ordinary price'],
        ['12.34', true, 'the form\'s own example'],
        ['3.501', false, 'more precision than the currency has'],
        ['-3.00', false, 'a negative price'],
        ['', false, 'nothing typed'],
        ['abc', false, 'not a number'],
        ['3.', false, 'a trailing point with no digits'],
    ];

    for (const [amount, expected, why] of CASES) {
        it(`${expected ? 'accepts' : 'refuses'} "${amount}": ${why}`, () => {
            expect(isValidFiatAmount(amount)).toBe(expected);
        });
    }

    it('AGREES WITH THE CHAIN on every case, which is the point', () => {
        // The bug was not a bad regex in isolation, it was a regex that
        // disagreed with the protocol. Anything the wallet refuses that the
        // chain would take is a seller stopped from pricing their own
        // dispenser; anything it accepts that the chain would reject is a
        // protocol fee spent on an action recorded invalid.
        for (const [amount] of CASES) {
            expect(isValidFiatAmount(amount), `wallet and chain disagree about "${amount}"`)
                .toBe(chainAccepts(amount));
        }
    });
});
