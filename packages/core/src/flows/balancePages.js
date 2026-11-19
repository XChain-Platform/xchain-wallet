// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * The explorer serves `/balances/` in pages and its `total` counts every row.
 * One request therefore reads a prefix of an address that holds more token rows
 * than the page cap. This reader takes the first page the caller already has and
 * fetches the rest, so the token list is whole before it is shaped.
 *
 * It never invents completeness: a later page that fails, comes back short or
 * malformed, or a ledger past the page ceiling returns the first page untouched,
 * and the caller's own `total` check then marks the token half unavailable.
 */

// Most later pages one address may cost, so a huge ledger is not a request storm.
export const BALANCES_MAX_PAGES = 10;

function pageRows(page) {
    return page && typeof page === 'object' && Array.isArray(page.data) ? page.data : null;
}

/**
 * @param {{ sdk: { getBalances: Function }, address: string, first: unknown, opts?: object }} args
 * @returns {Promise<unknown>} `first`, or a copy of it whose `data` holds every row
 */
export async function completeBalancePages({ sdk, address, first, opts }) {
    const rows = pageRows(first);
    if (!rows || rows.length === 0) return first;
    const total = Number(/** @type {any} */ (first).total);
    if (!Number.isSafeInteger(total) || total <= rows.length) return first;
    const limit = rows.length;
    const pages = Math.ceil(total / limit);
    if (pages > BALANCES_MAX_PAGES) return first;

    // Keyed by tick so a row that shifted onto the next page while the walk ran
    // is not counted twice; a row that shifted away leaves the list short, and a
    // short list is reported as partial by the caller.
    const byTick = new Map();
    const take = (list) => list.forEach((row, index) => byTick.set(row?.tick ?? `row-${byTick.size}-${index}`, row));
    take(rows);
    try {
        for (let page = 2; page <= pages; page += 1) {
            const body = await sdk.getBalances(address, { ...(opts || {}), page, limit });
            const more = pageRows(body);
            if (!more || more.length === 0) return first;
            take(more);
        }
    } catch {
        return first;
    }
    return { ...(/** @type {any} */ (first)), data: Array.from(byTick.values()) };
}
