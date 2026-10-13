// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { InvalidSatsAmountError, NonFiniteAmountError } from '../../packages/core/src/sdk/amountValidation.js';
import { applyNativeFeePreflight } from '../../packages/core/src/sdk/nativeFeePreflight.js';
import { applyOracleFeePreflight } from '../../packages/core/src/sdk/oracleFeePreflight.js';

const ACTION = { action: 'ISSUE', params: {} };
const MODE_B = {
    action: 'DISPENSER',
    params: { GIVE_ESCROW: '1', ORACLE_ADDRESS: 'oracle' },
};
const NON_FINITE_VALUES = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['an overflowing JSON number', JSON.parse('{"amount":1e400}').amount],
];
const NON_SATS_VALUES = [
    ['a fractional number', 1234.5],
    ['a fractional string', '1234.5'],
    ['a negative number', -1],
    ['a negative string', '-1'],
    ['a number above 2^53', Number.MAX_SAFE_INTEGER + 2],
    ['a digit string above 2^53', '9007199254740993'],
    ['an exponent string', '1e3'],
    ['null', null],
    ['an empty string', ''],
    ['a blank string', '  '],
    ['a missing amount', undefined],
];

function nativePreflight(requiredFeeSats) {
    const sdk = {
        wallet: { getBitcoinNetwork: () => ({ dustThreshold: 546 }) },
        quoteNativeFee: async () => ({
            supported: true,
            valid: true,
            feeDestination: 'fee',
            requiredFeeSats,
        }),
    };
    return applyNativeFeePreflight({
        sdk,
        actionData: ACTION,
        encoderOpts: { payFeeInNativeCoin: true },
    });
}

function oraclePreflight(requiredFeeSats) {
    const sdk = {
        explorer: {
            getOracleFeeQuote: async () => ({
                valid: true,
                oracleAddress: 'oracle',
                belowDust: false,
                requiredFeeSats,
            }),
        },
    };
    return applyOracleFeePreflight({ sdk, actionData: MODE_B, encoderOpts: {} });
}

describe.each([
    ['native fee quote', nativePreflight],
    ['oracle fee quote', oraclePreflight],
])('%s amount validation', (source, preflight) => {
    it.each(NON_FINITE_VALUES)('refuses %s with a typed error', async (_label, value) => {
        const error = await preflight(value).catch((caught) => caught);
        expect(error).toBeInstanceOf(NonFiniteAmountError);
        expect(error).toMatchObject({
            name: 'NonFiniteAmountError',
            code: 'NON_FINITE_AMOUNT',
            source,
            field: 'requiredFeeSats',
        });
    });

    it.each(NON_SATS_VALUES)('refuses %s instead of building or skipping the fee output', async (_label, value) => {
        const error = await preflight(value).catch((caught) => caught);
        expect(error).toBeInstanceOf(InvalidSatsAmountError);
        expect(error).toMatchObject({
            name: 'InvalidSatsAmountError',
            code: 'INVALID_SATS_AMOUNT',
            source,
            field: 'requiredFeeSats',
        });
    });

    it.each([
        ['a whole number', 2000, 2000],
        ['an all-digit string', '2000', 2000],
    ])('accepts %s', async (_label, value, sats) => {
        const out = await preflight(value);
        const outputs = (out.encoderOpts.customOutputs || []).map((o) => o.value);
        expect(outputs).toContain(sats);
    });

    it('accepts a zero quote and builds no fee output', async () => {
        const out = await preflight(0);
        expect(out.encoderOpts.customOutputs).toEqual([]);
    });
});
