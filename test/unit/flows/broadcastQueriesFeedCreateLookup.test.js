// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// latestFeedCreateForAddress pages past a first page with no feed-create.

import { describe, it, expect, vi } from 'vitest';
import { latestFeedCreateForAddress } from '../../../packages/core/src/flows/broadcastQueries.js';

const other = { action_format: 3, status: 'valid', block_index: 900 };
const feed = { action_format: 2, status: 'valid', block_index: 100, action_index: 7 };

function messagingWith(pages) {
    return { getBroadcastsForAddress: vi.fn(async ({ opts }) => pages[opts.page - 1] ?? []) };
}

describe('latestFeedCreateForAddress', () => {
    it('finds a feed-create on page 2', async () => {
        const messaging = messagingWith([[other], [feed]]);
        const got = await latestFeedCreateForAddress({ messaging, chainId: 'c', address: 'a' });
        expect(got).toBe(feed);
        expect(messaging.getBroadcastsForAddress).toHaveBeenCalledTimes(2);
        expect(messaging.getBroadcastsForAddress).toHaveBeenLastCalledWith({ chainId: 'c', address: 'a', opts: { page: 2 } });
    });

    it('stops on an empty page and returns null', async () => {
        const messaging = messagingWith([[other], []]);
        expect(await latestFeedCreateForAddress({ messaging, chainId: 'c', address: 'a' })).toBeNull();
        expect(messaging.getBroadcastsForAddress).toHaveBeenCalledTimes(2);
    });

    it('respects maxPages and ignores invalid or non-v2 rows', async () => {
        const messaging = messagingWith([[other], [{ ...feed, status: 'invalid' }], [feed]]);
        expect(await latestFeedCreateForAddress({ messaging, chainId: 'c', address: 'a', maxPages: 2 })).toBeNull();
        expect(messaging.getBroadcastsForAddress).toHaveBeenCalledTimes(2);
    });
});
