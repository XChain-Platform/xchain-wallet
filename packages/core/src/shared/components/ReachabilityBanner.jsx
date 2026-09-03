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
import { registry as registryLib } from '../../index.js';
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
    const { overall, perChain, refresh, lastChecked } = useReachability({
        chainIds,
        intervalMs,
        confirmMs,
        startupGraceMs,
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

// What an unreachable backend actually COSTS the user. The service names
// themselves (encoder / hub / explorer) stay out of the copy, because they
// are our vocabulary and not the user's; what replaces them is not a name at
// all but the consequence, which is the part someone stuck on a form needs.
//
// "partly unavailable; some features may not work" told a first-time user
// nothing: on 2026-09-02 one was blocked by the fee-price half of exactly
// this banner and had no way to learn that from it. The probe result already
// carries which service failed, so the answer was in hand and thrown away.
const CONSEQUENCE = {
    encoder: "you can't send or create transactions",
    hub: 'fee prices are unavailable',
    explorer: 'balances and history may be out of date',
};

// Chain ids are ours too: "bitcoin-testnet" is a config key, not something to
// show a person. Fall back to the raw id only for a chain the registry does
// not know, where a wrong-but-recognisable string beats an empty one.
function chainLabel(chainId) {
    const d = chainRegistry.get(chainId);
    if (!d || !d.displayName) return chainId;
    return d.networkKind && d.networkKind !== 'mainnet'
        ? `${d.displayName} ${d.networkKind}`
        : d.displayName;
}

// "a", "a and b", "a, b and c".
function joinList(items) {
    if (items.length <= 1) return items[0] || '';
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

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
        const effects = consequencesFor(c);
        if (effects.length > 0) {
            summaries.push(`On ${chainLabel(c.chainId)}, ${joinList(effects)}.`);
        }
    }
    for (const c of offline) {
        summaries.push(`${chainLabel(c.chainId)}: can't reach the network.`);
    }
    if (summaries.length === 0) {
        return 'Part of the network is unavailable right now.';
    }
    return summaries.join(' ');
}

function consequencesFor(chainResult) {
    const services = chainResult?.services || {};
    const out = [];
    // Ordered by how much the user cares, not alphabetically: being unable to
    // spend outranks a stale balance.
    for (const name of ['encoder', 'hub', 'explorer']) {
        if (services[name] === 'unreachable' && CONSEQUENCE[name]) out.push(CONSEQUENCE[name]);
    }
    return out;
}

function formatAgo(diffMs) {
    if (diffMs < 60_000) return `${Math.max(1, Math.round(diffMs / 1000))}s`;
    if (diffMs < 3_600_000) return `${Math.round(diffMs / 60_000)}m`;
    return `${Math.round(diffMs / 3_600_000)}h`;
}
