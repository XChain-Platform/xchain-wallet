// @vitest-environment node
// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { cutAtWord } from '../../../packages/core/src/watch/buildWatchDetail.js';

describe('cutAtWord', () => {
    it('returns trimmed text unchanged at exactly 280 code points', () => {
        const text = `  ${'a'.repeat(280)}  `;

        expect(cutAtWord(text, 280)).toBe('a'.repeat(280));
    });

    it('cuts 281 code points at the last whitespace in the prefix', () => {
        const text = `${'a'.repeat(270)} ${'b'.repeat(10)}`;

        expect([...text]).toHaveLength(281);
        expect(cutAtWord(text, 280)).toBe(`${'a'.repeat(270)}…`);
    });

    it('hard-cuts a single word longer than max', () => {
        const result = cutAtWord('a'.repeat(281), 280);

        expect(result).toBe(`${'a'.repeat(279)}…`);
        expect([...result]).toHaveLength(280);
    });

    it('does not split an emoji that straddles the code-unit cut', () => {
        const text = `${'a'.repeat(278)}😀xy`;
        const result = cutAtWord(text, 280);

        expect([...text]).toHaveLength(281);
        expect(result).toBe(`${'a'.repeat(278)}😀…`);
        expect([...result]).toHaveLength(280);
    });

    it.each([
        ['empty text', ''],
        ['whitespace-only text', '   '],
        ['undefined', undefined],
        ['null', null],
        ['a number', 42],
    ])('returns an empty string for %s', (_label, text) => {
        expect(cutAtWord(text, 280)).toBe('');
    });
});
