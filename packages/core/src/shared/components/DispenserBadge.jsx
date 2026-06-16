// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DispenserBadge — §41.6 "Dispenser available" marker for a ticker on
// a given chain. Used in MarketsList rows so users can see at a glance
// which tokens can also be bought via an open dispenser (Phase 2
// §40.7.2's explorer surface).
//
// Cache: module-level session-scoped Map keyed by `${chainId}::${tick}`
// so the same (chain, tick) pair doesn't re-query when the row
// re-renders (filter flips, watchlist toggles, etc.). Cleared only by
// page reload; stale data is fine — "is there AT LEAST ONE open
// dispenser for this token" flips rarely on mainnet timescales.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/** @type {Map<string, { state: 'loading' | 'ready', count: number, promise?: Promise<number> }>} */
const CACHE = new Map();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.dispensers)) return resp.dispensers;
    return [];
}

function isOpen(row) {
    if (!row || typeof row !== 'object') return false;
    const status = String(row.status || '').toLowerCase();
    if (!status) return true; // if explorer omits status, assume row is active
    return status === 'valid' || status === 'open';
}

/**
 * Resolve the open-dispenser count for `(chainId, tick)`. Shared across
 * component instances so a MarketsList with 20 rows referencing the
 * same ticker only fires one explorer request.
 *
 * @param {{ getDispensersForToken: (req: { chainId: string, tick: string }) => Promise<any> }} messaging
 * @param {string} chainId
 * @param {string} tick
 * @returns {Promise<number>}
 */
function resolveCount(messaging, chainId, tick) {
    const key = `${chainId}::${tick}`;
    const cached = CACHE.get(key);
    if (cached && cached.state === 'ready') return Promise.resolve(cached.count);
    if (cached && cached.promise) return cached.promise;
    const promise = messaging.getDispensersForToken({ chainId, tick })
        .then((resp) => {
            const open = extractRows(resp).filter(isOpen).length;
            CACHE.set(key, { state: 'ready', count: open });
            return open;
        })
        .catch(() => {
            // Isolated failure — cache as zero so we don't hammer the
            // explorer. User can reload the page to retry.
            CACHE.set(key, { state: 'ready', count: 0 });
            return 0;
        });
    CACHE.set(key, { state: 'loading', count: 0, promise });
    return promise;
}

/**
 * @param {object} props
 * @param {string} props.chainId
 * @param {string} props.tick      ticker to check
 * @param {string} [props.label]   override label (defaults to "Dispenser")
 */
export function DispenserBadge({ chainId, tick, label }) {
    const { messaging } = useMessaging();
    const [count, setCount] = useState(/** @type {number | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        setCount(null);
        if (!chainId || !tick) return undefined;
        resolveCount(messaging, chainId, tick).then((n) => {
            if (!cancelled) setCount(n);
        });
        return () => { cancelled = true; };
    }, [messaging, chainId, tick]);

    if (count === null || count === 0) return null;
    return (
        <span
            title={`${count} open dispenser${count === 1 ? '' : 's'} for ${tick} on ${chainId}`}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.7rem',
                padding: '0.05rem 0.35rem',
                borderRadius: '2px',
                background: 'var(--xc-accent-bg, rgba(25, 118, 210, 0.12))',
                color: 'var(--xc-accent, #1976d2)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
            }}
        >
            {label || `Dispenser · ${tick}`}
        </span>
    );
}

/** @internal test hook — clear the module-level cache. */
export function __clearDispenserBadgeCache() {
    CACHE.clear();
}
