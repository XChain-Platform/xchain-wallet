// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's value over time (operator ruling 2026-11-16): at each chart
// point, the balance of every asset the wallet held THEN times that asset's
// fiat price THEN. Home's portfolio chart sums every asset; wide Home's detail
// panel draws one asset's share, and the two come from the same function, so
// the asset lines summed are the wallet line at every point.
//
// Balances replay backward from what the wallet holds now through the rows
// of its own history, so only the rows newer than a point move it and the
// last point is today's holding exactly. Prices are timestamped series (the
// CoinGecko hourly sparkline for 24h and 1W, the daily series for longer
// ranges) read at each point's own time. An asset without a price at a point
// is left out of that point and named, so the card can say so; the last point
// is always the row's own value now, so the line ends on the headline total.
//
// Nothing here reads anything: every input is handed in, so the chart and the
// detail panel add no read of their own beyond the wallet's batch reads
// (useWalletHistory.js: token history with per-address effects, native coin
// history, and token price series), whose changes readDeltas() turns into the
// per-asset steps the replay walks back through.

import { entryBalanceDelta } from './assetBalanceSeries.js';
import { activityRowTick } from './activityAmount.js';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** How far before a series' first point a sample may still read that point. */
const HOURLY_TOLERANCE_MS = 90 * 60 * 1000;
const DAILY_TOLERANCE_MS = 36 * HOUR_MS;

/** Key every per-asset map uses. */
export function assetKeyOf(chainId, tick) {
    return `${chainId || ''}:${String(tick || '').toUpperCase()}`;
}

function entryMs(entry) {
    const value = Number(entry?.timestamp);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value < 1e12 ? value * 1000 : value;
}

function lower(value) {
    return typeof value === 'string' ? value.toLowerCase() : '';
}

function firstAddress(raw, keys) {
    for (const key of keys) {
        const value = raw?.[key];
        if (typeof value === 'string' && value) return value.toLowerCase();
    }
    return '';
}

/** A whole-unit decimal ("1.5") as base units, or null. */
function wholeToAtomic(text, divisibility) {
    const s = String(text ?? '').trim();
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const [whole, frac = ''] = s.split('.');
    const places = Math.max(0, divisibility | 0);
    try {
        return BigInt(whole + frac.slice(0, places).padEnd(places, '0'));
    } catch {
        return null;
    }
}

/**
 * The wallet's own addresses per chain that a balance row counts, lowercased.
 * With `activeByChain` (Home's rows hold only each chain's active address)
 * the scope is that one address; otherwise every address the wallet lists.
 *
 * @param {Record<string, Array<{ address?: string } | string>> | null | undefined} addressesByChain
 * @param {Record<string, { address: string }> | null | undefined} [activeByChain]
 * @returns {Map<string, Set<string>>}
 */
export function addressScope(addressesByChain, activeByChain = null) {
    const scope = new Map();
    const chains = new Set([
        ...Object.keys(addressesByChain || {}),
        ...Object.keys(activeByChain || {}),
    ]);
    for (const chainId of chains) {
        const active = lower(activeByChain?.[chainId]?.address);
        if (active) {
            scope.set(chainId, new Set([active]));
            continue;
        }
        const list = Array.isArray(addressesByChain?.[chainId]) ? addressesByChain[chainId] : [];
        const set = new Set();
        for (const item of list) {
            const address = lower(typeof item === 'string' ? item : item?.address);
            if (address) set.add(address);
        }
        if (set.size > 0) scope.set(chainId, set);
    }
    return scope;
}

/**
 * Every confirmed balance change the wallet's history rows state, per asset,
 * newest first. Each action counts once however many own addresses read it,
 * and only addresses in `scope` count, so a move between two counted
 * addresses nets to zero and a move to an uncounted one leaves the total.
 * Pending rows are left out: the balance a row shows now does not hold them
 * yet either, except a confirmed one.
 *
 * Only rows whose effect the record states move a balance (a SEND, MINT,
 * ISSUE or DESTROY of the asset; see assetBalanceSeries.js). Native coin
 * transfers are not in any history feed this wallet reads, so a coin's line
 * moves only on the rows that name its ticker.
 *
 * @param {any[] | null | undefined} entries      normalized history entries (historyRow.js)
 * @param {object} ctx
 * @param {Map<string, Set<string>>} ctx.scope     addressScope()
 * @param {Map<string, { chainId: string, tick: string, divisibility: number }>} ctx.assets  keyed by assetKeyOf
 * @returns {Map<string, Array<{ ms: number, delta: bigint }>>}
 */
export function walletAssetDeltas(entries, { scope, assets }) {
    const out = new Map();
    if (!Array.isArray(entries) || !(assets instanceof Map) || assets.size === 0) return out;
    const seen = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || entry.pending) continue;
        const chainId = entry.chainId;
        const own = scope?.get(chainId);
        if (!own || own.size === 0) continue;
        const raw = entry.raw || {};
        const status = String(raw.status ?? '').toLowerCase();
        if (status && !status.startsWith('valid')) continue;
        const key = assetKeyOf(chainId, activityRowTick(entry));
        const asset = assets.get(key);
        if (!asset) continue;
        const ms = entryMs(entry);
        if (ms === null) continue;
        const id = `${chainId}:${entry.actionIndex ?? raw.action_index ?? ''}:${key}`;
        if (seen.has(id)) continue;
        const action = String(entry.action || '').toUpperCase();
        let delta = 0n;
        if (action === 'SEND') {
            const atomic = wholeToAtomic(raw.amount ?? raw.quantity, asset.divisibility);
            if (atomic === null) continue;
            const source = firstAddress(raw, ['source', 'SOURCE']) || lower(entry.source);
            const destination = firstAddress(raw, ['destination', 'DESTINATION']);
            const fetchedFor = lower(entry.address);
            // A row with no destination was read for the address it reached.
            const reached = destination || (source && source !== fetchedFor ? fetchedFor : '');
            if (own.has(source)) delta -= atomic;
            if (own.has(reached)) delta += atomic;
        } else {
            // The issuer's own mint, issue or destroy: counted only when that
            // address is one the row counts.
            const actor = firstAddress(raw, ['source', 'SOURCE']) || lower(entry.address);
            if (!own.has(actor)) continue;
            delta = entryBalanceDelta(entry, { tick: asset.tick, divisibility: asset.divisibility, walletAddresses: own });
        }
        seen.add(id);
        if (delta === 0n) continue;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push({ ms, delta });
    }
    for (const list of out.values()) list.sort((a, b) => b.ms - a.ms);
    return out;
}

/**
 * The balance at each grid time, replayed backward from the balance held now:
 * balance(t) = now - (every change after t). Before `coverageStartMs` (the
 * oldest row loaded, when the loaded history is not the whole history) the
 * balance is held at the oldest value known rather than guessed. A replay that
 * would go below zero means a change the rows do not state; it reads as zero
 * and is reported.
 *
 * @param {object} args
 * @param {bigint} args.currentAtomic
 * @param {Array<{ ms: number, delta: bigint }>} [args.deltas]  newest first
 * @param {number[]} args.grid                                  ascending ms
 * @param {number} [args.coverageStartMs]                       -Infinity when the history is complete
 * @returns {{ balances: bigint[], clamped: boolean }}
 */
export function replayBalances({ currentAtomic, deltas = [], grid, coverageStartMs = -Infinity }) {
    const balances = new Array(grid.length);
    let clamped = false;
    let k = 0;
    let running = currentAtomic;
    for (let i = grid.length - 1; i >= 0; i -= 1) {
        const at = Math.max(grid[i], coverageStartMs);
        while (k < deltas.length && deltas[k].ms > at) {
            running -= deltas[k].delta;
            k += 1;
        }
        if (running < 0n) {
            clamped = true;
            balances[i] = 0n;
        } else {
            balances[i] = running;
        }
    }
    return { balances, clamped };
}

/**
 * The times a range's points stand for, oldest first. 24h and 1W are hourly
 * points ending now (the sparkline's own spacing); the daily ranges open on
 * the portfolio chart's calendar rule and space their points evenly to now.
 * All opens at `allStartMs` (the oldest price or row known).
 *
 * @param {{ id: string, points: number, source: 'hourly' | 'daily' }} range
 * @param {number} nowMs
 * @param {{ windowStart?: (rangeId: string, nowMs: number) => number, allStartMs?: number }} [opts]
 * @returns {number[]}
 */
export function chartGridTimes(range, nowMs, { windowStart, allStartMs } = {}) {
    const n = Math.max(2, range?.points | 0);
    const grid = new Array(n);
    if (range?.source === 'hourly') {
        for (let i = 0; i < n; i += 1) grid[i] = nowMs - (n - 1 - i) * HOUR_MS;
        return grid;
    }
    let start = range?.id === 'all'
        ? allStartMs
        : (typeof windowStart === 'function' ? windowStart(range?.id, nowMs) : Number.NaN);
    if (!Number.isFinite(start) || start >= nowMs) start = nowMs - 365 * DAY_MS;
    for (let i = 0; i < n; i += 1) grid[i] = start + ((nowMs - start) * i) / (n - 1);
    grid[n - 1] = nowMs;
    return grid;
}

/**
 * A native price entry as a timestamped series for a range. The hourly
 * sparkline carries no times, so its last sample is taken as now and each
 * earlier one an hour before; the daily series carries its own. The entry's
 * current price, when it has one, is the series' point at now.
 *
 * @param {any} entry     a getNativePricesRequest price entry
 * @param {{ source: 'hourly' | 'daily' }} range
 * @param {number} nowMs
 * @returns {Array<[number, number]> | null}
 */
export function timedPriceSeries(entry, range, nowMs) {
    const out = [];
    if (range?.source === 'hourly') {
        const prices = Array.isArray(entry?.sparkline)
            ? entry.sparkline.filter((p) => Number.isFinite(p) && p > 0)
            : [];
        // One sample is a price, not a history.
        if (prices.length < 2) return null;
        for (let i = 0; i < prices.length; i += 1) {
            out.push([nowMs - (prices.length - 1 - i) * HOUR_MS, prices[i]]);
        }
        return out;
    }
    if (!Array.isArray(entry?.historyDaily)) return null;
    for (const point of entry.historyDaily) {
        if (!Array.isArray(point)) continue;
        const [ms, price] = point;
        if (Number.isFinite(ms) && Number.isFinite(price) && price > 0 && ms <= nowMs) out.push([ms, price]);
    }
    if (out.length < 2) return null;
    out.sort((a, b) => a[0] - b[0]);
    const current = Number(entry?.priceFiat);
    if (Number.isFinite(current) && current > 0 && out[out.length - 1][0] < nowMs) out.push([nowMs, current]);
    return out;
}

/**
 * The price at `ms`, interpolated between the two samples around it. After
 * the last sample it is the last; before the first it is the first only within
 * `toleranceMs`, else unknown (null).
 *
 * @param {Array<[number, number]> | null | undefined} series  ascending
 * @param {number} ms
 * @param {number} [toleranceMs]
 * @returns {number | null}
 */
export function priceAt(series, ms, toleranceMs = 0) {
    if (!Array.isArray(series) || series.length === 0) return null;
    const first = series[0];
    if (ms <= first[0]) return first[0] - ms <= toleranceMs ? first[1] : null;
    const last = series[series.length - 1];
    if (ms >= last[0]) return last[1];
    let lo = 0;
    let hi = series.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (series[mid][0] <= ms) lo = mid; else hi = mid;
    }
    const [t0, p0] = series[lo];
    const [t1, p1] = series[hi];
    return t1 === t0 ? p1 : p0 + ((p1 - p0) * (ms - t0)) / (t1 - t0);
}

function toleranceFor(range) {
    return range?.source === 'hourly' ? HOURLY_TOLERANCE_MS : DAILY_TOLERANCE_MS;
}

function atomicToUnits(atomic, divisibility) {
    const div = Number.isInteger(divisibility) && divisibility >= 0 ? divisibility : 0;
    if (div === 0) return Number(atomic);
    const scale = 10n ** BigInt(div);
    const whole = atomic / scale;
    const frac = atomic % scale;
    return Number(whole) + Number(frac) / Number(scale);
}

/**
 * @typedef {object} ValuedAsset
 * @property {string} key                 assetKeyOf(chainId, tick)
 * @property {'native' | 'token'} kind
 * @property {bigint} currentAtomic       balance held now, base units
 * @property {number} divisibility
 * @property {number | null} currentFiat  the row's value now (its fiatValue), or null when unpriced
 * @property {number | null} [rate]       the row's fiat rate now, per whole unit
 * @property {Array<[number, number]> | null} priceSeries  fiat per whole unit over time, or null
 */

/**
 * One asset's value at each grid point: its replayed balance times its price
 * at that point, the last point its value now. A point with no price leaves
 * the asset out (0) and marks it missing. With `unit` set the values are in
 * that coin instead (each point divided by the coin's price at that point).
 *
 * The price series is calibrated to the row's own rate: its point at now
 * reads the rate the headline uses, so a gap between two price sources does
 * not jump the line's last step.
 *
 * @param {ValuedAsset} asset
 * @param {object} ctx
 * @param {number[]} ctx.grid
 * @param {{ source: string }} ctx.range
 * @param {Array<{ ms: number, delta: bigint }>} [ctx.deltas]
 * @param {number} [ctx.coverageStartMs]
 * @param {number[] | null} [ctx.unitPrices]   the coin unit's price at each grid point
 * @returns {{ values: number[], missing: boolean, priced: boolean, clamped: boolean }}
 */
export function assetValueSeries(asset, { grid, range, deltas = [], coverageStartMs = -Infinity, unitPrices = null }) {
    const n = grid.length;
    const values = new Array(n).fill(0);
    const { balances, clamped } = replayBalances({
        currentAtomic: asset.currentAtomic, deltas, grid, coverageStartMs,
    });
    const tolerance = toleranceFor(range);
    const series = asset.priceSeries;
    const nowMs = grid[n - 1];
    const seriesNow = priceAt(series, nowMs, tolerance);
    const calibrate = Number.isFinite(asset.rate) && asset.rate > 0 && seriesNow > 0
        ? asset.rate / seriesNow
        : 1;
    let missing = false;
    // Priced: the asset has a price at some earlier point, whatever it held
    // then, so a holding that arrived today still draws on a priced line.
    let priced = false;
    for (let i = 0; i < n - 1; i += 1) {
        const price = priceAt(series, grid[i], tolerance);
        if (price !== null) priced = true;
        const units = atomicToUnits(balances[i], asset.divisibility);
        if (units === 0) continue;
        if (price === null) {
            missing = true;
            continue;
        }
        values[i] = units * price * calibrate;
    }
    const last = Number.isFinite(asset.currentFiat) ? asset.currentFiat : 0;
    values[n - 1] = last;
    if (Array.isArray(unitPrices)) {
        for (let i = 0; i < n; i += 1) values[i] = unitPrices[i] > 0 ? values[i] / unitPrices[i] : 0;
    }
    return { values, missing, priced, clamped };
}

/**
 * The unit coin's price at each grid point, its last point the headline's
 * own price, or null when the coin has no usable price now.
 *
 * @param {{ priceSeries: Array<[number, number]> | null, currentPrice: number }} unit
 * @param {number[]} grid
 * @param {{ source: string }} range
 * @returns {number[] | null}
 */
export function unitPricesFor(unit, grid, range) {
    const current = Number(unit?.currentPrice);
    if (!Number.isFinite(current) || current <= 0) return null;
    const tolerance = toleranceFor(range);
    const nowMs = grid[grid.length - 1];
    const seriesNow = priceAt(unit.priceSeries, nowMs, tolerance);
    const calibrate = seriesNow > 0 ? current / seriesNow : 1;
    let firstKnown = null;
    const out = grid.map((ms) => {
        const price = priceAt(unit.priceSeries, ms, tolerance);
        if (price === null) return null;
        if (firstKnown === null) firstKnown = price * calibrate;
        return price * calibrate;
    });
    // Before the coin's first price the earliest one known stands in, so a
    // point is never divided by nothing.
    for (let i = 0; i < out.length; i += 1) if (out[i] === null) out[i] = firstKnown ?? current;
    out[out.length - 1] = current;
    return out;
}

/**
 * The wallet's value series and each asset's share of it.
 *
 * @param {object} args
 * @param {ValuedAsset[]} args.assets
 * @param {Map<string, Array<{ ms: number, delta: bigint }>>} args.deltasByKey
 * @param {number[]} args.grid
 * @param {{ source: string }} args.range
 * @param {number} [args.coverageStartMs]
 * @param {{ priceSeries: Array<[number, number]> | null, currentPrice: number } | null} [args.unit]
 * @returns {{
 *   series: number[] | null,
 *   byAsset: Map<string, number[]>,
 *   missingTokenKeys: string[],
 *   missingCoinKeys: string[],
 *   clampedKeys: string[],
 *   pricedKeys: string[],
 * }}
 */
export function buildValueSeries({ assets, deltasByKey, grid, range, coverageStartMs = -Infinity, unit = null }) {
    const n = grid.length;
    const byAsset = new Map();
    const missingTokenKeys = [];
    const missingCoinKeys = [];
    const clampedKeys = [];
    const pricedKeys = [];
    const unitPrices = unit ? unitPricesFor(unit, grid, range) : null;
    const sums = new Array(n).fill(0);
    let anyPriced = false;
    for (const asset of assets || []) {
        if (!asset || typeof asset.currentAtomic !== 'bigint') continue;
        const result = assetValueSeries(asset, {
            grid,
            range,
            deltas: deltasByKey?.get(asset.key) || [],
            // A chain whose walk stopped short holds its assets flat before
            // the oldest change it read.
            coverageStartMs: Number.isFinite(asset.coverageStartMs)
                ? Math.max(asset.coverageStartMs, coverageStartMs)
                : coverageStartMs,
            unitPrices,
        });
        byAsset.set(asset.key, result.values);
        for (let i = 0; i < n; i += 1) sums[i] += result.values[i];
        if (result.priced) {
            anyPriced = true;
            pricedKeys.push(asset.key);
        }
        if (result.clamped) clampedKeys.push(asset.key);
        if (result.missing) (asset.kind === 'native' ? missingCoinKeys : missingTokenKeys).push(asset.key);
    }
    // With no asset priced before now there is no history to draw, only
    // today's total: the card says so instead of a line that is flat at zero.
    return {
        series: anyPriced ? sums : null,
        byAsset,
        missingTokenKeys,
        missingCoinKeys,
        clampedKeys,
        pricedKeys,
    };
}

/**
 * Where the loaded history stops being the whole history. History saves at
 * most `cap` rows, newest first; a saved list that reached the cap starts at
 * its oldest row, and one below the cap is complete.
 *
 * @param {any[] | null | undefined} entries
 * @param {number} cap
 * @returns {number}  -Infinity when complete
 */
export function historyCoverageStart(entries, cap) {
    if (!Array.isArray(entries) || entries.length < cap) return -Infinity;
    let oldest = Infinity;
    for (const entry of entries) {
        const ms = entryMs(entry);
        if (ms !== null && ms < oldest) oldest = ms;
    }
    return Number.isFinite(oldest) ? oldest : -Infinity;
}

/**
 * A base-unit decimal string ("-12", "350", "-0.5") as a whole number of base
 * units, or null. The ledger can hold a fee finer than the token (a half unit
 * of a 0-decimal gas token); that fraction is dropped toward zero, which moves
 * a replayed balance by less than one base unit per such action.
 *
 * @param {unknown} text
 * @returns {bigint | null}
 */
export function baseUnits(text) {
    const s = String(text ?? '').trim();
    const match = /^(-?)(\d+)(?:\.\d+)?$/.exec(s);
    if (!match) return null;
    const whole = BigInt(match[2]);
    return match[1] === '-' ? -whole : whole;
}

/** A signed whole-unit decimal ("-1.5") as base units at `divisibility`, or null. */
function signedWholeToAtomic(text, divisibility) {
    const s = String(text ?? '').trim();
    const negative = s.startsWith('-');
    const atomic = wholeToAtomic(negative ? s.slice(1) : s, divisibility);
    if (atomic === null) return null;
    return negative ? -atomic : atomic;
}

/**
 * One /history effect as base units of the wallet's row: `net_base` is in the
 * token's own decimals, rescaled when the row counts a different number, and
 * `net_whole` stands in when the explorer has no decimals on record.
 *
 * @param {{ net_base?: string | null, net_whole?: string | null, decimals?: number | null }} effect
 * @param {number} divisibility
 * @returns {bigint | null}
 */
export function effectDelta(effect, divisibility) {
    const decimals = Number.isInteger(effect?.decimals) ? effect.decimals : null;
    const base = decimals === null ? null : baseUnits(effect?.net_base);
    if (base !== null) {
        if (decimals === divisibility) return base;
        if (decimals < divisibility) return base * 10n ** BigInt(divisibility - decimals);
        return base / 10n ** BigInt(decimals - divisibility);
    }
    return signedWholeToAtomic(effect?.net_whole, divisibility);
}

/**
 * @typedef {object} ChainHistoryReads
 * What the batch reads hold for one chain (useWalletHistory.js).
 * @property {Map<string, { ms: number, effects: Array<{ address: string, tick: string | null, decimals: number | null, net_base: string | null, net_whole: string | null }> }>} actions
 *           /history actions by action_index
 * @property {Map<string, { ms: number, nets: Record<string, string> }>} txs
 *           /native_history transactions by txid, each own address's net in base units
 * @property {number | null} tokenTruncatedAtMs   the token walk stopped short at this time
 * @property {number | null} nativeTruncatedAtMs  the coin walk stopped short at this time
 */

/**
 * Every balance change the batch reads state, per asset, newest first, and
 * where each asset's known history starts. Only the addresses in `scope`
 * count (the addresses the balance rows sum), so a move between two counted
 * addresses nets to zero and a move to an uncounted one leaves the total.
 *
 * A coin's changes come only from its native history: a /history effect that
 * names the coin's own ticker is a ledger amount, never the coin balance the
 * row holds. Every token action counts through its effects, whatever its type
 * (send, dispense, order match, dividend, sweep, fee, ...).
 *
 * @param {Map<string, ChainHistoryReads> | null | undefined} reads
 * @param {object} ctx
 * @param {Map<string, Set<string>>} ctx.scope
 * @param {Map<string, { key: string, chainId: string, tick: string, kind: string, divisibility: number }>} ctx.assets
 * @returns {{ deltasByKey: Map<string, Array<{ ms: number, delta: bigint }>>, coverageByKey: Map<string, number> }}
 */
export function readDeltas(reads, { scope, assets }) {
    const deltasByKey = new Map();
    const coverageByKey = new Map();
    if (!(reads instanceof Map) || !(assets instanceof Map)) return { deltasByKey, coverageByKey };
    const push = (key, ms, delta) => {
        if (delta === 0n) return;
        if (!deltasByKey.has(key)) deltasByKey.set(key, []);
        deltasByKey.get(key).push({ ms, delta });
    };
    for (const [chainId, chain] of reads) {
        const own = scope?.get(chainId);
        if (!own || own.size === 0 || !chain) continue;
        let nativeKey = null;
        for (const asset of assets.values()) {
            if (asset.chainId === chainId && asset.kind === 'native') nativeKey = asset.key;
        }
        if (nativeKey) {
            for (const tx of chain.txs?.values?.() || []) {
                let delta = 0n;
                for (const [address, net] of Object.entries(tx.nets || {})) {
                    if (!own.has(lower(address))) continue;
                    const value = baseUnits(net);
                    if (value !== null) delta += value;
                }
                push(nativeKey, tx.ms, delta);
            }
            if (Number.isFinite(chain.nativeTruncatedAtMs)) coverageByKey.set(nativeKey, chain.nativeTruncatedAtMs);
        }
        for (const action of chain.actions?.values?.() || []) {
            const sums = new Map();
            for (const effect of action.effects || []) {
                if (!own.has(lower(effect?.address)) || !effect?.tick) continue;
                const key = assetKeyOf(chainId, effect.tick);
                const asset = assets.get(key);
                if (!asset || asset.kind === 'native') continue;
                const delta = effectDelta(effect, asset.divisibility);
                if (delta === null) continue;
                sums.set(key, (sums.get(key) || 0n) + delta);
            }
            for (const [key, delta] of sums) push(key, action.ms, delta);
        }
        if (Number.isFinite(chain.tokenTruncatedAtMs)) {
            for (const asset of assets.values()) {
                if (asset.chainId === chainId && asset.kind !== 'native') coverageByKey.set(asset.key, chain.tokenTruncatedAtMs);
            }
        }
    }
    for (const list of deltasByKey.values()) list.sort((a, b) => b.ms - a.ms);
    return { deltasByKey, coverageByKey };
}

/**
 * A token's fiat price series from one /price_history answer: its oracle
 * series when it has one, else its DEX series (priced in the chain's coin)
 * converted at the coin's price at each point's own time, from the coin's
 * oracle series in the same answer or, without one, `coinSeries`. Points are
 * sparse (a bucket with no trade has none), so each converts on its own.
 *
 * @param {{ oracle?: Array<[number, number]> | null, dex?: Array<[number, number]> | null } | null | undefined} entry
 * @param {object} ctx
 * @param {Array<[number, number]> | null | undefined} ctx.coinOracle
 * @param {Array<[number, number]> | null | undefined} [ctx.coinSeries]
 * @param {number} ctx.toleranceMs
 * @returns {Array<[number, number]> | null}
 */
export function tokenFiatSeries(entry, { coinOracle, coinSeries = null, toleranceMs }) {
    if (Array.isArray(entry?.oracle) && entry.oracle.length > 0) return entry.oracle;
    if (!Array.isArray(entry?.dex) || entry.dex.length === 0) return null;
    const out = [];
    for (const [ms, inCoin] of entry.dex) {
        const coin = priceAt(coinOracle, ms, toleranceMs) ?? priceAt(coinSeries, ms, toleranceMs);
        if (coin === null || !(coin > 0)) continue;
        out.push([ms, inCoin * coin]);
    }
    return out.length > 0 ? out : null;
}

/** The tolerance a range's price samples are read with. */
export function priceToleranceFor(range) {
    return toleranceFor(range);
}
