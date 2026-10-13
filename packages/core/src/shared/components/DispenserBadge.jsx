// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// DispenserBadge (§41.6): "Dispenser available" marker for a ticker on
// a given chain. Used in MarketsList rows so users can see at a glance
// which tokens can also be bought via an open dispenser (Phase 2
// §40.7.2's explorer surface).
//
// Cache: module-level session-scoped Maps keyed by chain ID and ticker,
// with weak keys for messaging instances. Rows sharing a transport and token
// reuse one request when the list re-renders (filter flips, watchlist toggles, etc.).
// A page reload clears the cache; stale data is acceptable because open
// dispenser availability changes rarely on mainnet timescales.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { isOpenDispenserSelling } from '../utils/dispenserPricing.js';

/** @typedef {{ state: 'loading' | 'ready', count: number, promise?: Promise<number> }} CacheEntry */
/** @type {Map<string, Map<string, WeakMap<object, CacheEntry>>>} */
const CACHE = new Map();

function extractRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    if (Array.isArray(resp.dispensers)) return resp.dispensers;
    return [];
}

// Exported as isDispenserRowOpen so other surfaces can share this rule.
// The explorer keeps creation validity in `status` after a dispenser closes.
// Its `current_status` and remaining escrow describe whether stock is live.
// The shared pricing helper reads those current fields when present and falls
// back to creation validity for explorers that omit the newer fields. Keeping
// the badge on that helper also keeps token listings and market badges aligned.
export function isDispenserRowOpen(row) {
    return isOpenDispenserSelling(row);
}

/**
 * Resolve the open-dispenser count for `(chainId, tick)`. Shared across
 * component instances using the same messaging transport so a MarketsList
 * with 20 rows referencing the same ticker only fires one explorer request.
 *
 * @param {{ getDispensersForToken: (req: { chainId: string, tick: string }) => Promise<any> }} messaging
 * @param {string} chainId
 * @param {string} tick
 * @returns {Promise<number>}
 */
function resolveCount(messaging, chainId, tick) {
    let chainCache = CACHE.get(chainId);
    if (!chainCache) {
        chainCache = new Map();
        CACHE.set(chainId, chainCache);
    }
    let tickerCache = chainCache.get(tick);
    if (!tickerCache) {
        tickerCache = new WeakMap();
        chainCache.set(tick, tickerCache);
    }
    const cached = tickerCache.get(messaging);
    if (cached && cached.state === 'ready') return Promise.resolve(cached.count);
    if (cached && cached.promise) return cached.promise;
    const promise = Promise.resolve()
        .then(() => messaging.getDispensersForToken({ chainId, tick }))
        .then((resp) => {
            const open = extractRows(resp).filter(isDispenserRowOpen).length;
            tickerCache.set(messaging, { state: 'ready', count: open });
            return open;
        })
        .catch(() => {
            // Isolated failure; cache as zero so we don't hammer the
            // explorer. User can reload the page to retry.
            tickerCache.set(messaging, { state: 'ready', count: 0 });
            return 0;
        });
    tickerCache.set(messaging, { state: 'loading', count: 0, promise });
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
    const visibleLabel = label || `Dispenser · ${tick}`;
    const description = `${count} open dispenser${count === 1 ? '' : 's'} for ${tick} on ${chainId}`;
    return (
        <span
            role="status"
            aria-label={description}
            title={description}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                minWidth: 0,
                maxWidth: '100%',
                padding: '2px var(--xc-space-2)',
                border: '1px solid var(--xc-accent-primary)',
                borderRadius: 'var(--xc-radius-pill)',
                background: 'color-mix(in srgb, var(--xc-accent-primary) 10%, transparent)',
                color: 'var(--xc-accent-text)',
                fontSize: 'var(--xc-text-xs)',
                fontWeight: 700,
                lineHeight: 1.4,
                textTransform: 'uppercase',
                letterSpacing: '0.02em',
            }}
        >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {visibleLabel}
            </span>
        </span>
    );
}

/** @internal test hook: clear the module-level cache. */
export function __clearDispenserBadgeCache() {
    CACHE.clear();
}
