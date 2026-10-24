// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Hostile recipient and amount text for the Send form: what the validators
// accept, what they reject, and that nothing is rewritten into another value.

import { describe, expect, it } from 'vitest';

import {
    addressValidationError,
    isValidAddressForChain,
} from '../../../../packages/core/src/shared/utils/addressValidation.js';
import { normalizeAmountFieldInput } from '../../../../packages/core/src/shared/utils/amountFormat.js';

const BTC_MAIN = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const MAINNET = { coin: 'bitcoin', networkKind: 'mainnet' };
const ok = (address) => isValidAddressForChain(address, 'bitcoin', 'mainnet');

describe('recipient address text', () => {
    it('accepts surrounding whitespace and an all-uppercase bech32', () => {
        expect(ok(`  ${BTC_MAIN}  `)).toBe(true);
        expect(ok(`${BTC_MAIN}\n`)).toBe(true);
        expect(ok(BTC_MAIN.toUpperCase())).toBe(true);
    });

    it.each([
        ['mixed-case bech32', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3T4'],
        ['bad checksum', `${BTC_MAIN.slice(0, -1)}q`],
        ['zero-width space inside', `${BTC_MAIN.slice(0, 10)}​${BTC_MAIN.slice(10)}`],
        ['zero-width space at the end', `${BTC_MAIN}​`],
        ['line break inside', `${BTC_MAIN.slice(0, 10)}\n${BTC_MAIN.slice(10)}`],
        ['right-to-left override', `‮${BTC_MAIN}`],
        ['Cyrillic look-alike', BTC_MAIN.replace('q', 'ԛ')],
        ['full-width prefix', BTC_MAIN.replace('bc1', 'ｂｃ１')],
        ['BIP21 URI', `bitcoin:${BTC_MAIN}?amount=0.5&label=Luke`],
        ['upper-case BIP21 URI', `BITCOIN:${BTC_MAIN.toUpperCase()}?amount=0.5`],
        ['5 KB of bech32 characters', `bc1q${'a'.repeat(5000)}`],
        ['markup', '<script>alert(1)</script>'],
        ['emoji', '😀😀😀'],
        ['empty', ''],
    ])('rejects %s', (_name, address) => {
        expect(ok(address)).toBe(false);
    });

    it('names the other network or coin instead of calling it a typo', () => {
        expect(addressValidationError('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', MAINNET))
            .toBe('This is a Bitcoin testnet address, not a Bitcoin mainnet address.');
        expect(addressValidationError('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', MAINNET))
            .toBe('This is a Bitcoin regtest address, not a Bitcoin mainnet address.');
        expect(addressValidationError('ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9', MAINNET))
            .toBe('This is a Litecoin mainnet address, not a Bitcoin mainnet address.');
        expect(addressValidationError(`${BTC_MAIN.slice(0, -1)}q`, MAINNET))
            .toBe('This address has a typo. Check it and try again.');
    });
});

describe('amount text', () => {
    it.each([
        ['0', '0'],
        ['00.01', '00.01'],
        ['1 000', '1000'],
        ['1,000.5', '1000.5'],
        ['1.000,5', '1000.5'],
        ['0.01\n', '0.01'],
        [' 0.01 ', '0.01'],
        ['0.01 BTC', '0.01'],
        ['0.123456789', '0.123456789'],
        ['9'.repeat(100), '9'.repeat(100)],
    ])('reads %j as %j without changing its value', (typed, canonical) => {
        expect(normalizeAmountFieldInput(typed, { unit: 'BTC' })).toBe(canonical);
    });

    it.each([
        ['-1'], ['+5'], ['1e8'], ['1e-9'], ['0x10'], ['1_000'], ['NaN'], ['Infinity'],
        ['1..2'], ['1.2.3'], ['1,2,3'], ['--1'], ['1-'], ['-'],
        ['$12.50'], ['1\n2'], ['1 2'],
        ['١٢٣.٤'], ['１２３.４５'],
    ])('refuses %j instead of guessing a value', (typed) => {
        expect(normalizeAmountFieldInput(typed, { unit: 'BTC' })).toBeNull();
    });
});
