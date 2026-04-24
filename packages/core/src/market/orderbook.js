// Market orderbook helpers — §41.3.2.
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
// the endpoint wrapper). Prices come back as strings to preserve
// precision; this helper coerces to Number for comparison but
// preserves the original string in `displayPrice` for render.

/**
 * @typedef {Object} Level
 * @property {number} price         numeric price for sort / depth math
 * @property {string} displayPrice  original string (preserves precision)
 * @property {number} size          size at this price level
 * @property {string} displaySize   original string
 * @property {number} cumulative    cumulative size at this level or better
 */

/**
 * @typedef {Object} Orderbook
 * @property {Level[]} bids         descending by price
 * @property {Level[]} asks         ascending by price
 * @property {number} maxCumulative  the larger of bids.lastCumulative / asks.lastCumulative; callers divide per-row cumulative / maxCumulative for the depth bar width
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
    const bidsMax = bids.length > 0 ? bids[bids.length - 1].cumulative : 0;
    const asksMax = asks.length > 0 ? asks[asks.length - 1].cumulative : 0;
    return { bids, asks, maxCumulative: Math.max(bidsMax, asksMax, 0) };
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
    const price = Number(priceStr);
    const size = Number(sizeStr);
    if (!Number.isFinite(price) || price <= 0) return null;
    if (!Number.isFinite(size) || size <= 0) return null;
    return {
        price,
        displayPrice: priceStr,
        size,
        displaySize: sizeStr,
        cumulative: 0,
    };
}

function sortLevels(levels, direction) {
    const out = levels.slice();
    out.sort((a, b) => direction === 'desc' ? b.price - a.price : a.price - b.price);
    return out;
}

function withCumulative(levels) {
    let sum = 0;
    for (const level of levels) {
        sum += level.size;
        level.cumulative = sum;
    }
}
