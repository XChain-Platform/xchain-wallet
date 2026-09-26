// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Market chart bucketing helpers (§41.3.1).
//
// The explorer's getMarketHistory endpoint returns individual order-
// match events (one row per fill). It is NOT pre-aggregated into
// OHLC candles. The wallet aggregates client-side so the user can
// flip between periods (1m / 5m / 15m / 1h / 4h / 1d / 1w) without
// a round-trip per period change.
//
// Market history rows carry projected `price`, `amount`, and `type`
// fields. Raw give/get rows remain accepted for older explorers.
//
// Bucket timestamps: seconds since epoch, floored to the period
// boundary. Matches missing a parsable timestamp are skipped.

import { normalizeMarketHistoryRow } from './history_rows.js';

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
        const parsed = normalizeMarketHistoryRow(row, tick1, tick2);
        if (!parsed) continue;
        const { price, amount: volume, timestamp } = parsed;
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
