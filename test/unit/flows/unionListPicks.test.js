// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import {
    UNION_MAX_LISTS,
    UNION_MAX_MERGED,
    unionPickState,
} from '../../../packages/core/src/flows/unionListPicks.js';

const candidate = (actionIndex, type, members = []) => ({ actionIndex, type, members });

describe('unionPickState', () => {
    it('locks an address-list pick against token lists', () => {
        const state = unionPickState({
            picked: ['address'],
            candidates: [candidate('address', '2'), candidate('token', '1')],
        });

        expect(state.pickedType).toBe('2');
        expect(state.rows).toEqual([
            { actionIndex: 'address', picked: true, disabled: false, reason: null },
            { actionIndex: 'token', picked: false, disabled: true, reason: 'A union holds lists of one type' },
        ]);
    });

    it('locks a token-list pick against address lists', () => {
        const state = unionPickState({
            picked: ['token'],
            candidates: [candidate('address', '2'), candidate('token', '1')],
        });

        expect(state.pickedType).toBe('1');
        expect(state.rows[0]).toEqual({
            actionIndex: 'address',
            picked: false,
            disabled: true,
            reason: 'A union holds lists of one type',
        });
    });

    it('excludes union lists', () => {
        const state = unionPickState({ picked: [], candidates: [candidate('union', '3')] });

        expect(state.rows[0]).toEqual({
            actionIndex: 'union',
            picked: false,
            disabled: true,
            reason: 'Union lists cannot be members of a union',
        });
        expect(state.canReview).toBe(false);
    });

    it('refuses a seventeenth list while keeping all picked rows enabled', () => {
        const candidates = Array.from(
            { length: UNION_MAX_LISTS + 1 },
            (_, index) => candidate(String(index + 1), '2'),
        );
        const picked = candidates.slice(0, UNION_MAX_LISTS).map(({ actionIndex }) => actionIndex);
        const state = unionPickState({ picked, candidates });

        expect(state.rows.slice(0, UNION_MAX_LISTS).every((row) => !row.disabled)).toBe(true);
        expect(state.rows[UNION_MAX_LISTS]).toEqual({
            actionIndex: String(UNION_MAX_LISTS + 1),
            picked: false,
            disabled: true,
            reason: 'A union holds at most 16 lists',
        });
    });

    it('deduplicates shared members in the merged count', () => {
        const state = unionPickState({
            picked: ['a', 'b'],
            candidates: [candidate('a', '2', ['one', 'shared']), candidate('b', '2', ['shared', 'three'])],
        });

        expect(state.mergedCount).toBe(3);
        expect(state.overLimit).toBe(false);
        expect(state.canReview).toBe(true);
    });

    it('returns a null count when a picked list has no known members', () => {
        const unknown = { actionIndex: 'b', type: '2' };
        const state = unionPickState({
            picked: ['a', 'missing', 'b'],
            candidates: [candidate('a', '2', ['one']), unknown],
        });

        expect(state.mergedCount).toBeNull();
        expect(state.overLimit).toBe(false);
        expect(state.canReview).toBe(true);
    });

    it('refuses review above the merged member limit', () => {
        const members = Array.from({ length: UNION_MAX_MERGED + 1 }, (_, index) => `member-${index}`);
        const state = unionPickState({ picked: ['large'], candidates: [candidate('large', '2', members)] });

        expect(state.mergedCount).toBe(UNION_MAX_MERGED + 1);
        expect(state.overLimit).toBe(true);
        expect(state.canReview).toBe(false);
    });

    it('does not mutate either input array or candidate members', () => {
        const members = ['b', 'a'];
        const picked = ['unknown', 'known'];
        const candidates = [candidate('known', '1', members)];
        const before = JSON.stringify({ picked, candidates });

        const state = unionPickState({ picked, candidates });

        expect(JSON.stringify({ picked, candidates })).toBe(before);
        expect(state.pickedType).toBe('1');
        expect(state.mergedCount).toBe(2);
    });
});
