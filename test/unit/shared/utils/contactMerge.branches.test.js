// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
    compareContactsByName,
    compareContactsByNewest,
    duplicateNameGroups,
    findContactByName,
    mergeContactGroup,
    withEntriesAdded,
} from '../../../../packages/core/src/shared/utils/contactMerge.js';

describe('contact merge branch coverage', () => {
    it('compares present and absent sorting fields', () => {
        expect(compareContactsByName({ name: 'Alice' }, { name: 'Bob' })).toBeLessThan(0);
        expect(compareContactsByName(null, null)).toBe(0);
        expect(compareContactsByNewest(
            { createdAt: '2026-02-01' },
            { createdAt: '2026-01-01' },
        )).toBeLessThan(0);
        expect(compareContactsByNewest(null, null)).toBe(0);
    });

    it('rejects blank names and non-array contact collections', () => {
        expect(findContactByName([], '')).toBeNull();
        expect(findContactByName(null, 'Alice')).toBeNull();
        expect(findContactByName([{ name: null }], 'Alice')).toBeNull();
    });

    it('adds entries to contacts with absent data and deduplicates the new batch', () => {
        expect(withEntriesAdded(null, null)).toEqual({ entries: [] });
        expect(withEntriesAdded({ entries: 'invalid' }, [
            {},
            { chain: '', address: '' },
            { chain: 'btc', address: ' A ' },
            { chain: 'btc', address: 'a' },
        ])).toEqual({
            entries: [{}, { chain: 'btc', address: ' A ' }],
        });
    });

    it('ignores blank names and null collections when grouping duplicates', () => {
        expect(duplicateNameGroups(null)).toEqual([]);
        expect(duplicateNameGroups([
            { id: 'blank', name: '   ' },
            { id: 'missing' },
            { id: 'one', name: 'Alice' },
            { id: 'two', name: 'alice' },
        ])).toEqual([[
            { id: 'one', name: 'Alice' },
            { id: 'two', name: 'alice' },
        ]]);
    });

    it('merges contacts whose optional timestamps and notes are absent', () => {
        const result = mergeContactGroup([
            { id: 'dated', name: 'Alice', createdAt: '2026-01-01', entries: [] },
            { id: 'missing-a', name: 'Alice', entries: null, notes: null },
            { id: 'missing-b', name: 'Alice', createdAt: null, entries: [] },
        ]);

        expect(result.keep.id).toBe('missing-a');
        expect(result.keep.notes).toBe('');
        expect(result.dropIds).toEqual(['missing-b', 'dated']);
    });
});
