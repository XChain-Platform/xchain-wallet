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

import {
    InvalidSatsAmountError,
    NonFiniteAmountError,
    satsResponseAmount,
} from '../../../packages/core/src/sdk/amountValidation.js';

const CONTEXT = { source: 'fee quote', field: 'requiredFeeSats' };

describe('satsResponseAmount', () => {
    it.each([
        ['zero', 0, 0],
        ['a safe integer', 1250, 1250],
        ['the largest safe integer', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
        ['an all-digit string', '1250', 1250],
        ['a zero-padded digit string', '001250', 1250],
    ])('accepts %s', (_label, value, expected) => {
        expect(satsResponseAmount(value, CONTEXT)).toBe(expected);
    });

    it.each([
        ['NaN', NaN],
        ['positive infinity', Infinity],
        ['negative infinity', -Infinity],
    ])('reports %s as a non-finite server amount', (_label, value) => {
        const read = () => satsResponseAmount(value, CONTEXT);

        expect(read).toThrow(NonFiniteAmountError);
        try {
            read();
        } catch (error) {
            expect(error).toMatchObject({
                name: 'NonFiniteAmountError',
                code: 'NON_FINITE_AMOUNT',
                source: CONTEXT.source,
                field: CONTEXT.field,
            });
            expect(error.value).toBe(value);
            expect(error.message).toBe('fee quote returned a non-finite requiredFeeSats');
        }
    });

    it.each([
        ['a fractional number', 1.5],
        ['a negative number', -1],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
        ['a fractional string', '1.5'],
        ['a signed string', '+1'],
        ['an exponent string', '1e3'],
        ['a string above the safe integer limit', '9007199254740992'],
        ['an empty string', ''],
        ['a blank string', ' '],
        ['null', null],
        ['a bigint', 1n],
        ['a missing value', undefined],
    ])('rejects %s with the original response metadata', (_label, value) => {
        const read = () => satsResponseAmount(value, CONTEXT);

        expect(read).toThrow(InvalidSatsAmountError);
        try {
            read();
        } catch (error) {
            expect(error).toMatchObject({
                name: 'InvalidSatsAmountError',
                code: 'INVALID_SATS_AMOUNT',
                source: CONTEXT.source,
                field: CONTEXT.field,
                value,
                message: 'fee quote returned requiredFeeSats that is not a whole, non-negative satoshi amount',
            });
        }
    });
});
