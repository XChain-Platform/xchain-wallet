// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    encodeBip21Uri,
    InvalidBip21Error,
    normalizeBip21Amount,
    parseBip21Uri,
} from '../../../packages/core/src/uri/bip21.js';

describe('BIP21 low-coverage branches', () => {
    it.each([
        [null, /non-empty string/],
        ['', /non-empty string/],
        ['bitcoin', /missing scheme/],
        ['bitcoin:', /missing address/],
        ['bitcoin:?label=x', /missing address/],
    ])('rejects malformed URI boundary %#', (uri, message) => {
        expect(() => parseBip21Uri(uri)).toThrow(message);
    });

    it('accepts empty, valueless, and repeated query separators', () => {
        expect(parseBip21Uri('bitcoin:bc1qexample?flag&&label=')).toMatchObject({
            address: 'bc1qexample',
            params: { flag: '', label: '' },
            label: '',
        });
        expect(parseBip21Uri('bitcoin:bc1qexample?')).toMatchObject({
            params: {},
            required: [],
        });
        expect(parseBip21Uri('bitcoin:bc1qexample')).toMatchObject({
            params: {},
            required: [],
        });
    });

    it('rejects malformed percent encoding and wraps amount validation errors', () => {
        expect(() => parseBip21Uri('bitcoin:bc1qexample?%ZZ=value'))
            .toThrow(InvalidBip21Error);
        expect(() => parseBip21Uri('bitcoin:bc1qexample?amount=1.000000001'))
            .toThrow(/at most 8 decimal places/);
    });

    it('deletes empty parsed and encoded amounts', () => {
        expect(parseBip21Uri('bitcoin:bc1qexample?amount=')).toEqual({
            scheme: 'bitcoin',
            address: 'bc1qexample',
            params: {},
            required: [],
        });
        expect(encodeBip21Uri({
            scheme: 'bitcoin',
            address: 'bc1qexample',
            params: { amount: '' },
        })).toBe('bitcoin:bc1qexample');
    });

    it.each([undefined, null, ''])('omits the empty amount value %s', (amount) => {
        expect(normalizeBip21Amount(amount)).toBeUndefined();
    });

    it('validates encoder scheme and address inputs', () => {
        expect(() => encodeBip21Uri({ scheme: null, address: 'bc1qexample' }))
            .toThrow(/invalid scheme/);
        expect(() => encodeBip21Uri({ scheme: 'bitcoin', address: null }))
            .toThrow(/address is required/);
    });
});
