// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { getTokenFiatRate, refreshTokenFiatRate } from '../flows/priceLookup.js';
import { tickerForDescriptor } from '../registry/coinTicker.js';

/**
 * Adapt the shared token fiat-rate cache to PriceAlertWatcher's batch shape.
 * Missing chains, invalid ticks, and unavailable markets remain explicit nulls.
 *
 * @param {object} deps
 * @param {{ get(chainId: string): ({ coin?: string, nativeTicker?: string } | undefined) }} deps.chainRegistry
 * @param {() => boolean} [deps.allowCoingeckoFallback]
 */
export function createTokenPriceLookup({ chainRegistry, allowCoingeckoFallback = () => true } = {}) {
    return async function getTokenPrices({ items, fiatCurrency } = {}) {
        const wanted = Array.isArray(items) ? items : [];
        const currency = String(fiatCurrency || 'usd').toUpperCase();
        const unique = Array.from(new Map(wanted.map((item) => {
            const chainId = String(item?.chainId || '');
            const tick = String(item?.tick || '').trim().toUpperCase();
            return [`${chainId}::${tick}`, { chainId, tick }];
        })).values());
        const fallbackAllowed = allowCoingeckoFallback() !== false;

        const entries = await Promise.all(unique.map(async ({ chainId, tick }) => {
            const key = `${chainId}::${tick}`;
            const descriptor = chainRegistry?.get?.(chainId);
            const chainCoin = descriptor?.coin;
            const nativeTicker = tickerForDescriptor(descriptor);
            if (!chainCoin || !tick || !nativeTicker) return [key, null];

            try {
                await refreshTokenFiatRate({
                    chainCoin,
                    tick,
                    nativeTicker,
                    fiatCurrency: currency,
                    allowCoingeckoFallback: fallbackAllowed,
                });
            } catch {
                return [key, null];
            }

            const rate = getTokenFiatRate({ chainCoin, tick, fiatCurrency: currency });
            const priceFiat = Number(rate?.rate);
            const fetchedAt = Date.parse(rate?.fetchedAt);
            if (!Number.isFinite(priceFiat) || priceFiat <= 0 || !Number.isFinite(fetchedAt)) {
                return [key, null];
            }
            return [key, { priceFiat, fetchedAt }];
        }));

        return { prices: Object.fromEntries(entries) };
    };
}
