// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    compareContactsByName,
    compareContactsByNewest,
} from '../../../../packages/core/src/shared/utils/contactMerge.js';

describe('compareContactsByName', () => {
    it('orders names case-insensitively by base letters', () => {
        expect(compareContactsByName({ name: 'alice' }, { name: 'Bob' })).toBeLessThan(0);
        expect(compareContactsByName({ name: 'Bob' }, { name: 'alice' })).toBeGreaterThan(0);
        expect(compareContactsByName({ name: 'Bob' }, { name: 'bob' })).toBe(0);
    });

    it('treats a missing name as an empty string', () => {
        expect(compareContactsByName({}, { name: 'a' })).toBeLessThan(0);
        expect(compareContactsByName({ name: 'a' }, {})).toBeGreaterThan(0);
        expect(compareContactsByName(null, undefined)).toBe(0);
    });
});

describe('compareContactsByNewest', () => {
    it('orders later timestamps first', () => {
        const later = { createdAt: '2026-01-02' };
        const earlier = { createdAt: '2026-01-01' };
        expect(compareContactsByNewest(later, earlier)).toBeLessThan(0);
        expect(compareContactsByNewest(earlier, later)).toBeGreaterThan(0);
        expect(compareContactsByNewest(later, { ...later })).toBe(0);
    });

    it('puts a missing timestamp last', () => {
        expect(compareContactsByNewest({}, { createdAt: '2026-01-01' })).toBeGreaterThan(0);
        expect(compareContactsByNewest({ createdAt: '2026-01-01' }, {})).toBeLessThan(0);
        expect(compareContactsByNewest(null, null)).toBe(0);
    });
});

describe('contact sorting', () => {
    const contacts = [
        { name: 'Charlie', createdAt: '2026-01-01' },
        { name: 'alice', createdAt: '2026-01-03' },
        { name: 'Bob', createdAt: '2026-01-02' },
    ];

    it('sorts contact arrays alphabetically by name', () => {
        const names = [...contacts].sort(compareContactsByName).map(({ name }) => name);
        expect(names).toEqual(['alice', 'Bob', 'Charlie']);
    });

    it('sorts contact arrays from newest to oldest', () => {
        const dates = [...contacts].sort(compareContactsByNewest).map(({ createdAt }) => createdAt);
        expect(dates).toEqual(['2026-01-03', '2026-01-02', '2026-01-01']);
    });
});
