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
// Mounted near the app root above the route surface. Hidden when the
// last reachability poll reported `'normal'`; renders a status banner
// when the wallet is in degraded or offline mode. The banner itself
// drives no UI gating; features that need encoder/hub already disable
// themselves with their own per-feature affordances. The banner is the
// "you're not getting fresh data" notice the spec calls out.
//
// Polls via `useReachability` so a single network round-trip per
// `intervalMs` services every banner / staleness label / etc. that
// shares this hook (the hook returns identical state to every caller
// once Messaging caches kick in; until then each mount probes
// independently; that's tolerable given typical mount counts).

import { useReachability } from '../hooks/useReachability.js';
import styles from './ReachabilityBanner.module.css';

/**
 * @param {object} [props]
 * @param {string[]} [props.chainIds]   override chain set (otherwise read from settings.fees)
 * @param {number} [props.intervalMs]   override poll cadence
 */
export function ReachabilityBanner({ chainIds, intervalMs }) {
    const { overall, perChain, refresh, lastChecked } = useReachability({
        chainIds,
        intervalMs,
    });

    if (overall !== 'degraded' && overall !== 'offline') return null;

    const summary = summariseDegradation(perChain);
    const staleness = lastChecked
        ? `Last checked ${formatAgo(Date.now() - lastChecked)} ago.`
        : null;

    return (
        <div
            role="status"
            aria-live="polite"
            className={`${styles.banner} ${overall === 'offline' ? styles.offline : styles.degraded}`}
        >
            <span className={styles.icon} aria-hidden="true">
                {overall === 'offline' ? '⛔' : '⚠'}
            </span>
            <div className={styles.body}>
                <div className={styles.title}>
                    {overall === 'offline'
                        ? "You're offline"
                        : "You're in degraded mode"}
                </div>
                <div className={styles.detail}>
                    {summary}
                    {staleness ? <span className={styles.staleness}> {staleness}</span> : null}
                </div>
            </div>
            <button
                type="button"
                className={styles.retry}
                onClick={refresh}
                aria-label="Retry reachability probe"
            >
                Retry
            </button>
        </div>
    );
}

// Plain-language summaries only: internal backend service names (encoder /
// hub / explorer) and dev vocabulary like "endpoint configuration" never
// belong in user copy. Per-chain detail stays at "partly" vs "fully" down.
function summariseDegradation(perChain) {
    if (!Array.isArray(perChain) || perChain.length === 0) {
        return "Can't reach the network. Check your internet connection.";
    }
    const offline = perChain.filter((c) => c.mode === 'offline');
    const degraded = perChain.filter((c) => c.mode === 'degraded');
    if (offline.length === perChain.length) {
        return "Can't reach the network on any active chain.";
    }
    const summaries = [];
    for (const c of degraded) {
        if (countUnreachable(c) > 0) {
            summaries.push(`${c.chainId}: partly unavailable; some features may not work.`);
        }
    }
    for (const c of offline) {
        summaries.push(`${c.chainId}: can't reach the network.`);
    }
    if (summaries.length === 0) {
        return 'Part of the network is unavailable right now.';
    }
    return summaries.join(' ');
}

function countUnreachable(chainResult) {
    const services = chainResult?.services || {};
    let n = 0;
    for (const name of ['encoder', 'hub', 'explorer']) {
        if (services[name] === 'unreachable') n += 1;
    }
    return n;
}

function formatAgo(diffMs) {
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    return `${Math.round(diffMs / 3_600_000)}h`;
}
