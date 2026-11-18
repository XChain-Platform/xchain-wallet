// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer serves 100 bets or markets a page, newest first. A screen that
// needs every row reads down the `next_before` cursor with `allPages`, and a
// read left short says so instead of passing for complete.

import { describe, it, expect, vi } from 'vitest';
import { betFeedsForChain, betsForQuery } from '../../../packages/core/src/flows/betQueries.js';
import { OBLIGATION_PAGE_CAP } from '../../../packages/core/src/market/obligationPaging.js';

const registry = (sdk) => ({ get: vi.fn(() => sdk) });
const rowsFrom = (hi, count) => Array.from({ length: count }, (_, i) => ({ action_index: String(hi - i) }));

// Pages of `size` rows over `total` newest-first rows; the cursor is the oldest index served.
function pager(total, size) {
    return vi.fn(async (_query, _type, opts = {}) => {
        const below = opts.before === undefined ? total + 1 : Number(opts.before);
        const data = rowsFrom(below - 1, Math.min(size, below - 1));
        return { data, total, next_before: data.length ? data[data.length - 1].action_index : undefined };
    });
}

const FLOWS = [
    { name: 'betsForQuery', flow: betsForQuery, method: 'getBets', query: 'addr', type: 'address' },
    { name: 'betFeedsForChain', flow: betFeedsForChain, method: 'getBetFeeds', query: 'addr', type: 'source' },
];

describe.each(FLOWS)('$name allPages', ({ flow, method, query, type }) => {
    it('follows next_before until the total is covered and merges the rows', async () => {
        const read = pager(250, 100);
        const resp = await flow({ sdkRegistry: registry({ [method]: read }), chainId: 'c', query, type, opts: { limit: 100 }, allPages: true });
        expect(resp.data).toHaveLength(250);
        expect(new Set(resp.data.map((r) => r.action_index)).size).toBe(250);
        expect(resp.truncated).toBe(false);
        expect(read).toHaveBeenCalledTimes(3);
        expect(read.mock.calls[1][2]).toEqual({ limit: 100, before: '151' });
        expect(read.mock.calls[2][2]).toEqual({ limit: 100, before: '51' });
    });

    it('makes exactly one read without allPages even when the total exceeds the page', async () => {
        const read = pager(250, 100);
        const resp = await flow({ sdkRegistry: registry({ [method]: read }), chainId: 'c', query, type, opts: { limit: 100 } });
        expect(read).toHaveBeenCalledTimes(1);
        expect(resp.data).toHaveLength(100);
        expect(resp.total).toBe(250);
    });

    it('returns the rows already read, flagged truncated, when a later page fails', async () => {
        const good = pager(250, 100);
        const read = vi.fn(async (q, t, opts) => {
            if (opts?.before !== undefined) throw new Error('explorer down');
            return good(q, t, opts);
        });
        const resp = await flow({ sdkRegistry: registry({ [method]: read }), chainId: 'c', query, type, opts: { limit: 100 }, allPages: true });
        expect(resp.data).toHaveLength(100);
        expect(resp.truncated).toBe(true);
    });

    it('still rejects when the first page fails', async () => {
        const read = vi.fn(async () => { throw new Error('explorer down'); });
        await expect(flow({ sdkRegistry: registry({ [method]: read }), chainId: 'c', query, type, allPages: true }))
            .rejects.toThrow('explorer down');
    });

    it('flags truncated when the page cap stops the walk', async () => {
        const total = 100 * (OBLIGATION_PAGE_CAP + 3);
        const read = pager(total, 100);
        const resp = await flow({ sdkRegistry: registry({ [method]: read }), chainId: 'c', query, type, opts: { limit: 100 }, allPages: true });
        expect(resp.truncated).toBe(true);
        expect(resp.data).toHaveLength(100 * (OBLIGATION_PAGE_CAP + 1));
        expect(read).toHaveBeenCalledTimes(OBLIGATION_PAGE_CAP + 1);
    });
});
