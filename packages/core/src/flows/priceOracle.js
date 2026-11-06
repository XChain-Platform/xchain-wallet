// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native-coin price oracle: third-party data fetch for BTC / LTC / DOGE
// mainnet price, market cap, 24h change, and 7-day sparkline. Used by
// the TokenDetail stats strip + chart.
//
// Privacy: this is the wallet's only opt-out telemetry. By default it
// hits api.coingecko.com to fetch USD prices when the user opens a
// native-coin detail page. The setting `privacy.priceDataEnabled`
// (default true) governs whether the call fires; the host handler
// short-circuits to `{ disabled: true }` when off. The Settings →
// Privacy section exposes the toggle with copy that explicitly names
// the third party and what's being revealed.
//
// Mitigations to keep the privacy damage minimal:
//   - Device-backed cache. 5 min for spot (price/marketCap/24h), 1 hour
//     for sparkline. Reloads show the last observation without another call.
//   - Single batched call for all native chains, not three round-trips.
//     One IP-revealing request per cache window.
//   - Testnet / regtest chains return null (no price data). No request
//     is made for them.
//
// The caller injects `fetch` so this module is testable without
// network access. In production the host wraps it with the global
// fetch from the browser / SW.

import { COINGECKO_API_BASE } from '../branding/branding.js';

import { fetchWithRetry } from '../shared/utils/fetchWithRetry.js';

const SPOT_TTL_MS = 5 * 60 * 1000;
const SPARKLINE_TTL_MS = 60 * 60 * 1000;
const PERSISTED_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PERSISTED_CACHE_MAX = 64;
const PERSISTED_SPOT_KEY = 'xchain-wallet:price-oracle-spot:v1';
const PERSISTED_SPARKLINE_KEY = 'xchain-wallet:price-oracle-sparkline:v1';

function isFreshAge(ageMs, ttlMs) {
    return ageMs >= 0 && ageMs <= ttlMs;
}

// CoinGecko's coin-id namespace. Only mainnet chains have a market
// price. Demo wallets supply their own fixture prices before this
// oracle is reached, while real testnet and regtest coins stay unpriced.
const COINGECKO_ID_BY_CHAIN = {
    'bitcoin-mainnet': 'bitcoin',
    'litecoin-mainnet': 'litecoin',
    'dogecoin-mainnet': 'dogecoin',
};

/**
 * @typedef {Object} NativePriceEntry
 * @property {number | null} priceFiat                 e.g. 67612.45 USD
 * @property {number | null} marketCapFiat             USD
 * @property {number | null} change24hPct              percent, signed
 * @property {number[] | null} sparkline               historical price points (oldest → newest); only populated when includeSparkline
 * @property {number} fetchedAt                        epoch ms when this entry was cached
 * @property {boolean} [stale]                         true when the returned cached observation is expired
 */

/**
 * @typedef {Object} PriceOracleResult
 * @property {boolean} [disabled]                      true when settings.privacy.priceDataEnabled = false
 * @property {Record<string, NativePriceEntry | null>} [prices]   keyed by chainId; null for chains with no price source (testnet/regtest)
 * @property {string} [error]                          present when the fetch failed; prices may still hold cached values
 */

/**
 * Build a price-oracle instance. Browser-backed shells hydrate the last
 * successful observations lazily, while Node and service-worker contexts
 * without localStorage continue to use only the in-memory cache.
 *
 * @param {{ fetch: typeof fetch, now?: () => number }} deps
 */
export function createPriceOracle({ fetch, now = () => Date.now() }) {
    if (typeof fetch !== 'function') {
        throw new Error('createPriceOracle: fetch is required');
    }
    /** @type {Map<string, NativePriceEntry>} */
    const cache = new Map();
    /** @type {Map<string, { sparkline: number[], fetchedAt: number }>} */
    const sparklineCache = new Map();
    /** @type {Map<string, Promise<{ error: string | null, aborted?: unknown }>>} */
    const spotRefreshes = new Map();
    /** @type {Map<string, Promise<{ error: string | null, aborted?: unknown }>>} */
    const sparklineRefreshes = new Map();
    /** @type {Map<string, number>} */
    const spotRefreshAttemptAt = new Map();
    /** @type {Map<string, number>} */
    const sparklineRefreshAttemptAt = new Map();
    let persistedCachesHydrated = false;

    function hydratePersistedCaches(tNow) {
        if (persistedCachesHydrated) return;
        persistedCachesHydrated = true;
        const storage = localPriceStorage();
        if (!storage) return;
        try {
            const parsed = JSON.parse(storage.getItem(PERSISTED_SPOT_KEY) || 'null');
            if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
                let dropped = false;
                for (const value of parsed.entries) {
                    const entry = persistedSpotEntry(value, tNow);
                    if (!entry) { dropped = true; continue; }
                    cache.set(entry.key, entry.value);
                }
                trimCache(cache, tNow);
                if (dropped || cache.size !== parsed.entries.length) persistSpotCache(cache, tNow);
            }
        } catch {
            // A corrupt or unavailable convenience cache never blocks pricing.
        }
        try {
            const parsed = JSON.parse(storage.getItem(PERSISTED_SPARKLINE_KEY) || 'null');
            if (parsed?.version === 1 && Array.isArray(parsed.entries)) {
                let dropped = false;
                for (const value of parsed.entries) {
                    const entry = persistedSparklineEntry(value, tNow);
                    if (!entry) { dropped = true; continue; }
                    sparklineCache.set(entry.key, entry.value);
                }
                trimCache(sparklineCache, tNow);
                if (dropped || sparklineCache.size !== parsed.entries.length) persistSparklineCache(sparklineCache, tNow);
            }
        } catch {
            // A corrupt or unavailable convenience cache never blocks pricing.
        }
    }

    function entryFor(key, tNow, includeSparkline = false) {
        const spot = cache.get(key);
        const chart = sparklineCache.get(key);
        if (!spot && !chart) return undefined;
        const entry = {
            ...(spot ?? {
                priceFiat: null,
                marketCapFiat: null,
                change24hPct: null,
                fetchedAt: tNow - SPOT_TTL_MS - 1,
            }),
            sparkline: chart?.sparkline ?? null,
        };
        const spotFresh = spot && isFreshAge(tNow - spot.fetchedAt, SPOT_TTL_MS);
        const chartFresh = !includeSparkline || (chart && isFreshAge(tNow - chart.fetchedAt, SPARKLINE_TTL_MS));
        if (!spotFresh || !chartFresh) entry.stale = true;
        return entry;
    }

    async function refreshSpot(lookups, vsCurrency, tNow, signal) {
        try {
            const idsParam = lookups.map((s) => s.coingeckoId).join(',');
            const url = `${COINGECKO_API_BASE}/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=${encodeURIComponent(vsCurrency)}&include_market_cap=true&include_24hr_change=true`;
            const resp = await fetchWithRetry(fetch, url, { signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const entries = lookups.map((lk) => {
                const key = cacheKey(lk.chainId, vsCurrency);
                const row = data?.[lk.coingeckoId];
                const priceFiat = numOrNull(row?.[vsCurrency]);
                if (priceFiat === null || priceFiat <= 0) {
                    throw new Error(`CoinGecko returned no valid ${vsCurrency.toUpperCase()} price for ${lk.coingeckoId}`);
                }
                return {
                    key,
                    entry: {
                        priceFiat,
                        marketCapFiat: numOrNull(row?.[`${vsCurrency}_market_cap`]),
                        change24hPct: numOrNull(row?.[`${vsCurrency}_24h_change`]),
                        sparkline: null,
                        fetchedAt: tNow,
                    },
                };
            });
            for (const { key, entry } of entries) cache.set(key, entry);
            persistSpotCache(cache, tNow);
            return { error: null };
        } catch (err) {
            if (signal?.aborted) return { error: null, aborted: err };
            return { error: err && err.message ? String(err.message) : String(err) };
        }
    }

    function startSpotRefresh(lookups, vsCurrency, tNow, signal) {
        const pending = new Set();
        const start = [];
        for (const lk of lookups) {
            const key = cacheKey(lk.chainId, vsCurrency);
            const active = spotRefreshes.get(key);
            if (active) { pending.add(active); continue; }
            start.push(lk);
        }
        if (start.length > 0) {
            let promise;
            promise = refreshSpot(start, vsCurrency, tNow, signal).finally(() => {
                for (const lk of start) {
                    const key = cacheKey(lk.chainId, vsCurrency);
                    if (spotRefreshes.get(key) === promise) spotRefreshes.delete(key);
                }
            });
            for (const lk of start) {
                const key = cacheKey(lk.chainId, vsCurrency);
                spotRefreshAttemptAt.set(key, tNow);
                spotRefreshes.set(key, promise);
            }
            pending.add(promise);
        }
        return [...pending];
    }

    async function refreshSparkline(lk, vsCurrency, tNow, signal) {
        try {
            const url = `${COINGECKO_API_BASE}/coins/${encodeURIComponent(lk.coingeckoId)}/market_chart?vs_currency=${encodeURIComponent(vsCurrency)}&days=7`;
            const resp = await fetchWithRetry(fetch, url, { signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            const series = Array.isArray(data?.prices)
                ? data.prices.map((pt) => Number(pt?.[1])).filter((price) => Number.isFinite(price) && price > 0)
                : null;
            if (!series || series.length === 0) {
                throw new Error(`CoinGecko returned no valid price history for ${lk.coingeckoId}`);
            }
            sparklineCache.set(cacheKey(lk.chainId, vsCurrency), { sparkline: series, fetchedAt: tNow });
            persistSparklineCache(sparklineCache, tNow);
            return { error: null };
        } catch (err) {
            if (signal?.aborted) return { error: null, aborted: err };
            return { error: err && err.message ? String(err.message) : String(err) };
        }
    }

    function startSparklineRefresh(lookups, vsCurrency, tNow, signal) {
        const pending = new Set();
        for (const lk of lookups) {
            const key = cacheKey(lk.chainId, vsCurrency);
            const active = sparklineRefreshes.get(key);
            if (active) { pending.add(active); continue; }
            let promise;
            promise = refreshSparkline(lk, vsCurrency, tNow, signal).finally(() => {
                if (sparklineRefreshes.get(key) === promise) sparklineRefreshes.delete(key);
            });
            sparklineRefreshAttemptAt.set(key, tNow);
            sparklineRefreshes.set(key, promise);
            pending.add(promise);
        }
        return [...pending];
    }

    /**
     * Fetch (or return cached) prices for the supplied chainIds in the
     * given fiat currency. Returns `null` entries for chains we can't
     * map to a CoinGecko id (anything not on mainnet). `includeSparkline`
     * triggers an additional per-coin chart fetch.
     *
     * @param {{ chainIds: string[], fiatCurrency?: string, includeSparkline?: boolean, signal?: AbortSignal }} opts
     * @returns {Promise<PriceOracleResult>}
     */
    async function getNativePrices({ chainIds, fiatCurrency = 'usd', includeSparkline = false, signal }) {
        if (!Array.isArray(chainIds)) {
            throw new Error('getNativePrices: chainIds must be an array');
        }
        if (chainIds.some((id) => typeof id !== 'string' || id.length === 0)) {
            throw new Error('getNativePrices: chainIds must contain non-empty strings');
        }
        const vsCurrency = String(fiatCurrency).trim().toLowerCase();
        if (!/^[a-z]{3}$/.test(vsCurrency)) {
            throw new Error('getNativePrices: fiatCurrency must be a three-letter currency code');
        }
        /** @type {Record<string, NativePriceEntry | null>} */
        const out = {};
        const tNow = now();
        hydratePersistedCaches(tNow);
        if (trimCache(cache, tNow)) persistSpotCache(cache, tNow);
        if (trimCache(sparklineCache, tNow)) persistSparklineCache(sparklineCache, tNow);

        // Partition: chains we know how to look up vs. chains we don't.
        // Unknown chains get a null entry; UI shows "no price data".
        const lookups = [];
        for (const id of chainIds) {
            const cgId = COINGECKO_ID_BY_CHAIN[id];
            if (!cgId) {
                out[id] = null;
                continue;
            }
            lookups.push({ chainId: id, coingeckoId: cgId });
        }
        if (lookups.length === 0) return { prices: out };

        // Spot and sparkline data use separate freshness windows so a chart
        // request does not refetch fresh spot data.
        const spotCandidates = [];
        let missingSpot = false;
        for (const lk of lookups) {
            const key = cacheKey(lk.chainId, vsCurrency);
            const cached = cache.get(key);
            if (!cached) {
                missingSpot = true;
                spotCandidates.push(lk);
                continue;
            }
            out[lk.chainId] = entryFor(key, tNow, includeSparkline);
            if (!isFreshAge(tNow - cached.fetchedAt, SPOT_TTL_MS)
                && refreshAllowed(spotRefreshAttemptAt.get(key), tNow, SPOT_TTL_MS)) {
                spotCandidates.push(lk);
            }
        }

        // One batched spot call covers every missing or stale chain. Cached
        // stale observations are returned now while this refresh continues.
        let spotErr = null;
        if (spotCandidates.length > 0) {
            const refreshes = startSpotRefresh(spotCandidates, vsCurrency, tNow, signal);
            if (missingSpot) {
                const settled = await Promise.all(refreshes);
                const aborted = settled.find((result) => result.aborted)?.aborted;
                if (aborted) throw aborted;
                spotErr = settled.find((result) => result.error)?.error ?? null;
            }
        }
        for (const lk of lookups) {
            const entry = entryFor(cacheKey(lk.chainId, vsCurrency), tNow, includeSparkline);
            if (entry) out[lk.chainId] = entry;
        }

        // Sparkline pass: only when requested, and only for chains whose
        // cached chart is missing or stale. Each chain costs one request.
        // Stale charts return immediately while a single refresh continues.
        let sparklineErr = null;
        if (includeSparkline) {
            const sparklineCandidates = [];
            let missingSparkline = false;
            for (const lk of lookups) {
                const key = cacheKey(lk.chainId, vsCurrency);
                const chart = sparklineCache.get(key);
                if (!chart) {
                    missingSparkline = true;
                    sparklineCandidates.push(lk);
                } else if (!isFreshAge(tNow - chart.fetchedAt, SPARKLINE_TTL_MS)
                    && refreshAllowed(sparklineRefreshAttemptAt.get(key), tNow, SPARKLINE_TTL_MS)) {
                    sparklineCandidates.push(lk);
                }
            }
            if (sparklineCandidates.length > 0) {
                const refreshes = startSparklineRefresh(sparklineCandidates, vsCurrency, tNow, signal);
                if (missingSparkline) {
                    const settled = await Promise.all(refreshes);
                    const aborted = settled.find((result) => result.aborted)?.aborted;
                    if (aborted) throw aborted;
                    sparklineErr = settled.find((result) => result.error)?.error ?? null;
                }
            }
            for (const lk of lookups) {
                const entry = entryFor(cacheKey(lk.chainId, vsCurrency), tNow, true);
                if (entry) out[lk.chainId] = entry;
            }
        }

        const result = /** @type {PriceOracleResult} */ ({ prices: out });
        if (spotErr || sparklineErr) result.error = spotErr || sparklineErr;
        return result;
    }

    function clearCache() {
        cache.clear();
        sparklineCache.clear();
        spotRefreshAttemptAt.clear();
        sparklineRefreshAttemptAt.clear();
        const storage = localPriceStorage();
        if (!storage) return;
        try {
            if (typeof storage.removeItem === 'function') storage.removeItem(PERSISTED_SPOT_KEY);
        } catch { /* tolerate unavailable storage */ }
        try {
            if (typeof storage.removeItem === 'function') storage.removeItem(PERSISTED_SPARKLINE_KEY);
        } catch { /* tolerate unavailable storage */ }
    }

    return { getNativePrices, clearCache };
}

function localPriceStorage() {
    try {
        const storage = globalThis.localStorage;
        return storage
            && typeof storage.getItem === 'function'
            && typeof storage.setItem === 'function'
            ? storage
            : null;
    } catch {
        return null;
    }
}

function validPersistedKey(key) {
    if (typeof key !== 'string') return false;
    const split = key.lastIndexOf('|');
    if (split <= 0) return false;
    const chainId = key.slice(0, split);
    const currency = key.slice(split + 1);
    return Boolean(COINGECKO_ID_BY_CHAIN[chainId]) && /^[a-z]{3}$/.test(currency);
}

function validFetchedAt(value, tNow) {
    return Number.isFinite(value) && value >= 0 && tNow - value <= PERSISTED_MAX_AGE_MS;
}

function persistedSpotEntry(value, tNow) {
    if (!value || typeof value !== 'object' || !validPersistedKey(value.key)) return null;
    const priceFiat = numOrNull(value.priceFiat);
    const marketCapFiat = numOrNull(value.marketCapFiat);
    const change24hPct = numOrNull(value.change24hPct);
    if (priceFiat === null || priceFiat <= 0 || !validFetchedAt(value.fetchedAt, tNow)) return null;
    if (value.marketCapFiat != null && marketCapFiat === null) return null;
    if (value.change24hPct != null && change24hPct === null) return null;
    return {
        key: value.key,
        value: { priceFiat, marketCapFiat, change24hPct, sparkline: null, fetchedAt: value.fetchedAt },
    };
}

function persistedSparklineEntry(value, tNow) {
    if (!value || typeof value !== 'object' || !validPersistedKey(value.key)) return null;
    if (!validFetchedAt(value.fetchedAt, tNow) || !Array.isArray(value.sparkline)) return null;
    const sparkline = value.sparkline.map(Number).filter((price) => Number.isFinite(price) && price > 0);
    if (sparkline.length === 0 || sparkline.length !== value.sparkline.length) return null;
    return { key: value.key, value: { sparkline, fetchedAt: value.fetchedAt } };
}

function trimCache(cache, tNow) {
    let changed = false;
    for (const [key, entry] of cache) {
        if (!Number.isFinite(entry?.fetchedAt) || tNow - entry.fetchedAt > PERSISTED_MAX_AGE_MS) {
            cache.delete(key);
            changed = true;
        }
    }
    if (cache.size <= PERSISTED_CACHE_MAX) return changed;
    const keep = [...cache.entries()]
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, PERSISTED_CACHE_MAX);
    cache.clear();
    for (const [key, entry] of keep) cache.set(key, entry);
    return true;
}

function persistSpotCache(cache, tNow) {
    trimCache(cache, tNow);
    const storage = localPriceStorage();
    if (!storage) return;
    const entries = [...cache.entries()]
        .filter(([, entry]) => entry.fetchedAt >= 0)
        .map(([key, entry]) => ({
            key,
            priceFiat: entry.priceFiat,
            marketCapFiat: entry.marketCapFiat,
            change24hPct: entry.change24hPct,
            fetchedAt: entry.fetchedAt,
        }));
    try {
        storage.setItem(PERSISTED_SPOT_KEY, JSON.stringify({ version: 1, entries }));
    } catch {
        // Storage quota and private-mode failures do not affect the live cache.
    }
}

function persistSparklineCache(cache, tNow) {
    trimCache(cache, tNow);
    const storage = localPriceStorage();
    if (!storage) return;
    const entries = [...cache.entries()]
        .filter(([, entry]) => entry.fetchedAt >= 0)
        .map(([key, entry]) => ({ key, ...entry }));
    try {
        storage.setItem(PERSISTED_SPARKLINE_KEY, JSON.stringify({ version: 1, entries }));
    } catch {
        // Storage quota and private-mode failures do not affect the live cache.
    }
}

function refreshAllowed(lastAttemptAt, tNow, ttlMs) {
    if (lastAttemptAt === undefined) return true;
    const ageMs = tNow - lastAttemptAt;
    return ageMs < 0 || ageMs >= ttlMs;
}

function cacheKey(chainId, vsCurrency) {
    return `${chainId}|${vsCurrency}`;
}

function numOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const COINGECKO_SUPPORTED_CHAINS = Object.keys(COINGECKO_ID_BY_CHAIN);
