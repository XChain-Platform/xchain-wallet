// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The portfolio valuation Home's chart and wide Home's detail panel share:
// the wallet's rows and history turned into assets and balance changes, then
// valued over one chart range (portfolioValueHistory.js holds the arithmetic).
// It lives apart from PortfolioChart.jsx so a caller can value a holding
// without drawing the chart.

import { synthesizeTokenChart } from '../components/Sparkline.jsx';
import { fiatValue } from '../components/BalanceList.jsx';
import {
    addressScope,
    assetKeyOf,
    buildValueSeries,
    chartGridTimes,
    priceToleranceFor,
    readDeltas,
    replayBalances,
    timedPriceSeries,
    tokenFiatSeries,
    walletAssetDeltas,
} from './portfolioValueHistory.js';

const MONTHS_BACK = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

// The daily series has one point at 00:00 UTC per day. A window opens on a
// calendar day of the device's own calendar (1 January for YTD), and starts
// at that day's 00:00 UTC point, so the first day is kept in every timezone.
// A month back from the 31st lands on the earlier month's last day.
export function rangeWindowStart(rangeId, now) {
    if (rangeId === 'all') return -Infinity;
    const at = new Date(now);
    if (!Number.isFinite(at.getTime())) return Number.NaN;
    const year = at.getFullYear();
    let month = at.getMonth();
    let day = at.getDate();
    if (rangeId === 'ytd') {
        month = 0;
        day = 1;
    } else if (MONTHS_BACK[rangeId]) {
        month -= MONTHS_BACK[rangeId];
        day = Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    } else {
        return Number.NaN;
    }
    return Date.UTC(year, month, day);
}

/** One asset's replayed whole-unit balance on the portfolio chart grid. */
export function balanceSeriesFor(prepared, { chainId, tick, range, nowMs = Date.now() }) {
    const asset = prepared?.assets?.find((candidate) => candidate.key === assetKeyOf(chainId, tick));
    if (!asset || !(range?.points >= 2)) return { series: null, grid: [] };
    const grid = chartGridTimes(range, nowMs, { windowStart: rangeWindowStart });
    const { balances } = replayBalances({
        currentAtomic: asset.currentAtomic,
        deltas: prepared.deltasByKey?.get(asset.key) || [],
        grid,
        coverageStartMs: Number.isFinite(asset.coverageStartMs)
            ? Math.max(asset.coverageStartMs, prepared.coverageStartMs)
            : prepared.coverageStartMs,
    });
    const scale = 10 ** asset.divisibility;
    return { series: balances.map((balance) => Number(balance) / scale), grid };
}

/**
 * The part of the valuation that does not depend on the range or the prices:
 * one asset per row (a row the wallet cannot price now sits out, as it does
 * in the headline), the addresses the rows count, and every balance change
 * the history rows state. Home's chart and wide Home's detail panel share it,
 * so both read the one history the wallet loaded and nothing else.
 *
 * @param {object} args
 * @param {Array<any>} args.rows
 * @param {{ entries: any[], addressesByChain: Record<string, any[]> | null, coverageStartMs: number } | null} [args.history]
 * @param {Record<string, { address: string }> | null} [args.activeByChain]
 */
export function prepareValuation({ rows, history = null, activeByChain = null }) {
    /** @type {Map<string, any>} */
    const assets = new Map();
    const names = new Map();
    for (const row of rows || []) {
        if (!row || typeof row.chainId !== 'string' || !row.chainId) continue;
        const current = fiatValueOf(row);
        if (current === null || !Number.isFinite(current) || current < 0) continue;
        let atomic;
        try {
            atomic = BigInt(row.quantity ?? 0);
        } catch {
            continue;
        }
        if (atomic < 0n) continue;
        const key = assetKeyOf(row.chainId, row.tick);
        const held = assets.get(key);
        if (held) {
            held.currentAtomic += atomic;
            held.currentFiat += current;
            continue;
        }
        const divisibility = Number.isInteger(Number(row.divisibility)) ? Number(row.divisibility) : 8;
        assets.set(key, {
            key,
            chainId: row.chainId,
            tick: String(row.tick || ''),
            kind: row.kind === 'native' ? 'native' : 'token',
            currentAtomic: atomic,
            divisibility,
            currentFiat: current,
            rate: Number.isFinite(Number(row.fiatRate)) ? Number(row.fiatRate) : null,
        });
        names.set(key, String(row.displayName || row.name || row.coin || row.tick || '').trim());
    }
    const scope = addressScope(history?.addressesByChain, activeByChain);
    let deltasByKey;
    if (history?.reads instanceof Map) {
        // The batch reads (useWalletHistory): every token action's effects
        // and every native transaction of the wallet's addresses.
        const read = readDeltas(history.reads, { scope, assets });
        deltasByKey = read.deltasByKey;
        for (const [key, ms] of read.coverageByKey) {
            const asset = assets.get(key);
            if (asset) asset.coverageStartMs = ms;
        }
    } else {
        // History rows handed in directly (a caller with rows of its own).
        const entries = Array.isArray(history?.entries) ? history.entries : [];
        // Without a saved address list the rows' own addresses are the wallet's.
        for (const entry of entries) {
            if (!entry?.chainId || scope.has(entry.chainId) || !entry.address) continue;
            scope.set(entry.chainId, new Set(entries
                .filter((e) => e?.chainId === entry.chainId && e.address)
                .map((e) => String(e.address).toLowerCase())));
        }
        deltasByKey = walletAssetDeltas(entries, { scope, assets });
    }
    return {
        assets: [...assets.values()],
        names,
        deltasByKey,
        coverageStartMs: Number.isFinite(history?.coverageStartMs) ? history.coverageStartMs : -Infinity,
        tokenPrices: history?.tokenPrices instanceof Map ? history.tokenPrices : null,
    };
}

/**
 * A token's fiat price series for a range from the wallet's price-history
 * reads, or null when the token has none.
 *
 * @param {Map<string, any> | null} tokenPrices   useWalletHistory's, keyed `${chainId}|${interval}`
 * @param {{ chainId: string, tick: string }} asset
 * @param {{ source: string }} range
 * @param {Array<[number, number]> | null} coinSeries  the chain's coin price series for the range
 */
function tokenPriceSeries(tokenPrices, asset, range, coinSeries) {
    if (!(tokenPrices instanceof Map)) return null;
    const held = tokenPrices.get(`${asset.chainId}|${range?.source === 'hourly' ? 'hour' : 'day'}`);
    if (!held) return null;
    return tokenFiatSeries(held.byTick?.get(String(asset.tick).toUpperCase()), {
        coinOracle: held.coinOracle,
        coinSeries,
        toleranceMs: priceToleranceFor(range),
    });
}

/**
 * The wallet's value series for one range, and each asset's share of it.
 *
 * `seedId` is the wallet's own id for a real wallet and a constant for a demo
 * one; it only ever feeds the synthesized walk's seed. A demo asset without a
 * recorded price gets the deterministic walk Sparkline.jsx draws, as a price
 * that ends at its current rate, so the demo line is the same on every open.
 *
 * @param {ReturnType<typeof prepareValuation>} prepared
 * @param {object} opts
 * @param {Record<string, any>} opts.priceMap        native price entries by chain
 * @param {{ id: string, points: number, source: 'hourly' | 'daily' }} opts.range
 * @param {string | null | undefined} opts.seedId
 * @param {boolean} opts.synthesize
 * @param {{ tick: string, chainId: string, price: number } | null} [opts.unit]
 * @param {number} [opts.nowMs]
 */
export function valueSeriesFor(prepared, { priceMap, range, seedId, synthesize, unit = null, nowMs = Date.now() }) {
    const empty = { series: null, byAsset: new Map(), missingTokenKeys: [], missingCoinKeys: [], clampedKeys: [], grid: [] };
    if (!prepared || prepared.assets.length === 0 || !(range?.points >= 2)) return empty;
    const recorded = new Map();
    let allStartMs = Infinity;
    for (const asset of prepared.assets) {
        if (asset.kind !== 'native') continue;
        const series = timedPriceSeries(priceMap?.[asset.chainId], range, nowMs);
        if (!series) continue;
        recorded.set(asset.key, series);
        allStartMs = Math.min(allStartMs, series[0][0]);
    }
    const grid = chartGridTimes(range, nowMs, {
        windowStart: rangeWindowStart,
        allStartMs: Number.isFinite(allStartMs) ? allStartMs : undefined,
    });
    const synthWalk = (key, endValue) => {
        const { sparkline } = synthesizeTokenChart(key, endValue, range.points);
        return sparkline ? grid.map((ms, i) => [ms, sparkline[i]]) : null;
    };
    const coinSeriesFor = (chainId) => {
        const native = prepared.assets.find((a) => a.chainId === chainId && a.kind === 'native');
        return (native && recorded.get(native.key)) || timedPriceSeries(priceMap?.[chainId], range, nowMs);
    };
    const assets = prepared.assets.map((asset) => {
        let priceSeries = recorded.get(asset.key) || null;
        if (!priceSeries && !synthesize && asset.kind !== 'native') {
            priceSeries = tokenPriceSeries(prepared.tokenPrices, asset, range, coinSeriesFor(asset.chainId));
        }
        if (!priceSeries && synthesize && asset.currentFiat > 0) {
            // The walk is the asset's value; divided by the holding it is a price.
            const units = Number(asset.currentAtomic) / 10 ** asset.divisibility;
            const walkKey = `${seedId || '_'}|${asset.chainId}|${asset.kind === 'native' ? 'native' : asset.tick}|${range.id}|${asset.currentFiat.toFixed(2)}`;
            const walk = units > 0 ? synthWalk(walkKey, asset.currentFiat) : null;
            priceSeries = walk ? walk.map(([ms, value]) => [ms, value / units]) : null;
        }
        return { ...asset, priceSeries };
    });
    let unitInput = null;
    if (unit && Number(unit.price) > 0) {
        // The unit coin's price is the same series its own holding is valued
        // at, so a wallet holding only that coin reads flat in it.
        const own = assets.find((asset) => asset.key === assetKeyOf(unit.chainId, unit.tick));
        const unitSeries = own?.priceSeries
            || timedPriceSeries(priceMap?.[unit.chainId], range, nowMs)
            || (synthesize ? synthWalk(`${seedId || '_'}|unit|${unit.chainId}|${range.id}`, Number(unit.price)) : null);
        unitInput = { priceSeries: unitSeries, currentPrice: Number(unit.price) };
    }
    const result = buildValueSeries({
        assets,
        deltasByKey: synthesize ? new Map() : prepared.deltasByKey,
        grid,
        range,
        coverageStartMs: synthesize ? -Infinity : prepared.coverageStartMs,
        unit: unitInput,
    });
    return { ...result, grid };
}

// The row's value now, or null when it has no price.
function fiatValueOf(row) {
    if (!row) return null;
    const exact = fiatValue(row.quantity, row.divisibility, row.fiatRate);
    return exact === null ? null : Number(exact);
}
