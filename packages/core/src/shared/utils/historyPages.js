// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer answers an address list with one page of at most 100 rows plus
// the `total` it holds. History lists every row of the wallet, so it follows
// the pages until `total` is covered. A page-1 read alone shows the newest 100
// actions of an address and hides the rest with nothing to say so.
//
// The 20 second refresh beat re-reads page 1 only. While `total` and the head
// of the list are unchanged the older pages cannot have changed either, so the
// rows read earlier are reused; a new, dropped or reordered row changes one of
// the two and sends the read back through every page.

/** Pages followed per address and chain: 10,000 rows at 100 a page. */
export const HISTORY_MAX_PAGES = 100;
const PAGE_CONCURRENCY = 4;

function rowsOf(response) {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    if (Array.isArray(response.data)) return response.data;
    if (Array.isArray(response.rows)) return response.rows;
    return [];
}

function rowIdentity(row) {
    if (!row || typeof row !== 'object') return null;
    const index = row.action_index ?? row.actionIndex;
    return index == null || index === '' ? null : String(index);
}

function headSignature(rows) {
    return rows.map((row) => `${rowIdentity(row)}:${row?.block_index ?? row?.blockIndex ?? ''}`).join('|');
}

/**
 * Read every page of one address list.
 *
 * @param {(page: number | null) => Promise<any>} read  one explorer read; `null` is the first page
 * @param {{ total: number, head: string, rows: any[] } | null} [previous]
 *        the snapshot a completed earlier read of the same list returned
 * @returns {Promise<{ rows: any[], snapshot: { total: number, head: string, rows: any[] } | null }>}
 *          `snapshot` is null when the list was not paged (no usable total)
 */
export async function readAllListPages(read, previous = null) {
    const first = await read(null);
    const firstRows = rowsOf(first);
    const total = Number(first?.total);
    if (Array.isArray(first) || !Number.isFinite(total) || firstRows.length === 0 || firstRows.length >= total) {
        return { rows: firstRows, snapshot: null };
    }
    const head = headSignature(firstRows);
    if (previous && previous.total === total && previous.head === head) {
        const rows = [...firstRows, ...previous.rows.slice(firstRows.length)];
        return { rows, snapshot: { total, head, rows } };
    }
    const pageSize = firstRows.length;
    const pages = Math.min(Math.ceil(total / pageSize), HISTORY_MAX_PAGES);
    // The rows the followed pages must cover: the stated total, or the page cap.
    const expected = Math.min(total, pages * pageSize);
    const shortPage = () => new Error(`The explorer sent a short page of ${total} rows.`);
    // A row that lands while the pages are read shifts the later pages by one,
    // so the same action can arrive on two pages; it is kept once.
    const seen = new Set();
    const unique = [];
    let duplicates = 0;
    const keep = (row) => {
        const id = rowIdentity(row);
        if (id !== null) {
            if (seen.has(id)) {
                duplicates += 1;
                return false;
            }
            seen.add(id);
        }
        unique.push(row);
        return true;
    };
    firstRows.forEach(keep);
    let rowsRead = firstRows.length;
    for (let start = 2; start <= pages; start += PAGE_CONCURRENCY) {
        const batch = [];
        for (let page = start; page < start + PAGE_CONCURRENCY && page <= pages; page += 1) {
            batch.push(read(page));
        }
        for (const response of await Promise.all(batch)) {
            if (!response || (!Array.isArray(response) && !Array.isArray(response.data))) {
                throw new Error(`The explorer sent an unreadable page of ${total} rows.`);
            }
            const pageRows = rowsOf(response);
            // An empty page below the stated total ends the list early.
            if (pageRows.length === 0 && rowsRead < expected) throw shortPage();
            rowsRead += pageRows.length;
            // An insert shifts a page by the rows it adds, so a page that adds
            // no new row at all repeats an earlier page: the explorer is stale.
            let added = 0;
            for (const row of pageRows) if (keep(row)) added += 1;
            if (added === 0 && pageRows.length > 0) throw shortPage();
        }
    }
    // Each duplicate a shift explains pushes one row past the last page, so
    // the list may fall short by at most the duplicates removed.
    if (unique.length < expected - duplicates) throw shortPage();
    return { rows: unique, snapshot: { total, head, rows: unique } };
}
