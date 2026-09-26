// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Dispenser price text shared by every screen that lists dispensers. A
// fiat-priced dispenser stores GET_AMOUNT 0 by protocol convention (Mode A
// validator-priced and Mode B oracle-priced), so printing that field as the
// price would read "1 MGRTEST per 0 DOGE", a price of nothing.

import { multiplyAmounts } from '../../market/orderMath.js';

export const DISPENSER_PRICE_STALE_MESSAGE = 'Not selling right now: no price in the last 24 hours';

export function isDispenserPriceStale(row) {
    return row?.price_stale === true;
}

// Thousands separators on the integer part of a decimal string, exact
// (no float round-trip): '4750' -> '4,750', '0.005' stays '0.005'.
export function formatDecimal(v) {
    if (v == null || v === '') return '?';
    const s = String(v);
    const [int, frac] = s.split('.');
    if (!/^\d+$/.test(int)) return s;
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return frac != null ? `${grouped}.${frac}` : grouped;
}

function shortAddress(addr) {
    if (!addr || typeof addr !== 'string') return '?';
    return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

// A coin-paid dispenser priced in fiat rather than a fixed coin amount:
// no GET_TICK (token-paid dispensers set one and always carry a real
// GET_AMOUNT), a GET_COIN, and GET_AMOUNT 0.
export function isFiatPricedRow(row) {
    return !row?.get_tick && Boolean(row?.get_coin) && !(Number(row?.get_amount) > 0);
}

// Whether this row's price needs an oracle feed lookup. Mode B only: Mode A
// has no oracle, and carries a fixed FIAT_AMOUNT where the lane serves one.
export function isOraclePricedRow(row) {
    return isFiatPricedRow(row) && Boolean(row?.oracle_address) && row?.fiat_amount == null;
}

/**
 * The fill price a Mode B row's oracle publishes, as the tail of a rate
 * label. The list lanes carry no FIAT_CODE, so without one the feed is
 * matched by GIVE_TICK alone and an oracle quoting that tick in two
 * currencies stays unresolved rather than guessed. A quote prices one token,
 * so it is multiplied by GIVE_AMOUNT.
 *
 * @param {any} row
 * @param {any[] | null | undefined} feeds  this oracle's feeds: undefined
 *   while the read is in flight, null when the wallet cannot read one at all
 * @returns {string}
 */
export function oraclePriceLabel(row, feeds) {
    const addr = shortAddress(row.oracle_address);
    const unresolved = `an oracle-set price (oracle ${addr}; open the dispenser for the price)`;
    if (feeds === null) return unresolved;
    if (feeds === undefined) return `an oracle-set price (checking ${addr}…)`;
    const tick = String(row.give_tick || '').toUpperCase();
    const fiat = String(row.fiat_code || '').toUpperCase();
    const matches = feeds.filter((f) => f
        && String(f.tick || '').toUpperCase() === tick
        && (!fiat || String(f.fiat || '').toUpperCase() === fiat));
    if (matches.length !== 1) return unresolved;
    const [feed] = matches;
    // `live`, never `pending`: a maturing quote prices nothing yet.
    if (!feed.live?.value) {
        return `${feed.fiat || '?'} (oracle ${addr}): no current price, stale`;
    }
    const fillPrice = multiplyAmounts(String(feed.live.value), String(row.give_amount || '1')) ?? feed.live.value;
    return `${formatDecimal(fillPrice)} ${feed.fiat || '?'} (oracle ${addr})`;
}

/**
 * "GIVE per PRICE" for one dispenser row from any explorer lane.
 *
 * @param {any} row
 * @param {any[] | null | undefined} [oracleFeeds]  see oraclePriceLabel
 * @returns {string}
 */
export function dispenserRateLabel(row, oracleFeeds) {
    if (isDispenserPriceStale(row)) return DISPENSER_PRICE_STALE_MESSAGE;
    const give = `${formatDecimal(row.give_amount)} ${row.give_tick || '?'}`;
    if (isFiatPricedRow(row)) {
        if (isOraclePricedRow(row)) return `${give} per ${oraclePriceLabel(row, oracleFeeds)}`;
        return row.fiat_amount != null && row.fiat_code
            ? `${give} per ${formatDecimal(row.fiat_amount)} ${row.fiat_code}`
            : `${give}, priced in fiat: open the dispenser for the current price`;
    }
    const payAsset = row.get_tick || row.get_coin || '?';
    return `${give} per ${formatDecimal(row.get_amount)} ${payAsset}`;
}

/**
 * Whether an offer row is valid and still open. List rows keep action
 * validity in `status`; a served lifecycle field overrides that fallback.
 *
 * @param {any} row
 * @returns {boolean}
 */
export function isOpenOffer(row) {
    if (!row || typeof row !== 'object') return false;
    const validity = String(row.status || '').toLowerCase();
    if (validity && validity !== 'valid' && validity !== 'open') return false;
    const lifecycle = row.current_status || row.order_status || row.swap_status || row.state?.status;
    return !lifecycle || String(lifecycle).toLowerCase() === 'open';
}

/**
 * Whether a dispenser list row is an open offer selling `tick`. The create
 * row's status stays 'valid' after a close, so the lifecycle (current_status,
 * or a detail read's state) decides; a row carrying neither falls back to the
 * create status. The token lanes also return dispensers priced IN the tick,
 * which buy it rather than sell it, so a named tick must be the GIVE_TICK.
 *
 * @param {any} row
 * @param {string} [tick]  a ticker name; a ^N reference skips the GIVE_TICK test
 * @returns {boolean}
 */
export function isOpenDispenserSelling(row, tick) {
    if (!isOpenOffer(row)) return false;
    const want = String(tick || '').toUpperCase();
    if (!want || want.startsWith('^') || !row.give_tick) return true;
    return String(row.give_tick).toUpperCase() === want;
}
