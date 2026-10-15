// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { detectQrContent } from '../../../packages/core/src/uri/detectQrContent.js';

const registry = defaultRegistry();
const RAW_TRANSACTION = '0200000001'
    + '00'.repeat(32)
    + '00000000'
    + '00'
    + 'ffffffff'
    + '01'
    + '0100000000000000'
    + '00'
    + '00000000';

describe('detectQrContent edge branches', () => {
    it('accepts both inclusive address-length boundaries', () => {
        for (const address of ['A'.repeat(20), 'A'.repeat(90)]) {
            expect(detectQrContent(address)).toEqual({ type: 'address', address });
        }
    });

    it.each([
        ['too short', 'A'.repeat(19)],
        ['too long', 'A'.repeat(91)],
        ['embedded whitespace', `${'A'.repeat(20)} ${'B'.repeat(20)}`],
        ['punctuation', `${'A'.repeat(19)}_`],
    ])('rejects an address heuristic candidate that is %s', (_label, input) => {
        expect(detectQrContent(input)).toEqual({ type: 'unknown' });
    });

    it('normalizes uppercase PSBT and transaction hex', () => {
        expect(detectQrContent('70736274FF00')).toEqual({
            type: 'psbt-hex',
            psbtHex: '70736274ff00',
        });
        expect(detectQrContent(RAW_TRANSACTION.toUpperCase())).toEqual({
            type: 'transaction-hex',
            txHex: RAW_TRANSACTION,
        });
    });

    it('recognizes a known payment scheme case-insensitively', () => {
        expect(detectQrContent('BITCOIN:recipient', { chainRegistry: registry })).toMatchObject({
            type: 'bip21',
            scheme: 'bitcoin',
            address: 'recipient',
        });
    });

    it.each([
        'xchain:?amount=1',
        '70736274ff0',
        '00'.repeat(9),
    ])('falls through malformed structured content without misclassifying it: %s', (input) => {
        expect(detectQrContent(input, { chainRegistry: registry })).toEqual({ type: 'unknown' });
    });
});
