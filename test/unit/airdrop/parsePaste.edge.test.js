// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { parsePaste } from '../../../packages/core/src/airdrop/parseRecipients.js';

describe('parsePaste edge cases', () => {
    it.each([undefined, null, 42, {}, [], ''])(
        'returns no recipients for non-text or empty input %#',
        (input) => {
            expect(parsePaste(input)).toEqual([]);
        },
    );

    it('splits commas and every newline style while dropping empty fields', () => {
        expect(parsePaste(' alpha, ,beta\r\n\n gamma\rdelta,\n'))
            .toEqual(['alpha', 'beta', 'gamma', 'delta']);
    });

    it('strips matched wrapping quotes after trimming each field', () => {
        expect(parsePaste('  " alpha " , \' beta \' , "gamma,delta" '))
            .toEqual(['alpha', 'beta', '"gamma', 'delta"']);
    });

    it('preserves unmatched and one-character quote marks', () => {
        expect(parsePaste("\"alpha, beta', \", '"))
            .toEqual(['"alpha', "beta'", '"', "'"]);
    });
});
