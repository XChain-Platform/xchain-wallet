// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The reachability sentence with its Details disclosure, drawn by the shell's
// notice and by a form that folds the sentence into its own merged notice, so
// Details stays one tap away wherever the sentence shows. Details name the
// affected coins and when they were last checked, without service names or
// network kinds.

import { useEffect, useId, useState } from 'react';
import { chainIconSmallUrl } from '../../branding/branding.js';
import { defaultRegistry } from '../../registry/index.js';
import { t } from '../../i18n/index.js';
import styles from './ReachabilityBanner.module.css';

const chainRegistry = defaultRegistry();

/**
 * @param {object} props
 * @param {string} props.text
 * @param {Array<{ key: string, name: string, iconUrl: string | null }>} props.coins
 * @param {number | null} [props.lastChecked]
 * @param {string | null} [props.resetKey]   Details close when this changes
 */
export function ReachabilityLine({ text, coins, lastChecked = null, resetKey = null }) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const panelId = useId();
    // Details belong to the screen they were opened on.
    useEffect(() => { setDetailsOpen(false); }, [resetKey]);
    const staleness = lastChecked
        ? `Last checked ${formatAgo(Date.now() - lastChecked)} ago.`
        : '';
    const hasDetails = coins.length > 0 || Boolean(staleness);
    return (
        <>
            <div className={styles.line}>
                {/* Only the state is announced, so a poll that refreshes the
                    last-checked age does not repeat the notice. */}
                <span role="status" aria-live="polite" aria-atomic="true">
                    {text}
                </span>
                {hasDetails ? (
                    <button
                        type="button"
                        className={styles.detailsToggle}
                        aria-expanded={detailsOpen ? 'true' : 'false'}
                        aria-controls={panelId}
                        onClick={() => setDetailsOpen((open) => !open)}
                    >
                        {t('components.reachabilityLine.details')}
                    </button>
                ) : null}
            </div>
            {hasDetails && detailsOpen ? (
                <div id={panelId} className={styles.detailPanel}>
                    {coins.length > 0 ? (
                        <ul className={styles.coinList} aria-label={t('components.reachabilityLine.affectedCoins')}>
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
        </>
    );
}

/**
 * The coins whose services are degraded or offline.
 *
 * @param {Array<{ chainId: string, mode?: string }> | undefined} perChain
 */
export function affectedCoins(perChain) {
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
