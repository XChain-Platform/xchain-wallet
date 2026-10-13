// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Keep the first row for each stable identity. Rows without an identity stay
 * visible because dropping two unknown rows would hide potentially distinct
 * activity.
 *
 * @param {any[]} rows
 * @param {(row: any, index: number) => unknown} identityOf
 * @returns {any[]}
 */
export function uniqueRows(rows, identityOf) {
    const seen = new Set();
    return (Array.isArray(rows) ? rows : []).filter((row, index) => {
        const identity = identityOf(row, index);
        if (identity == null || identity === '') return true;
        const key = String(identity);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Describe an explorer page without depending on one response envelope. The
 * row-count fallback keeps older explorers loadable when they omit `total`.
 *
 * @param {any} response
 * @param {any[]} rows
 * @param {number} page
 * @param {number} pageSize
 */
export function explorerPage(response, rows, page, pageSize) {
    const candidates = [response?.total, response?.recordsTotal, response?.count];
    const reported = candidates
        .filter((value) => value != null && value !== '')
        .map(Number)
        .find((value) => Number.isFinite(value) && value >= 0);
    const total = reported ?? null;
    return {
        total,
        hasMore: total == null
            ? rows.length >= pageSize
            : page * pageSize < total,
    };
}

/** @param {any} row */
export function actionRowIdentity(row) {
    return row?.action_index
        ?? row?.actionIndex
        ?? row?.tx_hash
        ?? row?.txid
        ?? row?.id
        ?? null;
}
