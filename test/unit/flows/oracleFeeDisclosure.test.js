// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import { oracleUsageFeeLine } from '../../../packages/core/src/flows/oracleFeeDisclosure.js';

describe('oracleUsageFeeLine', () => {
    it('names the oracle usage fee and native ticker', () => {
        const composed = {
            oracleFeeQuote: { requiredFeeSats: 1500, belowDust: false },
        };

        expect(oracleUsageFeeLine({ composed, ticker: 'BTC' })).toEqual({
            amount: '0.000015',
            tick: 'BTC',
            text: 'Oracle usage fee: 0.000015 BTC '
                + "(paid once, now, to the price oracle's operator from this transaction)",
        });
    });

    it('returns null when the composed result has no oracle usage fee', () => {
        expect(oracleUsageFeeLine({ composed: {}, ticker: 'BTC' })).toBeNull();
    });

    it('does not throw when called without arguments', () => {
        expect(() => oracleUsageFeeLine()).not.toThrow();
        expect(oracleUsageFeeLine()).toBeNull();
    });
});
