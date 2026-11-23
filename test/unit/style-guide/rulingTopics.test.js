// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import topics from '../../../packages/web/src/style-guide/rulingTopics.json';

const entries = Object.entries(topics);

const kindOrder = new Map([['G', 0], ['U', 1], ['P', 2]]);

function compareRulingIds(left, right) {
    const kindDifference = kindOrder.get(left[0]) - kindOrder.get(right[0]);
    return kindDifference || Number(left.slice(1)) - Number(right.slice(1));
}

describe('rulingTopics', () => {
    it('has a non-empty lowercase hyphenated slug for every entry', () => {
        expect(entries).toHaveLength(197);
        expect(entries.every(([, topic]) => typeof topic === 'string' && topic.length > 0)).toBe(true);
        expect(entries.every(([, topic]) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic))).toBe(true);
    });

    it('sorts ids numerically within G, U, then P', () => {
        const ids = entries.map(([id]) => id);
        expect(ids).toEqual([...ids].sort(compareRulingIds));
        expect(ids.filter((id) => id.startsWith('G'))).toHaveLength(87);
        expect(ids.filter((id) => id.startsWith('U'))).toHaveLength(105);
        expect(ids.filter((id) => id.startsWith('P'))).toHaveLength(5);
    });

    it('groups wallet-menu rulings while preserving the bottom-sheet exception', () => {
        expect(['G03', 'U49', 'U98', 'U99', 'U104'].map((id) => topics[id]))
            .toEqual(Array(5).fill('wallet-menu'));
        expect(topics.G70).toBe('no-bottom-sheets');
    });
});
