// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Market chart bucketing helpers — §41.3.1.
//
// The explorer's getMarketHistory endpoint returns individual order-
// match events (one row per fill) — it is NOT pre-aggregated into
// OHLC candles. The wallet aggregates client-side so the user can
// flip between periods (1m / 5m / 15m / 1h / 4h / 1d / 1w) without
// a round-trip per period change.
//
// Price orientation: a match row carries `give_amount`, `get_amount`,
// `give_tick`, `get_tick`. For the pair (tick1 / tick2) we want the
// price of tick1 denominated in tick2. When the match's `give_tick`
// equals tick1, price = get_amount / give_amount. When reversed,
// price = give_amount / get_amount. Amounts that can't be parsed are
// skipped.
//
// Bucket timestamps: seconds since epoch, floored to the period
// boundary. Matches missing a parsable timestamp are skipped.

export const PERIODS = /** @type {const} */ ([
    { id: '1m', label: '1m', seconds: 60 },
    { id: '5m', label: '5m', seconds: 300 },
    { id: '15m', label: '15m', seconds: 900 },
    { id: '1h', label: '1h', seconds: 3600 },
    { id: '4h', label: '4h', seconds: 14400 },
    { id: '1d', label: '1d', seconds: 86400 },
    { id: '1w', label: '1w', seconds: 604800 },
    { id: '30d', label: '30d', seconds: 2592000 },
    { id: '60d', label: '60d', seconds: 5184000 },
    { id: '90d', label: '90d', seconds: 7776000 },
]);

export const DEFAULT_PERIOD_ID = '1h';

/**
 * @typedef {Object} Candle
 * @property {number} time        unix seconds at the bucket start
 * @property {number} open
 * @property {number} high
 * @property {number} low
 * @property {number} close
 * @property {number} volume      sum of tick1 volume traded in the bucket
 */

/**
 * Bucket a list of match rows into OHLCV candles for the given period.
 *
 * @param {Array<any>} rows
 * @param {{ tick1: string, tick2: string, periodSeconds: number }} opts
 * @returns {Candle[]}   sorted ascending by `time`
 */
export function bucketizeMatches(rows, { tick1, tick2, periodSeconds }) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    if (!tick1 || !tick2) return [];
    if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) return [];

    /** @type {Map<number, { open: number, high: number, low: number, close: number, volume: number, firstTs: number, lastTs: number }>} */
    const buckets = new Map();
    for (const row of rows) {
        const parsed = parseRow(row, tick1, tick2);
        if (!parsed) continue;
        const { price, volume, timestamp } = parsed;
        const bucketStart = Math.floor(timestamp / periodSeconds) * periodSeconds;
        const existing = buckets.get(bucketStart);
        if (!existing) {
            buckets.set(bucketStart, {
                open: price,
                high: price,
                low: price,
                close: price,
                volume,
                firstTs: timestamp,
                lastTs: timestamp,
            });
        } else {
            if (price > existing.high) existing.high = price;
            if (price < existing.low) existing.low = price;
            if (timestamp < existing.firstTs) {
                existing.firstTs = timestamp;
                existing.open = price;
            }
            if (timestamp > existing.lastTs) {
                existing.lastTs = timestamp;
                existing.close = price;
            }
            existing.volume += volume;
        }
    }
    const out = [];
    for (const [time, b] of buckets) {
        out.push({
            time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
        });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
}

function parseRow(row, tick1, tick2) {
    if (!row || typeof row !== 'object') return null;
    const giveTick = row.give_tick || row.giveTick;
    const getTick = row.get_tick || row.getTick;
    if (!giveTick || !getTick) return null;
    const giveAmt = Number(row.give_amount ?? row.giveAmount);
    const getAmt = Number(row.get_amount ?? row.getAmount);
    if (!Number.isFinite(giveAmt) || giveAmt <= 0) return null;
    if (!Number.isFinite(getAmt) || getAmt <= 0) return null;
    // Extract timestamp — explorer serialises as `timestamp` (unix
    // seconds) or `block_time`; fall back to `created_at` ISO strings.
    let ts = null;
    if (Number.isFinite(Number(row.timestamp))) ts = Number(row.timestamp);
    else if (Number.isFinite(Number(row.block_time))) ts = Number(row.block_time);
    else if (row.created_at) {
        const ms = Date.parse(row.created_at);
        if (Number.isFinite(ms)) ts = Math.floor(ms / 1000);
    }
    if (!Number.isFinite(ts)) return null;
    // Price orientation.
    let price; let volume;
    if (giveTick === tick1 && getTick === tick2) {
        price = getAmt / giveAmt;
        volume = giveAmt;
    } else if (giveTick === tick2 && getTick === tick1) {
        price = giveAmt / getAmt;
        volume = getAmt;
    } else {
        return null;
    }
    if (!Number.isFinite(price) || price <= 0) return null;
    return { price, volume, timestamp: ts };
}
