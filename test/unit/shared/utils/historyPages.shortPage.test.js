// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// An explorer that fails, drops or serves a stale page while History follows
// an address list must never yield a list the page treats as complete.

import { describe, expect, it } from 'vitest';
import { readAllListPages } from '../../../../packages/core/src/shared/utils/historyPages.js';

const TOTAL = 250;

function row(index) {
    return { action_index: index, block_index: 1000 - index, action: 'SEND' };
}

function page(n) {
    const start = (n - 1) * 100;
    return Array.from({ length: Math.min(100, TOTAL - start) }, (_, i) => row(start + i + 1));
}

function reader(overrides = {}) {
    return async (pageNo) => {
        const n = pageNo || 1;
        if (overrides[n]) return overrides[n]();
        return { data: page(n), total: TOTAL };
    };
}

describe('readAllListPages under a failing explorer', () => {
    it('reads every row when every page answers', async () => {
        const { rows } = await readAllListPages(reader());
        expect(rows).toHaveLength(TOTAL);
    });

    it('rejects when a later page returns 500', async () => {
        const read = reader({ 3: () => Promise.reject(new Error('HTTP 500')) });
        await expect(readAllListPages(read)).rejects.toThrow('HTTP 500');
    });

    it('rejects when the connection drops mid-stream', async () => {
        const read = reader({ 2: () => Promise.reject(new TypeError('network connection lost')) });
        await expect(readAllListPages(read)).rejects.toThrow('network connection lost');
    });

    it('rejects an unreadable later page', async () => {
        const read = reader({ 3: async () => ({ error: 'indexer offline' }) });
        await expect(readAllListPages(read)).rejects.toThrow(/unreadable page/);
    });

    // A short or stale later page never passes as a complete list.
    it('refuses a later page that comes back empty below the stated total', async () => {
        const read = reader({ 3: async () => ({ data: [], total: TOTAL }) });
        await expect(readAllListPages(read)).rejects.toThrow();
    });

    it('refuses a stale later page that repeats an earlier page', async () => {
        const read = reader({ 3: async () => ({ data: page(2), total: TOTAL }) });
        await expect(readAllListPages(read)).rejects.toThrow();
    });
});
