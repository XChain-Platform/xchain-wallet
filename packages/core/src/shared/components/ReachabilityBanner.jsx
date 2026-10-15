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
// The compact notice is the first row of the page content, below the page
// header, and reports only the user-facing consequence. Its Details disclosure identifies affected coins
// and when they were last checked, without service names or network kinds.

import { useContext, useEffect, useId, useState } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useReachability } from '../hooks/useReachability.js';
import { chainIconSmallUrl } from '../../branding/branding.js';
import { defaultRegistry } from '../../registry/index.js';
import { NoticesRouteContext, ReachabilityNoticeHiddenContext } from './noticesRoute.js';
import styles from './ReachabilityBanner.module.css';

const chainRegistry = defaultRegistry();

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
    const [detailsOpen, setDetailsOpen] = useState(false);
    const panelId = useId();
    // Details belong to the screen they were opened on.
    const routeKey = useContext(NoticesRouteContext);
    useEffect(() => { setDetailsOpen(false); }, [routeKey]);
    // A screen that already says its balances could not be checked takes
    // the place of this notice; the probe keeps running underneath.
    const hiddenByScreen = useContext(ReachabilityNoticeHiddenContext);

    if (hiddenByScreen || (overall !== 'degraded' && overall !== 'offline')) return null;

    const coins = affectedCoins(perChain);
    const staleness = lastChecked
        ? `Last checked ${formatAgo(Date.now() - lastChecked)} ago.`
        : '';

    const hasDetails = coins.length > 0 || Boolean(staleness);

    // The notice is a StatusMessage so it looks like every other notice. The
    // Details panel sits in the message's own flow, so it pushes route content
    // down instead of floating over it or scrolling inside the notice.
    return (
        <StatusMessage
            variant={overall === 'offline' ? 'error' : 'warning'}
            role={null}
            recovery={{
                label: loading ? 'Checking…' : 'Try again',
                onAction: refresh,
                disabled: loading,
            }}
        >
            <div className={styles.line}>
                {/* Only the state is announced, so a poll that refreshes the
                    last-checked age does not repeat the notice. */}
                <span role="status" aria-live="polite" aria-atomic="true">
                    Some balances may be out of date
                </span>
                {hasDetails ? (
                    <button
                        type="button"
                        className={styles.detailsToggle}
                        aria-expanded={detailsOpen ? 'true' : 'false'}
                        aria-controls={panelId}
                        onClick={() => setDetailsOpen((open) => !open)}
                    >
                        Details
                    </button>
                ) : null}
            </div>
            {hasDetails && detailsOpen ? (
                <div id={panelId} className={styles.detailPanel}>
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
            ) : null}
        </StatusMessage>
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
            iconUrl: chainIconSmallUrl(
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
