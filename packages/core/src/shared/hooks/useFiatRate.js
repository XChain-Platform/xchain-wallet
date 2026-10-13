// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Live §45 fiat rates. Two hooks, and picking the right one matters:
// `useFiatRate` prices a COIN FAMILY, `useTickFiatRate` prices whatever
// tick a field is holding (coin or token). Anything rendering a fiat
// figure next to a user-entered amount wants the latter.
//
// useFiatRate: live §45 fiat rate for a coin family. Subscribes to the
// priceLookup cache (so a landed refresh re-renders the view) and kicks
// off an oracle-primary / CoinGecko-fallback refresh on mount and
// whenever the coin or currency changes. The refresh is internally
// TTL-throttled, so mounting many consumers stays cheap.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
    getFiatRate,
    getTokenFiatRate,
    refreshFiatRates,
    refreshTokenFiatRate,
    subscribeFiatRates,
} from '../../flows/priceLookup.js';

/**
 * @param {object} opts
 * @param {string | null | undefined} opts.chainCoin     coin family, e.g. 'bitcoin'
 * @param {string} [opts.fiatCurrency]                   default 'USD'
 * @param {boolean} [opts.allowCoingeckoFallback]        pass privacy.priceDataEnabled !== false
 * @returns {import('../../flows/priceLookup.js').FiatRate | null}
 */
export function useFiatRate({ chainCoin, fiatCurrency = 'USD', allowCoingeckoFallback = true } = {}) {
    const rate = useSyncExternalStore(
        subscribeFiatRates,
        () => (chainCoin ? getFiatRate({ chainCoin, fiatCurrency }) : null),
    );

    useEffect(() => {
        if (!chainCoin) return;
        const controller = new AbortController();
        refreshFiatRates({
            chainCoins: [chainCoin],
            fiatCurrency,
            allowCoingeckoFallback,
            signal: controller.signal,
        }).catch(() => { /* cache keeps its last value; UI shows no fiat */ });
        return () => controller.abort();
    }, [chainCoin, fiatCurrency, allowCoingeckoFallback]);

    return rate;
}

/**
 * Gate a coin-family fiat rate to the thing actually being priced.
 *
 * `useFiatRate` prices a COIN FAMILY: BTC, LTC, DOGE. It knows nothing about
 * tokens. Handing its rate to a field that is holding a token amount prices
 * that amount as if it were the coin, so 50,000 XCHAIN renders as billions of
 * dollars. The number is not merely imprecise, it is off by whatever the
 * coin/token ratio happens to be, and it renders with the same confident
 * "≈ $X.XX" styling as a correct one.
 *
 * The rule, therefore: a rate is only valid for the coin it was fetched for.
 * An empty tick means the native coin (every form treats a blank token field
 * that way), and a tick equal to the chain's native ticker is the same thing
 * spelled out. Anything else is a token and gets null, which is AmountField's
 * documented "hide the fiat toggle and the ≈ preview" input.
 *
 * Returning null rather than a guess is the whole point. There IS a real
 * per-tick rate for some tokens (XCHAIN, DEX-priced pairs) and sourcing it is
 * worthwhile, but it is a separate feature; until it exists, showing nothing
 * is the only honest option.
 *
 * @param {object} opts
 * @param {import('../../flows/priceLookup.js').FiatRate | null | undefined} opts.rate
 * @param {string | null | undefined} opts.tick           empty/blank = the native coin
 * @param {string | null | undefined} opts.nativeTicker   e.g. 'BTC'; unknown = fail closed
 * @returns {import('../../flows/priceLookup.js').FiatRate | null}
 */
export function fiatRateForTick({ rate, tick, nativeTicker }) {
    if (!rate) return null;
    return classifyTick({ tick, nativeTicker }) === 'native' ? rate : null;
}

/**
 * What is this tick, as far as pricing is concerned?
 *
 *   'native'   the chain's coin: blank (every form's shorthand for it) or
 *              spelled out as the chain's ticker. Priced by `useFiatRate`.
 *   'token'    something else, needing a rate of its own.
 *   'unknown'  a tick we cannot classify because the chain's native ticker
 *              has not resolved (descriptor still loading, unknown chain).
 *              Fails closed: neither rate may be applied to it.
 *
 * @returns {'native' | 'token' | 'unknown'}
 */
function classifyTick({ tick, nativeTicker }) {
    const t = String(tick || '').trim().toUpperCase();
    if (t.length === 0) return 'native';
    const n = String(nativeTicker || '').trim().toUpperCase();
    if (n.length === 0) return 'unknown';
    return t === n ? 'native' : 'token';
}

/**
 * The fiat rate for whatever tick a field is actually holding.
 *
 * This is the hook an AmountField consumer wants. `useFiatRate` answers
 * "what is one BTC worth", which is the right question only when the
 * amount beside it is denominated in BTC. This one answers "what is one
 * unit of THIS tick worth", coin or token, and returns null when nothing
 * can say. Null is AmountField's documented "hide the fiat toggle and the
 * ≈ preview" input, so an unpriceable token simply shows no fiat rather
 * than a confidently formatted wrong one.
 *
 * Token rates come from the price oracle when the token has its own USD
 * pair (XCHAIN), else from its DEX market against the native coin; see
 * flows/priceLookup.js. Both are refreshed lazily and TTL-throttled, so
 * a form may render once with null before a rate lands, which is the
 * same "no number yet" state the coin path already has.
 *
 * @param {object} opts
 * @param {string | null | undefined} opts.chainCoin     coin family, e.g. 'bitcoin'
 * @param {string | null | undefined} opts.tick          empty/blank = the native coin
 * @param {string | null | undefined} opts.nativeTicker  e.g. 'BTC'; unknown = fail closed
 * @param {string} [opts.fiatCurrency]                   default 'USD'
 * @param {boolean} [opts.allowCoingeckoFallback]        pass privacy.priceDataEnabled !== false
 * @returns {import('../../flows/priceLookup.js').FiatRate | null}
 */
export function useTickFiatRate({
    chainCoin,
    tick,
    nativeTicker,
    fiatCurrency = 'USD',
    allowCoingeckoFallback = true,
} = {}) {
    const coinRate = useFiatRate({ chainCoin, fiatCurrency, allowCoingeckoFallback });
    const kind = classifyTick({ tick, nativeTicker });
    const isToken = kind === 'token';

    // Same store, so a landed token refresh re-renders exactly like a coin one.
    const tokenRate = useSyncExternalStore(
        subscribeFiatRates,
        () => (isToken && chainCoin ? getTokenFiatRate({ chainCoin, tick, fiatCurrency }) : null),
    );

    useEffect(() => {
        if (!isToken || !chainCoin) return;
        const controller = new AbortController();
        refreshTokenFiatRate({
            chainCoin,
            tick,
            nativeTicker,
            fiatCurrency,
            allowCoingeckoFallback,
            signal: controller.signal,
        }).catch(() => { /* cache keeps its last value; UI shows no fiat */ });
        return () => controller.abort();
    }, [isToken, chainCoin, tick, nativeTicker, fiatCurrency, allowCoingeckoFallback]);

    if (isToken) return tokenRate;
    return fiatRateForTick({ rate: coinRate, tick, nativeTicker });
}

/**
 * Live §45 rates for several coin families at once, keyed by family.
 *
 * Home prices one native row per chain the wallet holds, and the set of
 * chains is only known at render time, so it cannot call `useFiatRate`
 * once per coin. This reads every requested coin from the same cache in
 * one store subscription and refreshes them in one batched call.
 *
 * `refreshKey` re-runs the refresh when it changes. Home passes its
 * balance fetch time, so a refresh that failed at launch (offline, a
 * timeout) is retried on the next balance poll instead of leaving the
 * rows unpriced until a remount. The refresh is TTL-throttled, so a key
 * that changes every poll costs nothing while the cached rates are fresh.
 *
 * @param {object} opts
 * @param {string[]} opts.chainCoins                     coin families, e.g. ['bitcoin', 'litecoin']
 * @param {string} [opts.fiatCurrency]                   default 'USD'
 * @param {boolean} [opts.allowCoingeckoFallback]        pass privacy.priceDataEnabled !== false
 * @param {boolean} [opts.refreshEnabled]                false reads cached rates without network work
 * @param {unknown} [opts.refreshKey]                    any value; a change triggers a refresh
 * @returns {Record<string, import('../../flows/priceLookup.js').FiatRate>}
 */
export function useNativeFiatRates({
    chainCoins,
    fiatCurrency = 'USD',
    allowCoingeckoFallback = true,
    refreshEnabled = true,
    refreshKey,
} = {}) {
    const coins = Array.isArray(chainCoins)
        ? Array.from(new Set(chainCoins.filter((c) => typeof c === 'string' && c.length > 0))).sort()
        : [];
    const coinKey = coins.join(',');

    // The snapshot is a string so useSyncExternalStore compares it by value;
    // it changes exactly when a requested coin's cached rate object changes.
    const snapshot = useSyncExternalStore(
        subscribeFiatRates,
        () => coins
            .map((coin) => {
                const r = getFiatRate({ chainCoin: coin, fiatCurrency });
                return r ? `${coin}=${r.rate}@${r.fetchedAt}:${r.stale === true}` : `${coin}=`;
            })
            .join('|'),
    );

    useEffect(() => {
        if (coinKey.length === 0 || !refreshEnabled) return;
        const controller = new AbortController();
        refreshFiatRates({
            chainCoins: coinKey.split(','),
            fiatCurrency,
            allowCoingeckoFallback,
            signal: controller.signal,
        }).catch(() => { /* cache keeps its last value; rows stay unpriced */ });
        return () => controller.abort();
    }, [coinKey, fiatCurrency, allowCoingeckoFallback, refreshEnabled, refreshKey]);

    return useMemo(() => {
        /** @type {Record<string, import('../../flows/priceLookup.js').FiatRate>} */
        const out = {};
        for (const coin of coinKey.length > 0 ? coinKey.split(',') : []) {
            const r = getFiatRate({ chainCoin: coin, fiatCurrency });
            if (r) out[coin] = r;
        }
        return out;
    }, [snapshot, coinKey, fiatCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Live fiat rates for token rows, keyed by coin family and tick.
 *
 * Home cannot call `useTickFiatRate` once per row because its token set changes
 * between balance polls. This hook subscribes once, refreshes each requested
 * token through the same per-tick lookup, and returns only rates that actually
 * exist. Missing token markets therefore remain missing instead of inheriting
 * the chain coin's rate.
 *
 * @param {object} opts
 * @param {Array<{chainCoin: string, tick: string, nativeTicker: string}>} opts.tokens
 * @param {string} [opts.fiatCurrency]
 * @param {boolean} [opts.allowCoingeckoFallback]
 * @param {boolean} [opts.refreshEnabled]
 * @param {unknown} [opts.refreshKey]
 * @returns {Record<string, import('../../flows/priceLookup.js').FiatRate>}
 */
export function useTokenFiatRates({
    tokens,
    fiatCurrency = 'USD',
    allowCoingeckoFallback = true,
    refreshEnabled = true,
    refreshKey,
} = {}) {
    const wanted = Array.isArray(tokens)
        ? Array.from(new Map(tokens
            .filter((t) => t?.chainCoin && t?.tick && t?.nativeTicker)
            .map((t) => [`${t.chainCoin}|${String(t.tick).toUpperCase()}`, {
                chainCoin: t.chainCoin,
                tick: String(t.tick).toUpperCase(),
                nativeTicker: String(t.nativeTicker).toUpperCase(),
            }])).values())
            .sort((a, b) => `${a.chainCoin}|${a.tick}`.localeCompare(`${b.chainCoin}|${b.tick}`))
        : [];
    const tokenKey = wanted.map((t) => `${t.chainCoin}|${t.tick}|${t.nativeTicker}`).join(',');

    const snapshot = useSyncExternalStore(
        subscribeFiatRates,
        () => wanted.map((t) => {
            const rate = getTokenFiatRate({
                chainCoin: t.chainCoin,
                tick: t.tick,
                fiatCurrency,
            });
            return rate
                ? `${t.chainCoin}|${t.tick}=${rate.rate}@${rate.fetchedAt}:${rate.stale === true}`
                : `${t.chainCoin}|${t.tick}=`;
        }).join(','),
    );

    useEffect(() => {
        if (wanted.length === 0 || !refreshEnabled) return;
        const controller = new AbortController();
        Promise.all(wanted.map((t) => refreshTokenFiatRate({
            ...t,
            fiatCurrency,
            allowCoingeckoFallback,
            signal: controller.signal,
        }))).catch(() => { /* individual misses leave their rows unpriced */ });
        return () => controller.abort();
    }, [tokenKey, fiatCurrency, allowCoingeckoFallback, refreshEnabled, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

    return useMemo(() => {
        const out = {};
        for (const token of wanted) {
            const rate = getTokenFiatRate({
                chainCoin: token.chainCoin,
                tick: token.tick,
                fiatCurrency,
            });
            if (rate) out[`${token.chainCoin}|${token.tick}`] = rate;
        }
        return out;
    }, [snapshot, tokenKey, fiatCurrency]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Attach live coin rates to native balance rows that have none.
 *
 * Real balance reads (flows/balances.js) carry no price, so every native
 * row built from them arrives with `fiatRate: null` and the Home hero
 * counted it as unpriced. This fills the rate in from the coin's live
 * §45 rate, keyed by the chain's coin family.
 *
 * A numeric `fiatRate` already on a row is kept: demo fixtures price
 * themselves. A row whose balance could not be read at all
 * (`unavailable === 'all'`) stays unpriced, because its quantity is a
 * placeholder zero and pricing it would state a $0.00 the wallet does
 * not know. Tokens are left alone; a coin rate never prices a token.
 *
 * @template {{ kind: string, chainId: string, fiatRate: number | null, unavailable?: string }} R
 * @param {R[]} rows
 * @param {Record<string, { rate: number }>} ratesByCoin   coin family -> FiatRate
 * @returns {R[]}  the same array when nothing changes, else a new one
 */
export function priceNativeRows(rows, ratesByCoin) {
    if (!Array.isArray(rows) || !ratesByCoin) return rows;
    let changed = false;
    const out = rows.map((row) => {
        if (!row || row.kind !== 'native') return row;
        if (typeof row.fiatRate === 'number') return row;
        if (row.unavailable === 'all') return row;
        const id = String(row.chainId || '');
        const dash = id.indexOf('-');
        const coin = dash > 0 ? id.slice(0, dash) : id;
        const fiatRate = ratesByCoin[coin];
        const rate = fiatRate?.rate;
        if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return row;
        changed = true;
        return {
            ...row,
            fiatRate: rate,
            fiatRateSource: fiatRate.source,
            fiatRateFetchedAt: fiatRate.fetchedAt,
            fiatRateStale: fiatRate.stale === true,
        };
    });
    return changed ? out : rows;
}

/**
 * Attach per-token rates to unpriced token rows.
 *
 * Existing numeric rates belong to demo fixtures and remain authoritative.
 * Native rows are never considered, and a missing per-token rate leaves the
 * row untouched so neither its fiat display nor the portfolio total can fall
 * back to a coin-family price.
 *
 * @template {{ kind: string, chainId: string, tick: string, fiatRate: number | null }} R
 * @param {R[]} rows
 * @param {Record<string, import('../../flows/priceLookup.js').FiatRate>} ratesByToken
 * @returns {R[]}
 */
export function priceTokenRows(rows, ratesByToken) {
    if (!Array.isArray(rows) || !ratesByToken) return rows;
    let changed = false;
    const out = rows.map((row) => {
        if (!row || row.kind === 'native') return row;
        if (typeof row.fiatRate === 'number') return row;
        const id = String(row.chainId || '');
        const dash = id.indexOf('-');
        const coin = dash > 0 ? id.slice(0, dash) : id;
        const rate = ratesByToken[`${coin}|${String(row.tick || '').toUpperCase()}`];
        if (!rate || typeof rate.rate !== 'number' || !Number.isFinite(rate.rate) || rate.rate <= 0) {
            return row;
        }
        changed = true;
        return {
            ...row,
            fiatRate: rate.rate,
            fiatRateSource: rate.source,
            fiatRateFetchedAt: rate.fetchedAt,
            fiatRateStale: rate.stale === true,
            change24hPct: Number.isFinite(rate.change24hPct) ? rate.change24hPct : null,
        };
    });
    return changed ? out : rows;
}
