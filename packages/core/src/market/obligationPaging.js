// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Paging for the explorer's COINPAY obligation reads.
//
// The explorer answers newest-first and caps a page at its list limit, so an
// address with more obligations than one page holds (as payer or payee, in any
// status) pushes its oldest obligations off page one. An old obligation that is
// still pending is exactly the one whose deadline is nearest, so every consumer
// needs the rows past page one, not only the newest slice.

import { extractObligationRows } from './obligationStatus.js';

/**
 * Most further pages one read follows. Each page is one more request, so the
 * cap bounds what a deep history costs per poll; a read the cap stops carries
 * `truncated: true` instead of passing for complete.
 */
export const OBLIGATION_PAGE_CAP = 10;

function rowKey(row) {
    return String(row?.action_index ?? row?.actionIndex ?? '');
}

/** Rows the explorer serves per page of a block's order matches. */
export const MATCH_PAGE_ROWS = 100;

/**
 * Most pages one block read follows. A block holding more matches than this
 * reads as unavailable rather than as a short list.
 */
export const MATCH_BLOCK_PAGE_CAP = 50;

/**
 * Every order match in one block. The match list pages by position and has no
 * cursor, newest first, and a mined block does not change, so its pages are
 * stable. The first read is the plain one; later pages are read only when its
 * `total` shows rows were left behind. A page that fails or comes back the
 * wrong size throws, so the caller treats the block as unavailable rather than
 * searching a list with a hole in it.
 *
 * @param {{ getOrderMatches: (query: string, type: string, opts?: object) => Promise<any> }} sdk
 * @param {number | string} blockIndex
 * @returns {Promise<any[]>}
 */
export async function readBlockOrderMatches(sdk, blockIndex) {
    const query = String(blockIndex);
    const first = await sdk.getOrderMatches(query, 'block');
    const rows = [...extractObligationRows(first)];
    const total = Number(first?.total);
    if (!first || Array.isArray(first) || !Number.isFinite(total) || total <= rows.length) return rows;
    const pages = Math.ceil(total / MATCH_PAGE_ROWS);
    if (rows.length !== MATCH_PAGE_ROWS || pages > MATCH_BLOCK_PAGE_CAP) {
        throw new Error(`block ${query} order matches cannot be read whole: ${rows.length} of ${total} rows on page 1`);
    }
    for (let page = 2; page <= pages; page += 1) {
        const body = await sdk.getOrderMatches(query, 'block', { page, limit: MATCH_PAGE_ROWS });
        const pageRows = extractObligationRows(body);
        const expected = page === pages ? total - (pages - 1) * MATCH_PAGE_ROWS : MATCH_PAGE_ROWS;
        if (pageRows.length !== expected) {
            throw new Error(`block ${query} order matches page ${page} of ${pages} returned ${pageRows.length} rows, expected ${expected}`);
        }
        rows.push(...pageRows);
    }
    return rows;
}

/**
 * Continue a first-page reply down the explorer's `next_before` cursor until
 * its `total` is covered, the page cap is reached or a page adds nothing.
 *
 * A reply that is not an envelope with a numeric `total` (a bare array, a mock
 * answering a list) is returned untouched, and so is a first page that already
 * holds every row, so the common address costs no extra request.
 *
 * @param {any} first  the first page as the explorer served it
 * @param {(opts: { before: string }) => Promise<any>} readPage  reads the page below a cursor
 * @param {number} [cap]
 * @returns {Promise<any>} the first envelope with every collected row under `data`;
 *   `truncated: true` when rows were still missing when the walk stopped
 */
export async function followObligationPages(first, readPage, cap = OBLIGATION_PAGE_CAP) {
    if (!first || typeof first !== 'object' || Array.isArray(first)) return first;
    const total = Number(first.total);
    const rows = [...extractObligationRows(first)];
    if (!Number.isFinite(total) || rows.length === 0 || rows.length >= total) return first;
    const seen = new Set(rows.map(rowKey));
    let cursor = first.next_before;
    for (let pages = 0; pages < cap && rows.length < total; pages += 1) {
        if (cursor === undefined || cursor === null || cursor === '') break;
        const page = await readPage({ before: String(cursor) });
        const fresh = extractObligationRows(page).filter((r) => !seen.has(rowKey(r)));
        if (fresh.length === 0) break;
        for (const r of fresh) { seen.add(rowKey(r)); rows.push(r); }
        const next = page && !Array.isArray(page) ? page.next_before : undefined;
        if (String(next) === String(cursor)) break;
        cursor = next;
    }
    return { ...first, data: rows, truncated: rows.length < total };
}
