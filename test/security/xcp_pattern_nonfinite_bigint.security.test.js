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
import { NonFiniteAmountError } from '../../packages/core/src/sdk/amountValidation.js';
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

function nativePreflight(requiredFeeSats) {
    const sdk = {
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
});
