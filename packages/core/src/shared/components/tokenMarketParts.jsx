// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The parts the Marketplace page (MarketActivity.jsx) builds its cheapest-first
// Offers list and card price from. Pure helpers over rows the page has
// already read; nothing here reads the network.

import { flows as flowsLib } from '@xchain-wallet/core';
import { compareDecimalStrings, divideDecimalStrings } from '../utils/amountFormat.js';
import { isDispenserPriceStale, isOraclePricedRow, offerAmounts } from '../utils/dispenserPricing.js';

/** A dispenser's tag icon, a drop (the shared icon set has none). */
export function DispenserGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-xc-icon="">
            <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
        </svg>
    );
}

/** The first ticker-like value among a row's alias fields, always a string. */
export function tickText(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value !== '') return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
}

/** quote / base as an exact decimal, or null when either side is not a positive amount. */
function unitPrice(quoteQty, baseQty) {
    if (compareDecimalStrings(String(quoteQty ?? ''), '0') !== 1) return null;
    if (compareDecimalStrings(String(baseQty ?? ''), '0') !== 1) return null;
    return divideDecimalStrings(String(quoteQty), String(baseQty), 18);
}

/**
 * One Offers entry for an open dispenser selling `tick`. A stale,
 * fiat-priced or oracle-priced dispenser has no coin price per token here,
 * so its unit is null and it sorts after every priced offer.
 */
function dispenserEntry({ chainId, row }, tick) {
    const coinPriced = !isDispenserPriceStale(row)
        && !isOraclePricedRow(row)
        && !(row.fiat_amount != null && row.fiat_code)
        && Number(row.get_amount) > 0;
    const quote = tickText(row.get_tick, row.get_coin).toUpperCase();
    return {
        kind: 'dispenser',
        action: 'buy',
        chainId,
        row,
        quote: coinPriced ? quote : null,
        unit: coinPriced ? unitPrice(row.get_amount, row.give_amount) : null,
        available: flowsLib.dispenserLiveState(row).giveRemaining ?? null,
        tick,
    };
}

/**
 * One Offers entry for an open DEX order. An order giving `tick` is
 * an ask (you buy from it); one asking for `tick` is a bid (you sell into it).
 * Its price and amount come from what is still open on it.
 */
function orderEntry({ chainId, row }, tick) {
    const giveTick = tickText(row.give_tick, row.give_coin, row.giveTick, row.giveCoin).toUpperCase();
    const getTick = tickText(row.get_tick, row.get_coin, row.getTick, row.getCoin).toUpperCase();
    const { give, get } = offerAmounts(row);
    const ask = giveTick === tick;
    return {
        kind: 'order',
        action: ask ? 'buy' : 'sell',
        chainId,
        row,
        quote: (ask ? getTick : giveTick) || null,
        unit: ask ? unitPrice(get, give) : unitPrice(give, get),
        available: ask ? give : get,
        quoteQty: ask ? get : give,
        tick,
    };
}

/**
 * Open dispensers and open DEX orders as one list, cheapest first.
 * Prices in different coins cannot be compared, so the list groups by the
 * coin paid (in the order of `chainOrder`, the page's preferred chain first)
 * and sorts each group by price per token. Offers with no coin price go last.
 *
 * @param {Array<{chainId: string, row: any}>} offers     open dispensers
 * @param {Array<{chainId: string, row: any}>} dexOrders  open DEX orders
 * @param {string} tick                                   upper-case ticker of the market
 * @param {string[]} chainOrder                           chain ids, preferred first
 */
export function mergedOffers(offers, dexOrders, tick, chainOrder) {
    const entries = [
        ...(offers || []).map((o) => dispenserEntry(o, tick)),
        ...(dexOrders || []).map((o) => orderEntry(o, tick)),
    ];
    const rankOf = (chainId) => {
        const index = chainOrder.indexOf(chainId);
        return index === -1 ? chainOrder.length : index;
    };
    // Each coin's group sits where its first chain sits in the page's order.
    const quoteRank = new Map();
    for (const e of entries) {
        if (!e.quote || e.unit === null) continue;
        const rank = rankOf(e.chainId);
        if (!quoteRank.has(e.quote) || rank < quoteRank.get(e.quote)) quoteRank.set(e.quote, rank);
    }
    return entries
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => {
            const ap = a.entry.unit !== null && a.entry.quote ? 0 : 1;
            const bp = b.entry.unit !== null && b.entry.quote ? 0 : 1;
            if (ap !== bp) return ap - bp;
            if (ap === 0) {
                const qa = quoteRank.get(a.entry.quote);
                const qb = quoteRank.get(b.entry.quote);
                if (qa !== qb) return qa - qb;
                if (a.entry.quote !== b.entry.quote) return a.entry.quote < b.entry.quote ? -1 : 1;
                const byPrice = compareDecimalStrings(a.entry.unit, b.entry.unit);
                if (byPrice) return byPrice;
                if (a.entry.kind !== b.entry.kind) return a.entry.kind === 'dispenser' ? -1 : 1;
            }
            return a.index - b.index;
        })
        .map(({ entry }) => entry);
}

/**
 * Every filled trade the page has read (dispenses and completed DEX
 * swaps) as { quote, unit, timestamp } points, oldest first, for the card's
 * price, move and chart.
 *
 * @param {Array<{chainId: string, row: any}>} sales
 * @param {Array<{chainId: string, row: any}>} swaps
 * @param {string} tick
 */
export function tradePoints(sales, swaps, tick) {
    const points = [];
    for (const { chainId, row } of sales || []) {
        const sold = (tickText(row.give_tick) || tick).toUpperCase();
        const quote = tickText(row.get_tick, row.get_coin).toUpperCase();
        const unit = sold === tick ? unitPrice(row.get_amount, row.give_amount) : null;
        const timestamp = Number(row.timestamp || row.block_time || 0);
        if (unit !== null && quote && timestamp > 0) points.push({ chainId, quote, unit, timestamp });
    }
    for (const { chainId, row } of swaps || []) {
        const giveTick = tickText(row.give_tick, row.give_coin, row.giveTick, row.giveCoin).toUpperCase();
        const getTick = tickText(row.get_tick, row.get_coin, row.getTick, row.getCoin).toUpperCase();
        const giveQty = row.give_amount ?? row.giveAmount ?? null;
        const getQty = row.get_amount ?? row.getAmount ?? null;
        const sell = giveTick === tick;
        const quote = sell ? getTick : giveTick;
        const unit = sell ? unitPrice(getQty, giveQty) : (getTick === tick ? unitPrice(giveQty, getQty) : null);
        const timestamp = Number(row.timestamp || row.block_time || 0);
        if (unit !== null && quote && timestamp > 0) points.push({ chainId, quote, unit, timestamp });
    }
    return points.sort((a, b) => a.timestamp - b.timestamp);
}
