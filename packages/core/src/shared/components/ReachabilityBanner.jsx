// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ReachabilityBanner: §49.1 / §49.2 / G152.
//
// The compact notice sits below persistent app chrome and reports only the
// user-facing consequence. Its Details disclosure identifies affected coins
// and when they were last checked, without service names or network kinds.

import { useReachability } from '../hooks/useReachability.js';
import { branding as brandingLib, registry as registryLib } from '../../index.js';
import styles from './ReachabilityBanner.module.css';

const chainRegistry = registryLib.defaultRegistry();

/**
 * @param {object} [props]
 * @param {string[]} [props.chainIds]   override chain set (otherwise read from settings.fees)
 * @param {number} [props.intervalMs]   override poll cadence
 * @param {number} [props.confirmMs]    override the corroborating-probe delay
 * @param {number} [props.startupGraceMs] override the cold-start silence window
 */
export function ReachabilityBanner({ chainIds, intervalMs, confirmMs, startupGraceMs }) {
    const { loading, overall, perChain, refresh, lastChecked } = useReachability({
        chainIds,
        intervalMs,
        confirmMs,
        startupGraceMs,
    });

    if (overall !== 'degraded' && overall !== 'offline') return null;

    const coins = affectedCoins(perChain);
    const staleness = lastChecked
        ? `Last checked ${formatAgo(Date.now() - lastChecked)} ago.`
        : '';

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`${styles.banner} ${overall === 'offline' ? styles.offline : styles.degraded}`}
        >
            <span className={styles.message}>Some balances may be out of date</span>
            <button
                type="button"
                className={styles.retry}
                onClick={refresh}
                disabled={loading}
            >
                {loading ? 'Checking…' : 'Try again'}
            </button>
            {coins.length > 0 || staleness ? (
                <details className={styles.details}>
                    <summary className={styles.detailsToggle}>Details</summary>
                    <div className={styles.detailPanel}>
                        {coins.length > 0 ? (
                            <ul className={styles.coinList} aria-label="Affected coins">
                                {coins.map((coin) => (
                                    <li key={coin.key} className={styles.coin}>
                                        {coin.iconUrl ? (
                                            <img src={coin.iconUrl} alt="" aria-hidden="true" />
                                        ) : (
                                            <span className={styles.coinFallback} aria-hidden="true" />
                                        )}
                                        <span>{coin.name}</span>
                                    </li>
                                ))}
                            </ul>
                        ) : null}
                        {staleness ? <p className={styles.staleness}>{staleness}</p> : null}
                    </div>
                </details>
            ) : null}
        </div>
    );
}

function affectedCoins(perChain) {
    if (!Array.isArray(perChain)) return [];
    const seen = new Set();
    const coins = [];
    for (const chain of perChain) {
        if (chain?.mode !== 'degraded' && chain?.mode !== 'offline') continue;
        const descriptor = chainRegistry.get(chain.chainId);
        const key = descriptor?.coin || coinNameFromChainId(chain.chainId).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        coins.push({
            key,
            name: descriptor?.displayName || coinNameFromChainId(chain.chainId),
            iconUrl: brandingLib.chainIconSmallUrl(
                descriptor?.coin ? `${descriptor.coin}-mainnet` : chain.chainId,
            ),
        });
    }
    return coins;
}

function formatAgo(diffMs) {
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    return `${Math.round(diffMs / 3_600_000)}h`;
}

function coinNameFromChainId(chainId) {
    const coin = String(chainId || 'Unknown').split('-')[0];
    return `${coin.charAt(0).toUpperCase()}${coin.slice(1)}`;
}
