// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { normalizeRecoveryPhrase } from '../../../packages/core/src/crypto/recoveryPhrase.js';

describe('crypto/recoveryPhrase branch handling', () => {
    it.each([undefined, null, 42, {}])('maps non-string input to an empty phrase', (value) => {
        expect(normalizeRecoveryPhrase(value)).toBe('');
    });

    it('normalizes whitespace and case in an unnumbered phrase', () => {
        expect(normalizeRecoveryPhrase('  Alpha\n BETA   gamma  ')).toBe('alpha beta gamma');
    });

    it('removes complete sequential display numbering', () => {
        expect(normalizeRecoveryPhrase('1. Alpha 2. BETA 3. gamma')).toBe('alpha beta gamma');
    });

    it.each([
        ['missing number', 'alpha 2. beta'],
        ['out-of-sequence number', '1. alpha 3. beta'],
        ['odd token count', '1. alpha 2.'],
        ['number-like word', '1 alpha 2 beta'],
    ])('preserves numeric tokens for validation when numbering is %s', (_label, phrase) => {
        expect(normalizeRecoveryPhrase(phrase)).toBe(phrase);
    });

    it.each(['\u200B', '\u200C', '\u200D', '\u2060', '\u00AD', '\u200E'])('drops the invisible character U+%s from a pasted phrase', (mark) => {
        expect(normalizeRecoveryPhrase(`alpha${mark} ${mark}beta gam${mark}ma`)).toBe('alpha beta gamma');
    });

    it('keeps numbering removal working around invisible characters', () => {
        expect(normalizeRecoveryPhrase('1.\u200B Alpha \u200B2. Beta')).toBe('alpha beta');
    });

    it('normalizes an empty string', () => {
        expect(normalizeRecoveryPhrase('   ')).toBe('');
    });
});
