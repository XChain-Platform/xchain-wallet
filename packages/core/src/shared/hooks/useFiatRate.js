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

/**
 * Gate a coin-family fiat rate to the thing actually being priced .
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
    const t = String(tick || '').trim().toUpperCase();
    if (t.length === 0) return rate;
    // No native ticker resolved (descriptor still loading, or an unknown chain)
    // means we cannot prove the tick is the coin, so we must not price it.
    const n = String(nativeTicker || '').trim().toUpperCase();
    if (n.length === 0) return null;
    return t === n ? rate : null;
}
