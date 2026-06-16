// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// usePriceAlerts — §46 price-alert CRUD hook. Wraps the per-wallet
// messaging routes (priceAlert.*), mirroring how MarketsList consumes the
// watchlist routes. Shells whose messaging module predates these routes
// surface `supported: false` so the UI degrades to a "not available" note
// rather than throwing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * @typedef {Object} UsePriceAlertsResult
 * @property {import('../../schemas/priceAlert.js').PriceAlert[]} alerts
 * @property {boolean} loading
 * @property {boolean} supported     false when the shell lacks the routes
 * @property {string | null} error
 * @property {(input: { chainId: string, direction: 'above'|'below', targetFiat: number, fiatCurrency: string }) => Promise<void>} addAlert
 * @property {(id: string) => Promise<void>} removeAlert
 * @property {(id: string) => Promise<void>} rearm
 * @property {() => Promise<void>} reload
 */

/**
 * @param {string | null | undefined} walletId
 * @returns {UsePriceAlertsResult}
 */
export function usePriceAlerts(walletId) {
    const { messaging } = useMessaging();
    const [alerts, setAlerts] = useState(/** @type {any[]} */ ([]));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const aliveRef = useRef(true);

    const supported = typeof messaging?.listPriceAlertsForWallet === 'function'
        && typeof messaging?.savePriceAlert === 'function'
        && typeof messaging?.clearPriceAlert === 'function';

    const reload = useCallback(async () => {
        if (!walletId || !supported) {
            setAlerts([]);
            return;
        }
        setLoading(true);
        try {
            const rows = await messaging.listPriceAlertsForWallet({ walletId });
            if (!aliveRef.current) return;
            setAlerts(Array.isArray(rows) ? rows : []);
            setError(null);
        } catch (err) {
            if (!aliveRef.current) return;
            setError(err?.message || 'Could not load price alerts');
            setAlerts([]);
        } finally {
            if (aliveRef.current) setLoading(false);
        }
    }, [walletId, supported, messaging]);

    useEffect(() => {
        aliveRef.current = true;
        reload();
        return () => { aliveRef.current = false; };
    }, [reload]);

    const addAlert = useCallback(async ({ chainId, direction, targetFiat, fiatCurrency }) => {
        if (!walletId || !supported) return;
        await messaging.savePriceAlert({ walletId, chainId, direction, targetFiat, fiatCurrency });
        await reload();
    }, [walletId, supported, messaging, reload]);

    const removeAlert = useCallback(async (id) => {
        if (!supported) return;
        await messaging.clearPriceAlert({ id });
        await reload();
    }, [supported, messaging, reload]);

    const rearm = useCallback(async (id) => {
        if (!supported || typeof messaging?.rearmPriceAlert !== 'function') return;
        await messaging.rearmPriceAlert({ id });
        await reload();
    }, [supported, messaging, reload]);

    return { alerts, loading, supported, error, addAlert, removeAlert, rearm, reload };
}
