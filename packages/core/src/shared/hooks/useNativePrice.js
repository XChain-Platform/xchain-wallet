// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// useNativePrice — fetch + cache the price oracle response for a
// single chainId. Wraps `messaging.getNativePricesRequest` and surfaces
// the per-chain entry alongside loading / error / disabled state.
//
// Disabled state: when the user has flipped
// `settings.privacy.priceDataEnabled` off, the host returns
// `{ disabled: true }`. The hook surfaces that so the calling UI can
// hide the stats strip + chart with a single condition.
//
// Sparkline is opt-in via `includeSparkline`. Cheap pages that just
// want the spot price omit it; the TokenDetail chart panel sets it
// true.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * @typedef {Object} NativePriceEntry
 * @property {number | null} priceFiat
 * @property {number | null} marketCapFiat
 * @property {number | null} change24hPct
 * @property {number[] | null} sparkline
 * @property {number} fetchedAt
 */

/**
 * @typedef {Object} UseNativePriceResult
 * @property {NativePriceEntry | null} entry
 * @property {boolean} loading
 * @property {boolean} disabled         true when the user has opted out
 * @property {string | null} error
 */

/**
 * @param {string | null} chainId
 * @param {{ includeSparkline?: boolean }} [opts]
 * @returns {UseNativePriceResult}
 */
export function useNativePrice(chainId, opts = {}) {
    const includeSparkline = Boolean(opts.includeSparkline);
    const { messaging } = useMessaging();
    const [entry, setEntry] = useState(/** @type {NativePriceEntry | null} */ (null));
    const [loading, setLoading] = useState(false);
    const [disabled, setDisabled] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        if (!chainId) {
            setEntry(null);
            setDisabled(false);
            setError(null);
            return undefined;
        }
        if (typeof messaging?.getNativePricesRequest !== 'function') {
            // Host doesn't expose the route — treat as disabled so the
            // UI hides the strip rather than spinning forever.
            setDisabled(true);
            return undefined;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        messaging.getNativePricesRequest({ chainIds: [chainId], includeSparkline })
            .then((result) => {
                if (cancelled) return;
                if (result?.disabled) {
                    setDisabled(true);
                    setEntry(null);
                    setError(null);
                    return;
                }
                setDisabled(false);
                setEntry(result?.prices?.[chainId] ?? null);
                setError(result?.error ?? null);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err?.message || 'Price fetch failed');
                setEntry(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [chainId, includeSparkline, messaging]);

    return { entry, loading, disabled, error };
}
