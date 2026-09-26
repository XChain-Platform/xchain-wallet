// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Market orderbook helpers (§41.3.2).
//
// Normalises the explorer's `/orderbook` response into two sorted
// levels arrays (bids descending, asks ascending) with cumulative
// totals so the view can draw the depth bar without re-traversing.
//
// The explorer returns:
//
//   { asks: [[price, amount], …], bids: [[price, amount], …] }
//
// (or the same object wrapped in a one-element array, depending on
// the endpoint wrapper). Keep prices and sizes as decimal strings through
// sorting and cumulative totals, converting only the final bounded depth
// percentage to Number.

import {
    compareDecimalStrings,
    sumDecimalStrings,
} from '../shared/utils/amountFormat.js';

/**
 * @typedef {Object} Level
 * @property {string} price         exact decimal price for sorting
 * @property {string} displayPrice  original string (preserves precision)
 * @property {string} size          exact size at this price level
 * @property {string} displaySize   original string
 * @property {string} cumulative    cumulative size at this level or better
 */

/**
 * @typedef {Object} Orderbook
 * @property {Level[]} bids         descending by price
 * @property {Level[]} asks         ascending by price
 * @property {string} maxCumulative the larger exact cumulative amount
 */

/**
 * @param {unknown} resp
 * @returns {Orderbook}
 */
export function normalizeOrderbook(resp) {
    const raw = extractBook(resp);
    const bids = sortLevels(parseLevels(raw?.bids), 'desc');
    const asks = sortLevels(parseLevels(raw?.asks), 'asc');
    withCumulative(bids);
    withCumulative(asks);
    const bidsMax = bids.length > 0 ? bids[bids.length - 1].cumulative : '0';
    const asksMax = asks.length > 0 ? asks[asks.length - 1].cumulative : '0';
    const maxCumulative = compareDecimalStrings(bidsMax, asksMax) >= 0 ? bidsMax : asksMax;
    return { bids, asks, maxCumulative };
}

function extractBook(resp) {
    if (!resp) return null;
    if (Array.isArray(resp)) return resp[0] ?? null;
    if (typeof resp === 'object' && (resp.bids || resp.asks)) return resp;
    if (resp.data) return extractBook(resp.data);
    return null;
}

function parseLevels(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {Level[]} */
    const out = [];
    for (const row of raw) {
        const level = parseLevel(row);
        if (level) out.push(level);
    }
    return out;
}

function parseLevel(row) {
    // Shape 1: [price, amount] tuple (explorer default).
    // Shape 2: { price, amount } object (future-compat).
    let priceStr; let sizeStr;
    if (Array.isArray(row) && row.length >= 2) {
        priceStr = String(row[0]);
        sizeStr = String(row[1]);
    } else if (row && typeof row === 'object') {
        priceStr = String(row.price ?? '');
        sizeStr = String(row.amount ?? row.size ?? '');
    } else {
        return null;
    }
    if (compareDecimalStrings(priceStr, '0') !== 1) return null;
    if (compareDecimalStrings(sizeStr, '0') !== 1) return null;
    return {
        price: priceStr,
        displayPrice: priceStr,
        size: sizeStr,
        displaySize: sizeStr,
        cumulative: '0',
    };
}

function sortLevels(levels, direction) {
    const out = levels.slice();
    out.sort((a, b) => {
        const compared = compareDecimalStrings(a.price, b.price) || 0;
        return direction === 'desc' ? -compared : compared;
    });
    return out;
}

function withCumulative(levels) {
    let sum = '0';
    for (const level of levels) {
        sum = sumDecimalStrings([sum, level.size]);
        level.cumulative = sum;
    }
}
