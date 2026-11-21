// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { activityCheckTargets } from '../../../packages/core/src/notifications/activityCheckConfig.js';

describe('activityCheckTargets', () => {
    it('maps explorer address reads and their native balance paths', () => {
        expect(activityCheckTargets([
            { address: 'bc1qwallet', explorerBaseUrl: 'https://btc.example/api' },
            { address: 'space /?#%', explorerBaseUrl: 'https://ltc.example/api///' },
        ])).toEqual([
            {
                address: 'bc1qwallet',
                url: 'https://btc.example/api/address/bc1qwallet',
                confirmedPath: 'balances.confirmed',
                pendingPath: 'balances.pending',
            },
            {
                address: 'space /?#%',
                url: 'https://ltc.example/api/address/space%20%2F%3F%23%25',
                confirmedPath: 'balances.confirmed',
                pendingPath: 'balances.pending',
            },
        ]);
    });

    it('keeps each address and explorer base pair once in first-seen order', () => {
        const first = { address: 'same', explorerBaseUrl: 'https://one.example' };
        const second = { address: 'same', explorerBaseUrl: 'https://two.example' };
        const third = { address: 'other', explorerBaseUrl: 'https://one.example' };
        const entries = [first, second, first, third, second];

        const targets = activityCheckTargets(entries);

        expect(targets.map(({ address, url }) => ({ address, url }))).toEqual([
            { address: 'same', url: 'https://one.example/address/same' },
            { address: 'same', url: 'https://two.example/address/same' },
            { address: 'other', url: 'https://one.example/address/other' },
        ]);
        expect(entries).toEqual([first, second, first, third, second]);
    });
});
