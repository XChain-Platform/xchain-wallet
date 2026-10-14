// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../../packages/core/src/airdrop/parseRecipients.js';

describe('parseCsv edge cases', () => {
    it.each([undefined, null, 42, {}, [], ''])(
        'returns no recipients for non-text or empty input %#',
        (input) => {
            expect(parseCsv(input)).toEqual([]);
        },
    );

    it('returns no recipients for records containing only blank cells', () => {
        expect(parseCsv('\uFEFF,  \r\n,\n')).toEqual([]);
    });

    it('finds a case-insensitive header after blank rows and a BOM', () => {
        expect(parseCsv('\uFEFF\r\n,\r\n AdDrEsS ,label\r\nalpha,first\r\n'))
            .toEqual(['alpha']);
    });

    it('keeps the first content row when it is not a header', () => {
        expect(parseCsv('alpha,first\nbeta,second')).toEqual(['alpha', 'beta']);
    });

    it('uses only non-empty first-column cells and trims their values', () => {
        expect(parseCsv('address,label\n ,ignored\n alpha ,one\n\uFEFFbeta,two\n'))
            .toEqual(['alpha', 'beta']);
    });

    it('keeps commas and escaped quotes inside a quoted first column', () => {
        expect(parseCsv('"alpha,beta",one\n"gamma""delta",two'))
            .toEqual(['alpha,beta', 'gamma"delta']);
    });
});
