// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native-coin price oracle — third-party data fetch for BTC / LTC / DOGE
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
//   - In-process cache. 5 min for spot (price/marketCap/24h), 1 hour
//     for sparkline. Most TokenDetail visits hit the cache.
//   - Single batched call for all native chains, not three round-trips.
//     One IP-revealing request per cache window.
//   - Testnet / regtest chains return null (no price data). No request
//     is made for them.
//
// The caller injects `fetch` so this module is testable without
// network access. In production the host wraps it with the global
// fetch from the browser / SW.

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const SPOT_TTL_MS = 5 * 60 * 1000;
const SPARKLINE_TTL_MS = 60 * 60 * 1000;

// CoinGecko's coin-id namespace. All networks (mainnet / testnet /
// regtest) map to the same id per coin — the price of Bitcoin is the
// same regardless of which network the user is currently holding it
// on. Testnet / regtest coins are economically worthless, but it's
// still useful to surface "what would this be worth on mainnet" on
// the TokenDetail page rather than showing nothing.
const COINGECKO_ID_BY_CHAIN = {
    'bitcoin-mainnet': 'bitcoin',
    'bitcoin-testnet': 'bitcoin',
    'bitcoin-regtest': 'bitcoin',
    'litecoin-mainnet': 'litecoin',
    'litecoin-testnet': 'litecoin',
    'litecoin-regtest': 'litecoin',
    'dogecoin-mainnet': 'dogecoin',
    'dogecoin-testnet': 'dogecoin',
    'dogecoin-regtest': 'dogecoin',
};

/**
 * @typedef {Object} NativePriceEntry
 * @property {number | null} priceFiat                 e.g. 67612.45 USD
 * @property {number | null} marketCapFiat             USD
 * @property {number | null} change24hPct              percent, signed
 * @property {number[] | null} sparkline               historical price points (oldest → newest); only populated when includeSparkline
 * @property {number} fetchedAt                        epoch ms when this entry was cached
 */

/**
 * @typedef {Object} PriceOracleResult
 * @property {boolean} [disabled]                      true when settings.privacy.priceDataEnabled = false
 * @property {Record<string, NativePriceEntry | null>} [prices]   keyed by chainId; null for chains with no price source (testnet/regtest)
 * @property {string} [error]                          present when the fetch failed; prices may still hold cached values
 */

/**
 * Build a price-oracle instance. The instance holds its own in-memory
 * cache and never persists to disk — restart the SW / reload the
 * page = empty cache. That's a deliberate privacy choice; we don't
 * want yesterday's "what coin did the user check?" sitting in storage.
 *
 * @param {{ fetch: typeof fetch, now?: () => number }} deps
 */
export function createPriceOracle({ fetch, now = () => Date.now() }) {
    if (typeof fetch !== 'function') {
        throw new Error('createPriceOracle: fetch is required');
    }
    /** @type {Map<string, NativePriceEntry>} */
    const cache = new Map();

    /**
     * Fetch (or return cached) prices for the supplied chainIds in the
     * given fiat currency. Returns `null` entries for chains we can't
     * map to a CoinGecko id (anything not on mainnet). `includeSparkline`
     * triggers an additional per-coin chart fetch.
     *
     * @param {{ chainIds: string[], fiatCurrency?: string, includeSparkline?: boolean }} opts
     * @returns {Promise<PriceOracleResult>}
     */
    async function getNativePrices({ chainIds, fiatCurrency = 'usd', includeSparkline = false }) {
        if (!Array.isArray(chainIds)) {
            throw new Error('getNativePrices: chainIds must be an array');
        }
        const vsCurrency = String(fiatCurrency).toLowerCase();
        /** @type {Record<string, NativePriceEntry | null>} */
        const out = {};

        // Partition: chains we know how to look up vs. chains we don't.
        // Unknown chains get a null entry — UI shows "no price data".
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

        // For each lookup, see if the cache is fresh enough for the
        // user's request. A request that needs sparkline data may be
        // satisfied from a spot-only cached entry only partially — in
        // that case we re-fetch to bring the sparkline in.
        const tNow = now();
        const stale = [];
        for (const lk of lookups) {
            const cached = cache.get(cacheKey(lk.chainId, vsCurrency));
            if (!cached) { stale.push(lk); continue; }
            const ageMs = tNow - cached.fetchedAt;
            const wantSpark = includeSparkline && cached.sparkline == null;
            if (wantSpark && ageMs > SPARKLINE_TTL_MS) { stale.push(lk); continue; }
            if (ageMs > SPOT_TTL_MS) { stale.push(lk); continue; }
            out[lk.chainId] = cached;
        }
        if (stale.length === 0) return { prices: out };

        // One batched spot call covers every stale chain — that's the
        // whole privacy mitigation: one request, not N.
        let spotErr = null;
        try {
            const idsParam = stale.map((s) => s.coingeckoId).join(',');
            const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(idsParam)}&vs_currencies=${encodeURIComponent(vsCurrency)}&include_market_cap=true&include_24hr_change=true`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            for (const lk of stale) {
                const row = data?.[lk.coingeckoId];
                /** @type {NativePriceEntry} */
                const entry = {
                    priceFiat: numOrNull(row?.[vsCurrency]),
                    marketCapFiat: numOrNull(row?.[`${vsCurrency}_market_cap`]),
                    change24hPct: numOrNull(row?.[`${vsCurrency}_24h_change`]),
                    sparkline: null,
                    fetchedAt: tNow,
                };
                cache.set(cacheKey(lk.chainId, vsCurrency), entry);
                out[lk.chainId] = entry;
            }
        } catch (err) {
            spotErr = err && err.message ? String(err.message) : String(err);
            // Surface cached entries even on failure — better than blank
            // panels. New stale chains stay absent from `out`.
            for (const lk of stale) {
                const cached = cache.get(cacheKey(lk.chainId, vsCurrency));
                if (cached) out[lk.chainId] = cached;
            }
        }

        // Sparkline pass — only when requested, and only for chains
        // whose cached entry lacks sparkline data. Each chain costs one
        // request, so this is the expensive path; the 1-hour TTL means
        // a typical user pays it once per coin per session.
        if (includeSparkline) {
            await Promise.all(stale.map(async (lk) => {
                const cached = cache.get(cacheKey(lk.chainId, vsCurrency));
                if (cached?.sparkline) return;
                try {
                    const url = `${COINGECKO_BASE}/coins/${encodeURIComponent(lk.coingeckoId)}/market_chart?vs_currency=${encodeURIComponent(vsCurrency)}&days=7`;
                    const resp = await fetch(url);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const data = await resp.json();
                    const series = Array.isArray(data?.prices)
                        ? data.prices.map((pt) => Number(pt?.[1])).filter(Number.isFinite)
                        : null;
                    if (series && series.length > 0) {
                        const updated = {
                            ...(cached ?? {
                                priceFiat: null,
                                marketCapFiat: null,
                                change24hPct: null,
                                fetchedAt: tNow,
                            }),
                            sparkline: series,
                            fetchedAt: tNow,
                        };
                        cache.set(cacheKey(lk.chainId, vsCurrency), updated);
                        out[lk.chainId] = updated;
                    }
                } catch {
                    // Sparkline-only failure leaves the spot data intact.
                }
            }));
        }

        const result = /** @type {PriceOracleResult} */ ({ prices: out });
        if (spotErr) result.error = spotErr;
        return result;
    }

    function clearCache() {
        cache.clear();
    }

    return { getNativePrices, clearCache };
}

function cacheKey(chainId, vsCurrency) {
    return `${chainId}|${vsCurrency}`;
}

function numOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export const COINGECKO_SUPPORTED_CHAINS = Object.keys(COINGECKO_ID_BY_CHAIN);
