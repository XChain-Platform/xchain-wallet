// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5.2.5: the confirm surface shows the fee the composed PSBT actually
// pays, not a rate-table estimate. The whole point of the single-encode
// pipeline is that what the user sees is what gets signed, and the fee is part
// of what they agree to.
//
// The load-bearing case is the REFUSAL to compute: a PSBT input carries a
// value only when it also carries the witnessUtxo or the full previous
// transaction. Subtracting outputs from a partial input total yields a number
// that looks like a fee and is too small, which on a signing screen is worse
// than admitting it is unknown.

import { describe, it, expect } from 'vitest';
import { exactNetworkFeeSats } from '../../../packages/core/src/flows/psbtNetworkFee.js';

describe('exactNetworkFeeSats', () => {
    it('computes inputs minus outputs', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, { value: 50000 }],
            outputs: [{ value: 120000 }, { value: 25000 }],
        })).toBe(5000);
    });

    it('counts a zero-value data output', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 10000 }],
            outputs: [{ value: 9000 }, { value: 0 }],
        })).toBe(1000);
    });

    it('returns null when ANY input value is missing', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, { value: null }],
            outputs: [{ value: 90000 }],
        })).toBe(null);
        expect(exactNetworkFeeSats({
            inputs: [{ value: 100000 }, {}],
            outputs: [{ value: 90000 }],
        })).toBe(null);
    });

    it('returns null for a missing or empty decomposition', () => {
        expect(exactNetworkFeeSats(null)).toBe(null);
        expect(exactNetworkFeeSats({})).toBe(null);
        expect(exactNetworkFeeSats({ inputs: [], outputs: [] })).toBe(null);
    });

    it('returns null rather than a negative fee', () => {
        // Outputs exceeding inputs cannot happen in a well-formed tx; showing
        // "-0.001 BTC" on a signing screen would be nonsense.
        expect(exactNetworkFeeSats({
            inputs: [{ value: 1000 }],
            outputs: [{ value: 5000 }],
        })).toBe(null);
    });

    it('accepts a zero fee', () => {
        expect(exactNetworkFeeSats({
            inputs: [{ value: 1000 }],
            outputs: [{ value: 1000 }],
        })).toBe(0);
    });
});
