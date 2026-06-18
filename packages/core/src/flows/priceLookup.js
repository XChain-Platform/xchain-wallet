// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Price lookup: bridges to the §45 PRICE oracle that lands later.
//
// Returns a fiat conversion rate for a chain's native coin against the
// user's chosen fiat currency. Until §45 wires the real on-chain
// oracle, the function reads from a small in-process table marked as
// STATIC PLACEHOLDER. Callers must surface the `source` field so users
// don't mistake placeholder rates for live feeds.
//
// The returned shape `{ rate, source, fiatCurrency, fetchedAt }` is what
// the eventual oracle implementation will return; only the data source
// changes. UI code written against this contract today will keep
// working when the oracle lands.

const PLACEHOLDER_RATES_USD = /** @type {const} */ ({
    bitcoin: 40000,
    litecoin: 80,
    dogecoin: 0.10,
});

/**
 * @typedef {object} FiatRate
 * @property {number} rate           units of `fiatCurrency` per 1 native coin
 * @property {string} chainCoin      coin family the rate is for (matches descriptor.coin)
 * @property {string} fiatCurrency   ISO-style currency code (USD, EUR, …)
 * @property {'static-placeholder' | 'oracle' | 'user'} source
 * @property {string} fetchedAt      ISO timestamp; for placeholder rates this is the build date
 */

const PLACEHOLDER_FETCHED_AT = '2026-04-26T00:00:00Z';

/**
 * Look up a fiat rate for the chain's native coin. Returns null when
 * no rate is available in the placeholder table or when the requested
 * fiat currency isn't USD (the placeholder table is single-currency).
 *
 * @param {object} opts
 * @param {string} opts.chainCoin
 * @param {string} [opts.fiatCurrency]   default 'USD'
 * @returns {FiatRate | null}
 */
export function getFiatRate({ chainCoin, fiatCurrency = 'USD' } = {}) {
    if (typeof chainCoin !== 'string' || chainCoin.length === 0) return null;
    if (fiatCurrency !== 'USD') return null;
    const rate = PLACEHOLDER_RATES_USD[chainCoin];
    if (typeof rate !== 'number') return null;
    return {
        rate,
        chainCoin,
        fiatCurrency,
        source: 'static-placeholder',
        fetchedAt: PLACEHOLDER_FETCHED_AT,
    };
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
    return Number(coin.toFixed(decimals)).toString();
}
