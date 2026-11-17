// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wide Home's detail panel draws the value of ONE asset's holding over time:
// the wallet's balance of that asset at each point times its price then. It is
// that asset's share of Home's portfolio chart, taken from the same valuation
// (PortfolioChart's prepareValuation and valueSeriesFor) over the same rows
// and the same one history read, so the panel reads nothing of its own and
// the shares summed are the wallet's line at every point.

import { createContext } from 'react';
import { assetKeyOf } from '../utils/portfolioValueHistory.js';
import { balanceSeriesFor, valueSeriesFor } from '../utils/portfolioValuation.js';

/**
 * @typedef {object} HoldingValueSource
 * @property {ReturnType<typeof import('../utils/portfolioValuation.js').prepareValuation>} prepared
 * @property {Record<string, any>} priceMap
 * @property {string | null | undefined} seedId
 * @property {boolean} synthesize
 * @property {((want: { source: string, sinceMs: number }) => void) | null} [requestRange]
 */

/** @type {import('react').Context<HoldingValueSource | null>} */
export const HoldingValueContext = createContext(/** @type {HoldingValueSource | null} */ (null));

/**
 * One asset's holding value over a range, or why there is none.
 *
 * @param {HoldingValueSource | null} source
 * @param {object} args
 * @param {string} args.chainId
 * @param {string} args.tick
 * @param {{ id: string, points: number, source: 'hourly' | 'daily' }} args.range
 * @param {any} [args.priceEntry]   the page's own price entry for the coin (with its daily series)
 * @param {{ tick: string, chainId: string, price: number } | null} [args.unit]
 * @param {number} [args.nowMs]
 * @returns {{ series: number[] | null, noPriceHistory: boolean } | null}  null when the asset is not in the wallet's rows
 */
export function holdingValueSeries(source, { chainId, tick, range, priceEntry = null, unit = null, nowMs }) {
    if (!source?.prepared) return null;
    const key = assetKeyOf(chainId, tick);
    if (!source.prepared.assets.some((asset) => asset.key === key)) return null;
    const priceMap = priceEntry
        ? { ...source.priceMap, [chainId]: { ...(source.priceMap?.[chainId] || {}), ...priceEntry } }
        : source.priceMap;
    const result = valueSeriesFor(source.prepared, {
        priceMap, range, seedId: source.seedId, synthesize: source.synthesize, unit, nowMs,
    });
    // The panel's range asks the wallet's reads for its span (older history,
    // daily prices) as Home's chart does; the answer lands as a later update.
    if (typeof source.requestRange === 'function' && result.grid.length > 0) {
        source.requestRange({ source: range.source, sinceMs: result.grid[0] });
    }
    const values = result.byAsset.get(key) || null;
    // A holding with no price at any earlier point has no history to draw.
    const priced = Array.isArray(values) && result.pricedKeys.includes(key);
    return { series: priced ? values : null, noPriceHistory: !priced };
}

/** One asset's balance history in its own unit, from the same Home history read. */
export function holdingBalanceSeries(source, { chainId, tick, range, nowMs }) {
    if (!source?.prepared) return null;
    const key = assetKeyOf(chainId, tick);
    if (!source.prepared.assets.some((asset) => asset.key === key)) return null;
    const result = balanceSeriesFor(source.prepared, { chainId, tick, range, nowMs });
    if (typeof source.requestRange === 'function' && result.grid.length > 0) {
        source.requestRange({ source: range.source, sinceMs: result.grid[0] });
    }
    return { series: result.series, noPriceHistory: false };
}
