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
 * Phase F / PC-39: shared permissions-manifest lookup for the inline
 * consent disclosure shown before EXECUTE / DEPOSIT / WITHDRAW /
 * controller-bind / contract-stake. Mirrors `useTokenInfo` (module
 * cache, sentinel, `skip` support).
 *
 * Returns the normalized `{ permissions, maxTakeBps, status }` record
 * for a (chainId, contractActionIndex) pair. `status` is what the panel
 * renders off, and it separates the two answers a bare null
 * `permissions` used to conflate:
 *   - `'declared'`     the contract declared an allowlist (possibly empty)
 *   - `'unrestricted'` the explorer answered and the contract declared none,
 *                      which per DEPLOY.md means it may emit ANY action type
 *   - `'unavailable'`  the wallet could not check at all: missing ids, a
 *                      build without `messaging.getContractManifest`, or a
 *                      failed lookup. Never presented as an assurance.
 *
 * `skip` lets the caller defer the fetch until it actually needs the
 * manifest (e.g. the EXECUTE form only fetches once the user reaches
 * the review stage). Module-level cache keyed by
 * `chainId:contractActionIndex` survives re-mounts within a session;
 * only resolved lookups are cached, so a transient outage doesn't
 * pin `unavailable` for the rest of the session.
 *
 * @param {object} args
 * @param {string | null | undefined} args.chainId
 * @param {string | null | undefined} args.contractActionIndex
 * @param {boolean} [args.skip]
 * @returns {import('../../flows/contractDetail.js').ContractManifest}
 */

const NULL_MANIFEST = Object.freeze({ permissions: null, maxTakeBps: null, status: 'unavailable' });

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
                const permissions = Array.isArray(next?.permissions) ? next.permissions : null;
                // Trust the flow's status when it sent one; an older host that
                // still answers the pre-PC-39 two-field shape degrades to
                // 'unavailable' rather than claiming an unrestricted contract.
                const status = next && typeof next === 'object'
                    ? (next.status === 'declared' || next.status === 'unrestricted' || next.status === 'unavailable'
                        ? next.status
                        : (permissions ? 'declared' : 'unavailable'))
                    : 'unavailable';
                const normalized = {
                    permissions,
                    maxTakeBps: Number.isFinite(next?.maxTakeBps) ? next.maxTakeBps : null,
                    status,
                };
                cache.set(key, normalized);
                setManifest(normalized);
            })
            .catch(() => { /* silent; panel falls back to the undeclared-manifest caution */ });
        return () => { cancelled = true; };
    }, [key, skip, messaging, chainId, contractActionIndex]);

    return manifest;
}

/**
 * Test helper. Clears the module-level manifest cache between spec
 * runs so a stale mock doesn't leak across cases.
 */
export function __clearContractManifestCache() {
    cache.clear();
}
