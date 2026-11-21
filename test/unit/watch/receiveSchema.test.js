// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import schema from '../../../packages/core/src/watch/contract/receive.schema.json';
import checkQrBits from '../../../packages/core/src/watch/contract/receiveBits.js';
import validate from '../../../packages/core/src/watch/contract/validate.js';

const QR_SIZES = Array.from({ length: 40 }, (_, index) => 21 + index * 4);

function bitsFor(size) {
    const bytes = Buffer.alloc(Math.ceil((size * size) / 8), 0xa4);
    bytes[bytes.length - 1] = 0x80;
    return bytes.toString('base64');
}

const entry = {
    chainId: 'bitcoin',
    label: 'Bitcoin',
    address: 'bc1qexample',
    qr: { size: 21, bits: bitsFor(21) },
};

describe('watch receive schema', () => {
    it('accepts QR sizes and packed row-major matrix entries', () => {
        for (const size of QR_SIZES) {
            const qr = { size, bits: bitsFor(size) };
            expect(validate(schema, [{ ...entry, qr }])).toEqual([]);
            expect(checkQrBits(qr)).toBe(true);
        }
    });

    it('requires every entry field and rejects unknown fields', () => {
        const { label: _label, ...missingLabel } = entry;
        expect(validate(schema, [{ ...missingLabel, extra: true }])).toEqual([
            '$[0].label',
            '$[0].extra',
        ]);
    });

    it('rejects non-QR sizes and malformed base64', () => {
        expect(validate(schema, [{ ...entry, qr: { size: 23, bits: 'not base64' } }])).toEqual([
            '$[0].qr.size',
            '$[0].qr.bits',
        ]);
    });

    it('rejects short, long and dirty-padding matrices through the schema and helper', () => {
        for (const size of QR_SIZES) {
            const byteLength = Math.ceil((size * size) / 8);
            const badBits = [
                Buffer.alloc(byteLength - 1).toString('base64'),
                Buffer.alloc(byteLength + 1).toString('base64'),
                Buffer.concat([Buffer.alloc(byteLength - 1), Buffer.from([1])]).toString('base64'),
            ];
            for (const bits of badBits) {
                expect(validate(schema, [{ ...entry, qr: { size, bits } }])).toEqual(['$[0].qr.bits']);
                expect(checkQrBits({ size, bits })).toBe(false);
            }
        }
    });

    it('uses the helper for the size-to-length relationship JSON Schema cannot express', () => {
        const bits = bitsFor(25);
        expect(validate(schema, [{ ...entry, qr: { size: 21, bits } }])).toEqual([]);
        expect(checkQrBits({ size: 21, bits })).toBe(false);
    });

    it('leaves the receive cap to the snapshot schema and rejects nulls', () => {
        expect(validate(schema, Array.from({ length: 13 }, () => entry))).toEqual([]);
        expect(validate(schema, [null])).toEqual(['$[0]']);
    });
});
