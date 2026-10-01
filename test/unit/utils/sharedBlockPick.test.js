// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { sharedBlockPickState } from '../../../packages/core/src/shared/utils/sharedBlockPick.js';

describe('sharedBlockPickState', () => {
    it('maps a mirrored list pick into block-list form state', () => {
        expect(sharedBlockPickState({
            actionIndex: 42,
            homeChain: 'litecoin',
            homeListIndex: 7,
            memberCount: 12,
        })).toEqual({
            blockListIdx: '42',
            memberCount: 12,
            label: 'List #42 (shared from litecoin list #7)',
        });
    });

    it('maps a home-chain pick and preserves a text action index', () => {
        expect(sharedBlockPickState({
            actionIndex: '9',
            homeChain: 'bitcoin',
            homeListIndex: 9,
            memberCount: 3,
        })).toEqual({
            blockListIdx: '9',
            memberCount: 3,
            label: 'List #9 (shared from bitcoin list #9)',
        });
    });

    it('uses null when the pick has no finite numeric member count', () => {
        expect(sharedBlockPickState({
            actionIndex: 5,
            homeChain: 'bitcoin',
            homeListIndex: 2,
        })).toEqual({
            blockListIdx: '5',
            memberCount: null,
            label: 'List #5 (shared from bitcoin list #2)',
        });

        expect(sharedBlockPickState({
            actionIndex: 5,
            homeChain: 'bitcoin',
            homeListIndex: 2,
            memberCount: Number.POSITIVE_INFINITY,
        })?.memberCount).toBeNull();
    });

    it.each([
        ['a null action index', { actionIndex: null }],
        ['a zero action index', { actionIndex: 0 }],
        ['non-digit action-index text', { actionIndex: 'abc' }],
        ['a non-object pick', '9'],
    ])('returns null for %s', (_description, pick) => {
        expect(sharedBlockPickState(pick)).toBeNull();
    });
});
