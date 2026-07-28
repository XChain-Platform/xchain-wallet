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
import {
    tokenInfoCacheKey,
    readTokenInfoCache,
    writeTokenInfoCache,
    subscribeTokenInfoInvalidation,
    tokenInfoTargetMatches,
    clearTokenInfoCache,
} from '../utils/tokenInfoCache.js';

/**
 * §27.6 + §27.5: shared tick-metadata lookup for token-detail and
 * collectibles surfaces. Cluster I FOLLOWUP 3 + Cluster C FOLLOWUP 3.
 *
 * Returns the normalized `TokenInfo` record (description, creator,
 * supply, locks, market price, extracted imageUrl) for a (chainId,
 * tick) pair, or `null` when:
 *   - `chainId` or `tick` is missing,
 *   - `messaging.getTokenInfo` isn't wired in this build,
 *   - the lookup fails (silently; caller renders "no metadata" copy).
 *
 * The module-level cache keyed `chainId:tick` (see `utils/tokenInfoCache.js`)
 * still spares the re-fetch on Detail -> back -> Detail, but  gave it a
 * TTL and an invalidation channel: an action this wallet broadcasts against
 * the tick drops the record, and this hook re-reads it even while mounted.
 * Without that, Manage Token kept naming the previous owner after an
 * ownership transfer and locked the new owner out of every issuer action
 * until a full page reload.
 *
 * @param {object} args
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.tick
 * @param {boolean} [args.skip]                 caller can opt out (e.g. native coins)
 * @returns {import('../../flows/tokenInfo.js').TokenInfo | null}
 */
export function useTokenInfo({ chainId, tick, skip = false }) {
    const { messaging } = useMessaging();
    const key = tokenInfoCacheKey(chainId, tick);
    const [info, setInfo] = useState(/** @type {any} */ (readTokenInfoCache(key).value));
    // Bumped when this tick is invalidated, purely to re-run the fetch effect
    // on a component that never unmounted (the Manage Token page driving its
    // own MINT / LOCK / TRANSFER is exactly that case).
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (skip || !chainId || !tick) return undefined;
        return subscribeTokenInfoInvalidation((target) => {
            if (tokenInfoTargetMatches(target, chainId, tick)) {
                setRevision((n) => n + 1);
            }
        });
    }, [chainId, tick, skip]);

    useEffect(() => {
        if (skip || !key) {
            setInfo(null);
            return undefined;
        }
        const cached = readTokenInfoCache(key);
        if (cached.hit) {
            setInfo(cached.value);
            return undefined;
        }
        if (typeof messaging?.getTokenInfo !== 'function') return undefined;
        let cancelled = false;
        messaging.getTokenInfo({ chainId, tick })
            .then((next) => {
                if (cancelled) return;
                writeTokenInfoCache(key, next);
                setInfo(next);
            })
            .catch(() => { /* silent; renderer falls back to "no metadata" copy */ });
        return () => { cancelled = true; };
    }, [key, skip, messaging, chainId, tick, revision]);

    return info;
}

/**
 * Promise-shaped sibling of the hook, sharing the same module cache.
 * For callers that classify SETS of rows (e.g. the Collectibles tab)
 * rather than rendering one tick. Resolves null on any failure or when
 * `messaging.getTokenInfo` isn't wired, mirroring the hook's silence.
 *
 * @param {object | null} messaging
 * @param {string | null | undefined} chainId
 * @param {string | null | undefined} tick
 * @returns {Promise<any | null>}
 */
export function fetchTokenInfo(messaging, chainId, tick) {
    const key = tokenInfoCacheKey(chainId, tick);
    if (!key) return Promise.resolve(null);
    const cached = readTokenInfoCache(key);
    if (cached.hit) return Promise.resolve(cached.value);
    if (typeof messaging?.getTokenInfo !== 'function') return Promise.resolve(null);
    return messaging.getTokenInfo({ chainId, tick })
        .then((next) => {
            writeTokenInfoCache(key, next);
            return next;
        })
        .catch(() => null);
}

/**
 * Test helper: clears the module-level tick-info cache between spec
 * runs so a stale mock doesn't leak across cases.
 */
export function __clearTokenInfoCache() {
    clearTokenInfoCache();
}
