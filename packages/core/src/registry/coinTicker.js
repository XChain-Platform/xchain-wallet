// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Canonical coin -> native ticker map (§9). One source of truth for the
// per-chain symbol used in default address labels and any UI that shows a
// coin's ticker. New chains add an entry here; unmapped coins fall back to
// the uppercased coin id so nothing renders blank.

/** @type {Record<string, string>} */
const COIN_TICKER = {
    bitcoin: 'BTC',
    litecoin: 'LTC',
    dogecoin: 'DOGE',
};

/**
 * @param {string} coin   a descriptor's `coin`, e.g. 'bitcoin'
 * @returns {string}      native ticker, e.g. 'BTC'; uppercased coin id for
 *                        chains not in the map
 */
export function tickerForCoin(coin) {
    return COIN_TICKER[coin] || String(coin || '').toUpperCase();
}
