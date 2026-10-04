// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    bindLabel,
    orderSharedLists,
    pickableSharedLists,
    platformBadgeText,
    shortOwner,
} from '../../../packages/core/src/shared/utils/sharedListRows.js';

function row(id, overrides = {}) {
    return {
        id,
        homeChain: 'bitcoin',
        homeListIndex: 1,
        type: 'token',
        bindTarget: `mirror-${id}`,
        maintainedByPlatform: false,
        ...overrides,
    };
}

describe('shared list row helpers', () => {
    it('orders platform entries first, then by chain and numeric list index', () => {
        const entries = [
            row('bitcoin-10', { homeListIndex: '10' }),
            row('litecoin-1', { homeChain: 'litecoin' }),
            row('bitcoin-9', { homeListIndex: '9' }),
            row('platform-zcash', { homeChain: 'zcash', maintainedByPlatform: true }),
            row('platform-bitcoin', { maintainedByPlatform: true }),
        ];

        expect(orderSharedLists(entries).map(({ id }) => id)).toEqual([
            'platform-bitcoin',
            'platform-zcash',
            'bitcoin-9',
            'bitcoin-10',
            'litecoin-1',
        ]);
    });

    it('returns a sorted copy without mutating the input', () => {
        const entries = Object.freeze([
            row('later', { homeListIndex: 10 }),
            row('earlier', { homeListIndex: 9 }),
        ]);

        const ordered = orderSharedLists(entries);

        expect(ordered).not.toBe(entries);
        expect(ordered.map(({ id }) => id)).toEqual(['earlier', 'later']);
        expect(entries.map(({ id }) => id)).toEqual(['later', 'earlier']);
    });

    it('picks mirrored entries of the requested type in display order', () => {
        const entries = [
            row('wrong-type', { type: 'address', maintainedByPlatform: true }),
            row('later', { homeListIndex: 10 }),
            row('unmirrored', { homeListIndex: 1, bindTarget: null }),
            row('platform', { homeChain: 'zcash', maintainedByPlatform: true }),
            row('earlier', { homeListIndex: 9 }),
        ];

        expect(pickableSharedLists(entries, 'token').map(({ id }) => id)).toEqual([
            'platform',
            'earlier',
            'later',
        ]);
    });

    it('shortens long owners and preserves shorter text', () => {
        expect(shortOwner('123456789012345')).toBe('123456...2345');
        expect(shortOwner('12345678901234')).toBe('12345678901234');
        expect(shortOwner('owner')).toBe('owner');
        expect(shortOwner(null)).toBe('');
    });

    it('labels only platform-maintained entries', () => {
        expect(platformBadgeText({ maintainedByPlatform: true })).toBe('Maintained by XChain Platform');
        expect(platformBadgeText({ maintainedByPlatform: false })).toBeNull();
        expect(platformBadgeText({})).toBeNull();
    });

    it('shows the bind target or the unmirrored label', () => {
        expect(bindLabel({ bindTarget: 'bitcoin:7' })).toBe('bitcoin:7');
        expect(bindLabel({ bindTarget: 12 })).toBe('12');
        expect(bindLabel({ bindTarget: null })).toBe('not yet mirrored here');
        expect(bindLabel({})).toBe('not yet mirrored here');
    });
});
