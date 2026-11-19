// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Market page's search (its header filter): one text box that narrows
// the open tab's rows by price, amount or transaction id. Thousands
// separators and spaces are ignored on both sides, so "1,250" finds 1250.

function searchable(value) {
    return String(value).toLowerCase().replace(/[,\s]/g, '');
}

/**
 * Whether a row matches the search text. An empty search matches every row.
 *
 * @param {string | null | undefined} query
 * @param {Array<unknown>} values   the row's price, amount and transaction id, in any spelling
 */
export function rowMatchesQuery(query, values) {
    const q = searchable(query ?? '');
    if (!q) return true;
    return values.some((value) => value != null && value !== '' && searchable(value).includes(q));
}
