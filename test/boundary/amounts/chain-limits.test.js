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
    coinToFiat,
    coinToFiatExact,
    fiatToCoin,
} from '../../../packages/core/src/flows/priceLookup.js';
import {
    formatNativeBaseUnits,
    nativeUnitScaleFor,
} from '../../../packages/core/src/registry/coinTicker.js';
import { dustThresholdForCoin } from '../../../packages/core/src/sdk/nativeFeePreflight.js';
import {
    decimalFromBaseUnits,
    decimalToBaseUnits,
    tokenAmountPrecisionError,
} from '../../../packages/core/src/shared/utils/amountFormat.js';
import { requireSdkDeep } from '../../helpers/sdkDeepPaths.js';

const Validator = requireSdkDeep('protocolValidator');
const Utility = requireSdkDeep('utility');

const MAX_TOKEN_SUPPLY = '1000000000000000000000';
const CHAINS = [
    { coin: 'bitcoin', dust: 546n },
    { coin: 'litecoin', dust: 5460n },
    { coin: 'dogecoin', dust: 100000n },
];

describe.each(CHAINS)('$coin amount boundaries', ({ coin, dust }) => {
    it('round-trips the smallest native unit exactly', () => {
        expect(nativeUnitScaleFor(coin)).toBe(100000000n);
        expect(formatNativeBaseUnits(1n, coin)).toBe('0.00000001');
        expect(decimalToBaseUnits('0.00000001', 8)).toBe(1n);
        expect(decimalFromBaseUnits(1n, 8)).toBe('0.00000001');
    });

    it('pins the amount immediately below dust and the dust floor', () => {
        expect(BigInt(dustThresholdForCoin(coin))).toBe(dust);
        expect(decimalToBaseUnits(formatNativeBaseUnits(dust - 1n, coin), 8)).toBe(dust - 1n);
        expect(decimalToBaseUnits(formatNativeBaseUnits(dust, coin), 8)).toBe(dust);
    });

    it('accepts the protocol maximum token supply and rejects one unit above it', () => {
        const validator = new Validator(new Utility(), `${coin}-regtest`);
        const params = { VERSION: '0', TICK: 'LIMIT', DECIMALS: '8' };
        expect(validator.validate('ISSUE', { ...params, MAX_SUPPLY: MAX_TOKEN_SUPPLY }))
            .toEqual([]);

        const above = `${MAX_TOKEN_SUPPLY}.00000001`;
        const errors = validator.validate('ISSUE', { ...params, MAX_SUPPLY: above });
        expect(errors.some((error) => error.details?.field === 'MAX_SUPPLY')).toBe(true);
    });
});

describe('decimal and token precision boundaries', () => {
    it('rounds half up at the eighth decimal without emitting exponent notation', () => {
        expect(fiatToCoin('0.000000004', { rate: 1 })).toBe('0');
        expect(fiatToCoin('0.000000005', { rate: 1 })).toBe('0.00000001');
        expect(fiatToCoin('0.999999995', { rate: 1 })).toBe('1');
    });

    it('distinguishes divisible and indivisible token amounts', () => {
        expect(tokenAmountPrecisionError('1', { divisibility: 0, tick: 'WHOLE' })).toBeNull();
        expect(tokenAmountPrecisionError('1.0', { divisibility: 0, tick: 'WHOLE' }))
            .toContain('indivisible');
        expect(tokenAmountPrecisionError('1.12345678', { divisibility: 8, tick: 'PARTS' }))
            .toBeNull();
        expect(tokenAmountPrecisionError('1.123456789', { divisibility: 8, tick: 'PARTS' }))
            .toContain('at most 8 decimal places');
    });
});

describe('fiat conversion at extreme prices', () => {
    it('keeps the smallest unit exact at very low and very high prices', () => {
        expect(coinToFiatExact(1e-8, { rate: 1e-8 })).toBe('0.0000000000000001');
        expect(coinToFiatExact('0.00000001', { rate: 1e21 })).toBe('10000000000000');
        expect(fiatToCoin('1', { rate: 1e-8 })).toBe('100000000');
    });

    it('refuses invalid or overflowing prices instead of returning non-finite amounts', () => {
        expect(fiatToCoin('1', { rate: -1 })).toBeNull();
        expect(fiatToCoin('1', { rate: Number.POSITIVE_INFINITY })).toBeNull();
        expect(coinToFiat('2', { rate: 1e308 })).toBeNull();
    });
});
