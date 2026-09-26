// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useOracleFeeds: the published feeds of every oracle a list of Mode B
// dispensers names, read once per (chain, oracle) pair and shared by every
// row naming it, so a list can price those rows without a read per row.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isOraclePricedRow } from '../utils/dispenserPricing.js';

/**
 * @param {any} messaging
 * @param {Array<{ chainId: string, row: any }>} entries  dispenser rows with their chain
 * @returns {(chainId: string, row: any) => any[] | null | undefined}  a row's
 *   oracle feeds: undefined while unread, null when the host cannot read feeds
 */
export function useOracleFeeds(messaging, entries) {
    const supported = typeof messaging?.oracleFeeds === 'function';
    const [feedsByKey, setFeedsByKey] = useState(/** @type {Record<string, any[]>} */ ({}));
    const requestedRef = useRef(/** @type {Set<string>} */ (new Set()));
    // Unmount-only guard: entries change as each chain resolves, and a
    // per-run cancel would drop a read already marked as requested, leaving
    // its rows on "checking" for good.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);
    useEffect(() => {
        if (!supported) return;
        for (const { chainId, row } of entries || []) {
            if (!chainId || !isOraclePricedRow(row)) continue;
            const key = `${chainId}::${row.oracle_address}`;
            if (requestedRef.current.has(key)) continue;
            requestedRef.current.add(key);
            Promise.resolve(messaging.oracleFeeds({ chainId, address: row.oracle_address }))
                .then((feeds) => Array.isArray(feeds) ? feeds : [])
                .catch(() => [])
                .then((feeds) => {
                    if (mountedRef.current) setFeedsByKey((prev) => ({ ...prev, [key]: feeds }));
                });
        }
    }, [entries, messaging, supported]);
    return useCallback((chainId, row) => {
        if (!isOraclePricedRow(row)) return undefined;
        if (!supported) return null;
        return feedsByKey[`${chainId}::${row.oracle_address}`];
    }, [feedsByKey, supported]);
}
