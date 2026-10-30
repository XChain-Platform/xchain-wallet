// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A row that lands while History follows an address list shifts every later
// page, so one action arrives twice and the oldest row falls past the last
// page. Dropping the repeat leaves fewer unique rows than the stated total,
// and that list never passes as complete.

import { describe, expect, it, vi } from 'vitest';
import {
    HISTORY_MAX_PAGES,
    readAllListPages,
} from '../../../../packages/core/src/shared/utils/historyPages.js';

function row(index) {
    return { action_index: String(index), block_index: index, action: 'SEND' };
}

// Newest first: `landed` new rows above `count` older rows.
function listOf(count, landed) {
    const out = [];
    for (let i = landed - 1; i >= 0; i -= 1) out.push(row(1_000_000 + i));
    for (let i = count; i >= 1; i -= 1) out.push(row(i));
    return out;
}

/**
 * An explorer list of `count` rows where `landed` rows arrive after the first
 * page-1 read.
 */
function movingList({ count, landed, totalGrows = false }) {
    let landedNow = 0;
    let statedTotal = count;
    let pageOneReads = 0;
    return vi.fn(async (page) => {
        const p = page || 1;
        const list = listOf(count, landedNow);
        const data = list.slice((p - 1) * 100, p * 100);
        if (p === 1) statedTotal = list.length;
        const total = totalGrows ? list.length : statedTotal;
        if (p === 1) {
            pageOneReads += 1;
            // The rows land just after this page-1 read answers.
            if (pageOneReads === 1) landedNow += landed;
        }
        return { data, total };
    });
}

function uniqueCount(rows) {
    return new Set(rows.map((r) => r.action_index)).size;
}

describe('readAllListPages when rows land mid-read', () => {
    it('never returns 999 rows of a 1,000-row list after one row lands', async () => {
        const read = movingList({ count: 1000, landed: 1 });
        const { rows } = await readAllListPages(read);
        expect(uniqueCount(rows)).toBe(rows.length);
        expect(rows.length).toBeGreaterThanOrEqual(1000);
        expect(rows.map((r) => r.action_index)).toContain('1');
    });

    it('reads the list afresh after two rows land', async () => {
        const read = movingList({ count: 1000, landed: 2 });
        const { rows } = await readAllListPages(read);
        expect(uniqueCount(rows)).toBe(rows.length);
        expect(rows.map((r) => r.action_index)).toContain('1');
    });

    it('reads the list afresh when the stated total grows during the read', async () => {
        const read = movingList({ count: 1000, landed: 1, totalGrows: true });
        const { rows } = await readAllListPages(read);
        expect(rows.map((r) => r.action_index)).toContain('1');
    });

    it('refuses a list that keeps moving on the fresh read', async () => {
        // Each read sees a page 1 list, then one more row lands before the
        // later pages. The fresh read starts at a whole number of pages, so
        // the shift pushes its oldest row past the last page as well.
        const states = [[0, 1], [100, 101]];
        let reads = 0;
        const read = async (page) => {
            const p = page || 1;
            if (p === 1) reads += 1;
            const [before, after] = states[Math.min(reads, states.length) - 1];
            const list = listOf(1000, p === 1 ? before : after);
            return { data: list.slice((p - 1) * 100, p * 100), total: listOf(1000, before).length };
        };
        await expect(readAllListPages(read)).rejects.toThrow(/moved while it was read/);
        expect(reads).toBe(2);
    });

    it('refuses a shifted list whose final page also stops short', async () => {
        const list = listOf(1000, 1);
        const read = async (page) => {
            const p = page || 1;
            if (p === 1) return { data: listOf(1000, 0).slice(0, 100), total: 1000 };
            const data = list.slice((p - 1) * 100, p * 100);
            return { data: p === 10 ? data.slice(0, 99) : data, total: 1000 };
        };
        await expect(readAllListPages(read)).rejects.toThrow();
    });

    it('keeps a duplicate on a page that is not short as a complete list', async () => {
        const list = listOf(150, 0);
        const read = async (page) => ({
            data: page ? [list[99], ...list.slice(100)] : list.slice(0, 100),
            total: 150,
        });
        const { rows } = await readAllListPages(read);
        expect(rows).toHaveLength(150);
        expect(uniqueCount(rows)).toBe(150);
    });

    it('reads afresh at the page cap after a row lands', async () => {
        const count = HISTORY_MAX_PAGES * 100 * 2;
        const read = movingList({ count, landed: 1 });
        const { rows } = await readAllListPages(read);
        expect(rows).toHaveLength(HISTORY_MAX_PAGES * 100);
        expect(uniqueCount(rows)).toBe(HISTORY_MAX_PAGES * 100);
    });

    it('reuses the snapshot while the total and the head are unchanged', async () => {
        const list = listOf(250, 0);
        const read = vi.fn(async (page) => ({ data: list.slice(((page || 1) - 1) * 100, (page || 1) * 100), total: 250 }));
        const { snapshot } = await readAllListPages(read);
        expect(read).toHaveBeenCalledTimes(3);
        const again = await readAllListPages(read, snapshot);
        expect(read).toHaveBeenCalledTimes(4);
        expect(again.rows).toHaveLength(250);
    });
});
