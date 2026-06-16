// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * §27.6 + §27.5 — shared tick-metadata lookup for token-detail and
 * collectibles surfaces. Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3.
 *
 * Returns the normalized `TokenInfo` record (description, creator,
 * supply, locks, market price, extracted imageUrl) for a (chainId,
 * tick) pair, or `null` when:
 *   - `chainId` or `tick` is missing,
 *   - `messaging.getTokenInfo` isn't wired in this build,
 *   - the lookup fails (silently — caller renders "no metadata" copy).
 *
 * Module-level cache keyed by `chainId:tick` survives re-mounts inside
 * a single session so navigating Detail → back → Detail (or hovering
 * the same row in Collectibles) doesn't re-fetch.
 *
 * @param {object} args
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.tick
 * @param {boolean} [args.skip]                 caller can opt out (e.g. native coins)
 * @returns {import('../../flows/tokenInfo.js').TokenInfo | null}
 */

const cache = /** @type {Map<string, any>} */ (new Map());

export function useTokenInfo({ chainId, tick, skip = false }) {
    const { messaging } = useMessaging();
    const key = chainId && tick ? `${chainId}:${tick}` : null;
    const [info, setInfo] = useState(/** @type {any} */ (
        key && cache.has(key) ? cache.get(key) : null
    ));

    useEffect(() => {
        if (skip || !key) {
            setInfo(null);
            return undefined;
        }
        if (cache.has(key)) {
            setInfo(cache.get(key));
            return undefined;
        }
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        messaging.getTokenInfo({ chainId, tick })
            .then((next) => {
                if (cancelled) return;
                cache.set(key, next);
                setInfo(next);
            })
            .catch(() => { /* silent — renderer falls back to "no metadata" copy */ });
        return () => { cancelled = true; };
    }, [key, skip, messaging, chainId, tick]);

    return info;
}

/**
 * Promise-shaped sibling of the hook, sharing the same module cache —
 * for callers that classify SETS of rows (e.g. the Collectibles tab)
 * rather than rendering one tick. Resolves null on any failure or when
 * `messaging.getTokenInfo` isn't wired, mirroring the hook's silence.
 *
 * @param {object | null} messaging
 * @param {string | null | undefined} chainId
 * @param {string | null | undefined} tick
 * @returns {Promise<any | null>}
 */
export function fetchTokenInfo(messaging, chainId, tick) {
    const key = chainId && tick ? `${chainId}:${tick}` : null;
    if (!key) return Promise.resolve(null);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (typeof messaging?.getTokenInfo !== 'function') return Promise.resolve(null);
    return messaging.getTokenInfo({ chainId, tick })
        .then((next) => {
            cache.set(key, next);
            return next;
        })
        .catch(() => null);
}

/**
 * Test helper — clears the module-level tick-info cache between spec
 * runs so a stale mock doesn't leak across cases.
 */
export function __clearTokenInfoCache() {
    cache.clear();
}
