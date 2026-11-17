// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// usePriceAlertPrices: the current price behind each row of the Price Alerts
// list ("Now $68,412, 2.3% to go"). The reads follow the distinct assets, never
// the alerts: every coin is priced in one batched refresh per display
// currency, and each distinct token once, however many alerts name them.
// A price that has not landed (or an asset with no market) is null, and the
// row then shows no "Now" line.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
    getFiatRate,
    getTokenFiatRate,
    refreshFiatRates,
    refreshTokenFiatRate,
    subscribeFiatRates,
} from '../../flows/priceLookup.js';
import { defaultRegistry } from '../../registry/index.js';
import { tickerForDescriptor } from '../../registry/coinTicker.js';

const chainRegistry = defaultRegistry();

function describeAlertAsset(alert) {
    const descriptor = chainRegistry.get(alert.chainId);
    const chainCoin = descriptor?.coin;
    if (!chainCoin) return null;
    const nativeTicker = String(tickerForDescriptor(descriptor) || '').toUpperCase();
    const tick = String(alert.tick || '').trim().toUpperCase();
    const fiat = String(alert.fiatCurrency || 'usd').toUpperCase();
    const isToken = tick !== '' && tick !== nativeTicker;
    return { chainCoin, nativeTicker, tick, fiat, isToken };
}

function readPrice(asset) {
    if (!asset) return null;
    const hit = asset.isToken
        ? getTokenFiatRate({ chainCoin: asset.chainCoin, tick: asset.tick, fiatCurrency: asset.fiat })
        : getFiatRate({ chainCoin: asset.chainCoin, fiatCurrency: asset.fiat });
    const price = Number(hit?.rate);
    return Number.isFinite(price) && price > 0 ? price : null;
}

/**
 * @param {object} opts
 * @param {Array<{ chainId: string, tick?: string, fiatCurrency?: string }>} opts.alerts
 * @param {boolean} [opts.allowCoingeckoFallback]  pass privacy.priceDataEnabled !== false
 * @returns {(alert: { chainId: string, tick?: string, fiatCurrency?: string }) => number | null}
 */
export function usePriceAlertPrices({ alerts, allowCoingeckoFallback = true }) {
    // The distinct assets, as a string so the effect re-runs only when the set changes.
    const plan = useMemo(() => {
        const coinsByFiat = new Map();
        const tokens = new Map();
        for (const alert of alerts) {
            const asset = describeAlertAsset(alert);
            if (!asset) continue;
            if (asset.isToken) {
                tokens.set(`${asset.chainCoin}:${asset.tick}:${asset.fiat}`, asset);
            } else {
                if (!coinsByFiat.has(asset.fiat)) coinsByFiat.set(asset.fiat, new Set());
                coinsByFiat.get(asset.fiat).add(asset.chainCoin);
            }
        }
        const key = [
            ...[...coinsByFiat].map(([fiat, coins]) => `${fiat}=${[...coins].sort().join(',')}`).sort(),
            ...[...tokens.keys()].sort(),
        ].join('|');
        return { coinsByFiat, tokens, key };
    }, [alerts]);

    useEffect(() => {
        const controller = new AbortController();
        const quiet = () => { /* the cache keeps its last value; the row shows no price */ };
        for (const [fiat, coins] of plan.coinsByFiat) {
            refreshFiatRates({
                chainCoins: [...coins].sort(),
                fiatCurrency: fiat,
                allowCoingeckoFallback,
                signal: controller.signal,
            }).catch(quiet);
        }
        for (const asset of plan.tokens.values()) {
            refreshTokenFiatRate({
                chainCoin: asset.chainCoin,
                tick: asset.tick,
                nativeTicker: asset.nativeTicker,
                fiatCurrency: asset.fiat,
                allowCoingeckoFallback,
                signal: controller.signal,
            }).catch(quiet);
        }
        return () => controller.abort();
        // plan.key names the asset set; the plan object itself changes with every alerts array.
    }, [plan.key, allowCoingeckoFallback]);

    // One store subscription for every asset: the snapshot is a string that
    // changes exactly when a wanted rate does.
    const snapshot = useSyncExternalStore(
        subscribeFiatRates,
        () => {
            const parts = [];
            for (const [fiat, coins] of plan.coinsByFiat) {
                for (const chainCoin of coins) {
                    const r = getFiatRate({ chainCoin, fiatCurrency: fiat });
                    parts.push(`${chainCoin}/${fiat}=${r?.rate}@${r?.fetchedAt}`);
                }
            }
            for (const asset of plan.tokens.values()) {
                const r = getTokenFiatRate({ chainCoin: asset.chainCoin, tick: asset.tick, fiatCurrency: asset.fiat });
                parts.push(`${asset.chainCoin}:${asset.tick}/${asset.fiat}=${r?.rate}@${r?.fetchedAt}`);
            }
            return parts.join('|');
        },
    );

    // The returned function changes with the snapshot so a landed price re-renders its rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useCallback((alert) => readPrice(describeAlertAsset(alert)), [snapshot]);
}
