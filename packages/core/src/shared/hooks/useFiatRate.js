// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useFiatRate: live §45 fiat rate for a coin family. Subscribes to the
// priceLookup cache (so a landed refresh re-renders the view) and kicks
// off an oracle-primary / CoinGecko-fallback refresh on mount and
// whenever the coin or currency changes. The refresh is internally
// TTL-throttled, so mounting many consumers stays cheap.

import { useEffect, useSyncExternalStore } from 'react';
import {
    getFiatRate,
    refreshFiatRates,
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
        refreshFiatRates({
            chainCoins: [chainCoin],
            fiatCurrency,
            allowCoingeckoFallback,
        }).catch(() => { /* cache keeps its last value; UI shows no fiat */ });
    }, [chainCoin, fiatCurrency, allowCoingeckoFallback]);

    return rate;
}
