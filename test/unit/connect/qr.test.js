// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { encodeQr } from '../../../packages/connect/src/qr.js';

const LINK_PREFIX = 'https://example.com/?payload=';
const CASES = [
    ['five ASCII characters', 'abcde'],
    ['300-character link', `${LINK_PREFIX}${'a'.repeat(300 - LINK_PREFIX.length)}`],
    ['multi-byte UTF-8 text', 'XChain: café, 東京, 🚀'],
    ['2,900-character link', `${LINK_PREFIX}${'a'.repeat(2_900 - LINK_PREFIX.length)}`],
];

function reference(text, options = {}) {
    return QRCode.create([{ data: text, mode: 'byte' }], {
        errorCorrectionLevel: 'L',
        ...options,
    });
}

function expectSameModules(actual, expected) {
    expect(actual.version).toBe(expected.version);
    expect(actual.size).toBe(expected.modules.size);
    expect(actual.modules).toHaveLength(actual.size);
    for (let row = 0; row < actual.size; row += 1) {
        expect(actual.modules[row]).toHaveLength(actual.size);
        for (let col = 0; col < actual.size; col += 1) {
            expect(actual.modules[row][col], `module (${row}, ${col})`)
                .toBe(Boolean(expected.modules.get(row, col)));
        }
    }
}

describe('encodeQr', () => {
    for (const [name, text] of CASES) {
        it(`matches qrcode for ${name} with forced masks and versions`, () => {
            const chosenVersion = reference(text).version;
            for (const maskPattern of [0, 5]) {
                expectSameModules(
                    encodeQr(text, { mask: maskPattern }),
                    reference(text, { maskPattern })
                );
                expectSameModules(
                    encodeQr(text, { mask: maskPattern, version: chosenVersion }),
                    reference(text, { maskPattern, version: chosenVersion })
                );
            }
        });

        it(`matches qrcode mask selection for ${name}`, () => {
            const chosenVersion = reference(text).version;
            expectSameModules(encodeQr(text), reference(text));
            expectSameModules(
                encodeQr(text, { version: chosenVersion }),
                reference(text, { version: chosenVersion })
            );
        });
    }

    it('returns boolean rows', () => {
        const result = encodeQr('abcde', { mask: 0, version: 1 });
        expect(result.size).toBe(21);
        expect(result.modules.flat().every((module) => typeof module === 'boolean')).toBe(true);
    });

    it('throws when byte-mode text exceeds version 40 at level L', () => {
        expect(() => encodeQr('a'.repeat(2_954))).toThrow(RangeError);
    });
});
