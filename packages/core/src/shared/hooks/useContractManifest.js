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
 * Phase F — shared permissions-manifest lookup for the inline consent
 * disclosure shown before EXECUTE / DEPOSIT / WITHDRAW. Mirrors
 * `useTokenInfo` (module cache, null-sentinel, `skip` support).
 *
 * Returns the normalized `{ permissions, maxTakeBps }` record for a
 * (chainId, contractActionIndex) pair, or the null sentinel
 * `{ permissions: null, maxTakeBps: null }` when:
 *   - `chainId` or `contractActionIndex` is missing,
 *   - `messaging.getContractManifest` isn't wired in this build,
 *   - the lookup fails (silently — the panel renders its
 *     "undeclared manifest" soft caution).
 *
 * `skip` lets the caller defer the fetch until it actually needs the
 * manifest (e.g. the EXECUTE form only fetches once the user reaches
 * the review stage). Module-level cache keyed by
 * `chainId:contractActionIndex` survives re-mounts within a session.
 *
 * @param {object} args
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.contractActionIndex
 * @param {boolean} [args.skip]
 * @returns {import('../../flows/contractDetail.js').ContractManifest}
 */

const NULL_MANIFEST = Object.freeze({ permissions: null, maxTakeBps: null });

const cache = /** @type {Map<string, any>} */ (new Map());

export function useContractManifest({ chainId, contractActionIndex, skip = false }) {
    const { messaging } = useMessaging();
    const key = chainId && contractActionIndex
        ? `${chainId}:${contractActionIndex}`
        : null;
    const [manifest, setManifest] = useState(/** @type {any} */ (
        key && cache.has(key) ? cache.get(key) : NULL_MANIFEST
    ));

    useEffect(() => {
        if (skip || !key) {
            setManifest(NULL_MANIFEST);
            return undefined;
        }
        if (cache.has(key)) {
            setManifest(cache.get(key));
            return undefined;
        }
        if (typeof messaging?.getContractManifest !== 'function') return undefined;
        let cancelled = false;
        messaging.getContractManifest({ chainId, contractActionIndex })
            .then((next) => {
                if (cancelled) return;
                const normalized = next && typeof next === 'object'
                    ? {
                        permissions: Array.isArray(next.permissions) ? next.permissions : null,
                        maxTakeBps: Number.isFinite(next.maxTakeBps) ? next.maxTakeBps : null,
                    }
                    : NULL_MANIFEST;
                cache.set(key, normalized);
                setManifest(normalized);
            })
            .catch(() => { /* silent — panel falls back to the undeclared-manifest caution */ });
        return () => { cancelled = true; };
    }, [key, skip, messaging, chainId, contractActionIndex]);

    return manifest;
}

/**
 * Test helper — clears the module-level manifest cache between spec
 * runs so a stale mock doesn't leak across cases.
 */
export function __clearContractManifestCache() {
    cache.clear();
}
