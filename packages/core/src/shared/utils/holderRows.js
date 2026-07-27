// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One normalizer for the holder list the explorer returns.
//
// `sdk.getHolders(tick)` hands back the raw explorer envelope
// `{ tick, supply, decimals, total, data: [{ address, amount }] }`, never a
// bare array. DividendForm and AirdropForm each grew a private extractor for
// that; ManageToken did not, and its `Array.isArray(resp) ? resp : []` fell
// through to empty, so a token whose only holder is the wallet itself showed
// "Holders 0" and "No holders yet" (D-76). Same envelope-vs-array split as
// D-47's inbox reader.

/**
 * @param {any} resp  the response from `messaging.getHoldersForToken`
 * @returns {Array<any>}  holder rows, or [] when the response carries none
 */
export function extractHolderRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.holders)) return resp.holders;
    return [];
}
