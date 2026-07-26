// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Price lookup: §45 PRICE-oracle fiat rates for native coins.
//
// Source selection (decided 2026-07-17, ): the hub's on-chain
// PRICE oracle is the primary source, consumed through the explorer
// API's hub-mirrored `price_snapshots` table (finalized consensus
// rounds). CoinGecko is the fallback, used only when the oracle feed
// is stale or unreachable. When both fail, `getFiatRate` returns null
// and the UI shows no fiat value (§45.4: never fabricate a number).
//
// Split contract:
//   - `refreshFiatRates(...)` is async and does the network work,
//     populating an in-process rate cache.
//   - `getFiatRate(...)` stays synchronous and reads the cache, so
//     existing render-path callers keep their shape.
//   - `subscribeFiatRates(fn)` notifies UI code when the cache
//     changes (used by the `useFiatRate` hook).
//
// The returned shape `{ rate, source, fiatCurrency, fetchedAt }` is
// unchanged from the placeholder era; only `source` values moved from
// 'static-placeholder' to 'oracle' / 'coingecko'.

import { tickerForCoin } from '../registry/coinTicker.js';
import { defaultRegistry } from '../registry/index.js';

// Oracle rounds finalize every ~10 minutes (ORACLE_ROUND_INTERVAL
// 600s on the hub). A snapshot older than three missed rounds means
// the feed is wedged; fall back rather than show a dead price.
const ORACLE_STALE_MS = 30 * 60 * 1000;

// Don't re-hit the network for a coin whose cached rate is younger
// than this. Mirrors priceOracle.js's spot TTL.
const REFRESH_TTL_MS = 5 * 60 * 1000;

const FETCH_TIMEOUT_MS = 8000;

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// CoinGecko id per coin family. For the launch coins the id happens to
// equal the family name; the map keeps that an implementation detail.
const COINGECKO_ID_BY_COIN = {
    bitcoin: 'bitcoin',
    litecoin: 'litecoin',
    dogecoin: 'dogecoin',
};

/**
 * @typedef {object} FiatRate
 * @property {number} rate           units of `fiatCurrency` per 1 native coin
 * @property {string} chainCoin      coin family the rate is for (matches descriptor.coin)
 * @property {string} fiatCurrency   ISO-style currency code (USD, EUR, …)
 * @property {'oracle' | 'coingecko'} source
 * @property {string} fetchedAt      ISO timestamp of when the rate was obtained
 */

// Each entry holds a frozen public FiatRate object plus its ms
// timestamp. The public object is created once per refresh so
// `getFiatRate` returns a stable reference (required by
// useSyncExternalStore's Object.is snapshot comparison).
/** @type {Map<string, { rate: FiatRate, fetchedAtMs: number }>} */
const rateCache = new Map();

/** @type {Set<() => void>} */
const listeners = new Set();

// Injectable deps so tests (and shells with their own fetch policy)
// can rewire the module without touching the network.
let deps = {
    /** @type {typeof fetch | null} */
    fetch: null,
    now: () => Date.now(),
    /** @type {Record<string, string> | null}  coin -> explorer base URL (mainnet) */
    explorerUrlByCoin: null,
};

function cacheKey(chainCoin, fiatCurrency) {
    return `${chainCoin}|${fiatCurrency}`;
}

function notifyListeners() {
    for (const fn of listeners) {
        try { fn(); } catch { /* listener errors must not break the refresh */ }
    }
}

function resolveFetch() {
    if (typeof deps.fetch === 'function') return deps.fetch;
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
}

// The oracle prices real (mainnet) coins; every coin family's rate
// comes from its mainnet explorer regardless of which network the
// user is currently on (a regtest BTC balance is still priced as BTC,
// matching priceOracle.js's chain-id mapping).
function explorerUrlForCoin(chainCoin) {
    // : the explorer base is bare (no coin) by design; every explorer
    // request must carry the coin path segment. This is the coin's MAINNET
    // code (== tickerForCoin, no network prefix) since the oracle is queried
    // from mainnet. Applied to the descriptor base AND any configured override,
    // both of which are bare under the same convention.
    const raw = (deps.explorerUrlByCoin && deps.explorerUrlByCoin[chainCoin])
        || defaultRegistry().byCoin(chainCoin).find((d) => d.networkKind === 'mainnet')?.explorer?.defaultUrl;
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return raw.replace(/\/+$/, '') + '/' + tickerForCoin(chainCoin);
}

async function fetchJson(fetchImpl, url) {
    const opts = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        : {};
    const resp = await fetchImpl(url, opts);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.json();
}

/**
 * Primary source: latest finalized oracle snapshot for `SYM/USD` from
 * the coin's mainnet explorer (hub-mirrored `price_snapshots`).
 * Returns a positive rate number, or null when the pair has no fresh
 * finalized snapshot. Throws on transport errors (caller falls back).
 *
 * Queried via the status filter (FINALIZED) rather than the pair
 * filter because the pair contains a '/', which doesn't survive the
 * explorer's path-segment routing.
 */
async function fetchOracleRate(fetchImpl, chainCoin, nowMs) {
    const base = explorerUrlForCoin(chainCoin);
    if (!base) return null;
    const pair = `${tickerForCoin(chainCoin)}/USD`;
    const json = await fetchJson(fetchImpl, `${base}/api/price_snapshots/FINALIZED/status?limit=25`);
    const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const row = rows.find((r) => r && r.coin_pair === pair);
    if (!row) return null;
    const rate = Number(row.price);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    // Staleness: prefer the snapshot's chain-anchored block timestamp
    // (unix seconds); fall back to the row's created_at.
    let tsMs = null;
    if (row.block_timestamp != null && Number.isFinite(Number(row.block_timestamp))) {
        tsMs = Number(row.block_timestamp) * 1000;
    } else if (row.created_at != null) {
        const parsed = Date.parse(row.created_at);
        if (Number.isFinite(parsed)) tsMs = parsed;
    }
    if (tsMs != null && nowMs - tsMs > ORACLE_STALE_MS) return null;
    return rate;
}

/**
 * Fallback source: one batched CoinGecko spot call for all the coins
 * the oracle couldn't serve. Returns `{ coin: rate }` for the coins
 * it could price. Throws on transport errors.
 */
async function fetchCoingeckoRates(fetchImpl, chainCoins, fiatCurrency) {
    const vs = String(fiatCurrency).toLowerCase();
    const ids = chainCoins
        .map((c) => COINGECKO_ID_BY_COIN[c])
        .filter(Boolean);
    if (ids.length === 0) return {};
    const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=${encodeURIComponent(vs)}`;
    const json = await fetchJson(fetchImpl, url);
    /** @type {Record<string, number>} */
    const out = {};
    for (const coin of chainCoins) {
        const id = COINGECKO_ID_BY_COIN[coin];
        const rate = Number(json?.[id]?.[vs]);
        if (Number.isFinite(rate) && rate > 0) out[coin] = rate;
    }
    return out;
}

/**
 * Override the module's network/clock deps. Shells call this once at
 * boot when they need a non-default fetch (or a fixed explorer URL
 * set, e.g. a regtest venue); tests use it to inject fakes.
 *
 * @param {{ fetch?: typeof fetch, now?: () => number, explorerUrlByCoin?: Record<string, string> }} next
 */
export function configureFiatRateSource(next = {}) {
    deps = {
        fetch: next.fetch ?? deps.fetch,
        now: next.now ?? deps.now,
        explorerUrlByCoin: next.explorerUrlByCoin ?? deps.explorerUrlByCoin,
    };
}

/**
 * Refresh the fiat-rate cache for the given coin families. Oracle
 * first, CoinGecko fallback per §45 / . Coins whose cached rate
 * is younger than REFRESH_TTL_MS are skipped unless `force`. A total
 * failure keeps any prior cached rate (better a slightly old price
 * than a blank one mid-session).
 *
 * `allowCoingeckoFallback` lets callers honor the
 * `privacy.priceDataEnabled` setting: the oracle explorer call reveals
 * nothing beyond normal wallet API traffic, but CoinGecko is a third
 * party, so an opted-out user never hits it from this path either.
 *
 * @param {object} opts
 * @param {string[]} opts.chainCoins
 * @param {string} [opts.fiatCurrency]              default 'USD'
 * @param {boolean} [opts.allowCoingeckoFallback]   default true
 * @param {boolean} [opts.force]                    default false
 * @returns {Promise<{ updated: string[] }>}        coins whose rate changed
 */
export async function refreshFiatRates({
    chainCoins,
    fiatCurrency = 'USD',
    allowCoingeckoFallback = true,
    force = false,
} = {}) {
    if (!Array.isArray(chainCoins) || chainCoins.length === 0) return { updated: [] };
    const fetchImpl = resolveFetch();
    if (!fetchImpl) return { updated: [] };
    const nowMs = deps.now();

    const wanted = chainCoins.filter((coin) => {
        if (typeof coin !== 'string' || coin.length === 0) return false;
        if (force) return true;
        const hit = rateCache.get(cacheKey(coin, fiatCurrency));
        return !hit || nowMs - hit.fetchedAtMs > REFRESH_TTL_MS;
    });
    if (wanted.length === 0) return { updated: [] };

    /** @type {string[]} */
    const updated = [];
    const put = (coin, rate, source) => {
        rateCache.set(cacheKey(coin, fiatCurrency), {
            rate: Object.freeze({
                rate,
                chainCoin: coin,
                fiatCurrency,
                source,
                fetchedAt: new Date(nowMs).toISOString(),
            }),
            fetchedAtMs: nowMs,
        });
        updated.push(coin);
    };

    // Oracle pass. The on-chain feed publishes USD pairs only; any
    // other fiat currency goes straight to the fallback.
    const unresolved = [];
    for (const coin of wanted) {
        if (fiatCurrency !== 'USD') { unresolved.push(coin); continue; }
        try {
            const rate = await fetchOracleRate(fetchImpl, coin, nowMs);
            if (rate != null) put(coin, rate, 'oracle');
            else unresolved.push(coin);
        } catch {
            unresolved.push(coin);
        }
    }

    // Fallback pass, one batched call for everything the oracle
    // couldn't serve.
    if (unresolved.length > 0 && allowCoingeckoFallback) {
        try {
            const rates = await fetchCoingeckoRates(fetchImpl, unresolved, fiatCurrency);
            for (const [coin, rate] of Object.entries(rates)) put(coin, rate, 'coingecko');
        } catch { /* keep whatever the cache already holds */ }
    }

    if (updated.length > 0) notifyListeners();
    return { updated };
}

/**
 * Look up a fiat rate for the chain's native coin from the in-process
 * cache. Synchronous; returns null until `refreshFiatRates` has
 * populated a rate for the coin/currency (§45.4: no data means no
 * number, never a fabricated one).
 *
 * @param {object} opts
 * @param {string} opts.chainCoin
 * @param {string} [opts.fiatCurrency]   default 'USD'
 * @returns {FiatRate | null}
 */
export function getFiatRate({ chainCoin, fiatCurrency = 'USD' } = {}) {
    if (typeof chainCoin !== 'string' || chainCoin.length === 0) return null;
    const hit = rateCache.get(cacheKey(chainCoin, fiatCurrency));
    return hit ? hit.rate : null;
}

/**
 * Subscribe to rate-cache changes. Returns an unsubscribe function.
 * Used by `useFiatRate` (via useSyncExternalStore) so views re-render
 * when a refresh lands.
 *
 * @param {() => void} fn
 * @returns {() => void}
 */
export function subscribeFiatRates(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** Test-only: clear the cache and injected deps. */
export function _resetPriceLookupForTests() {
    rateCache.clear();
    listeners.clear();
    deps = { fetch: null, now: () => Date.now(), explorerUrlByCoin: null };
}

/**
 * Convert a coin-denominated decimal string to fiat at the given rate.
 * Caller has already obtained the rate via `getFiatRate`.
 *
 * @param {string | number} coinAmount  decimal at coin scale (NOT sats)
 * @param {FiatRate} rate
 * @returns {number | null}            null when conversion fails
 */
export function coinToFiat(coinAmount, rate) {
    if (!rate || typeof rate.rate !== 'number') return null;
    const n = typeof coinAmount === 'number' ? coinAmount : parseFloat(coinAmount);
    if (!Number.isFinite(n)) return null;
    return n * rate.rate;
}

/**
 * Inverse: convert a fiat amount to coin scale. Returns a decimal
 * string at coin scale, suitable for placing into a SEND form's
 * AMOUNT field.
 *
 * @param {string | number} fiatAmount
 * @param {FiatRate} rate
 * @param {number} [decimals]      coin scale; default 8 for BTC/LTC/DOGE
 * @returns {string | null}
 */
export function fiatToCoin(fiatAmount, rate, decimals = 8) {
    if (!rate || typeof rate.rate !== 'number' || rate.rate === 0) return null;
    const n = typeof fiatAmount === 'number' ? fiatAmount : parseFloat(fiatAmount);
    if (!Number.isFinite(n) || n < 0) return null;
    const coin = n / rate.rate;
    // Keep the value in fixed-notation string space and only trim insignificant
    // trailing zeros. Round-tripping through Number(...).toString() re-introduces
    // exponential notation below 1e-6 (e.g. "9e-8" for $0.01 at a 110k rate),
    // which is the canonical SEND amount and is rejected by the consensus amount
    // grammar /^[0-9]+(\.[0-9]+)?$/.
    return coin.toFixed(decimals).replace(/\.?0+$/, '');
}
