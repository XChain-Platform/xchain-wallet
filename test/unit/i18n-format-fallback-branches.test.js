// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { format } from '../../packages/core/src/i18n/index.js';

describe('i18n format fallback branches', () => {
    it('coerces non-string templates and fast-paths literal text', () => {
        expect(format(42)).toBe('42');
        expect(format(null)).toBe('null');
        expect(format('literal text', { unused: 'value' })).toBe('literal text');
    });

    it('preserves missing simple and nested select arguments', () => {
        expect(format('Hello {name}')).toBe('Hello {name}');
        expect(format(
            '{kind, select, named {Hello {name}} other {Hello}}',
            { kind: 'named' },
        )).toBe('Hello {name}');
    });

    it('routes missing coercing arguments through legacy formatting', () => {
        expect(format('{count, plural, one {# item} other {# items}}'))
            .toBe('{count} items');
        expect(format('{amount, number}')).toBe('{amount}');
        expect(format('{when, date, short}')).toBe('{when}');
    });

    it('honors exact plurals and recursively substitutes selected cases', () => {
        const template = [
            '{count, plural, =0 {No items for {name}}',
            'one {# item for {name}} other {# items for {name}}}',
        ].join(' ');

        expect(format(template, { count: 0, name: 'Ada' })).toBe('No items for Ada');
        expect(format(template, { count: 2, name: 'Ada' })).toBe('2 items for Ada');
    });

    it('degrades malformed and unknown ICU arguments without throwing', () => {
        expect(format('before {name', { name: 'Ada' })).toBe('before {name');
        expect(format('{name, mystery, ignored}', { name: 'Ada' })).toBe('Ada');
        expect(format(
            '{kind, select, a {A} other {Other}',
            { kind: 'a' },
        )).toBe('{kind, select, a {A} other {Other}');
    });

    it('renders empty output when no plural or select case matches', () => {
        expect(format('{count, plural, one {one}}', { count: 2 })).toBe('');
        expect(format('{kind, select, ready {Ready}}', { kind: 'waiting' })).toBe('');
    });
});
