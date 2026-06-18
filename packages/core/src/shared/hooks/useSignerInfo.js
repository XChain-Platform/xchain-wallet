// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * §18.4 / Cluster N FOLLOWUP 2: shared SignerRecord-lookup hook for
 * HW sign surfaces.
 *
 * Returns `{ vendor, model, firmwareVersion }` for the matching
 * SignerRecord, or `null` when:
 *   - `walletId` or `signerId` is missing,
 *   - the record isn't found (race / pruned / unpaired),
 *   - `messaging.listSigners` fails (silently; the banner just doesn't render).
 *
 * Callers pass the props straight into `<HwSignBlock signerInfo={info} />`
 * + `<HwFirmwareBanner>` and the warning banner / advisory copy lights
 * up automatically. Before this hook each surface duplicated the
 * useEffect / find / useMemo plumbing; collapsing it here keeps the
 * adoption sweep across §40.2+ authoring surfaces a one-liner each.
 *
 * Lookup is cached per (walletId, signerId) pair so re-mounting a sign
 * surface inside the same view doesn't re-fetch the signer list.
 *
 * @param {object} args
 * @param {string | null | undefined} args.walletId
 * @param {string | null | undefined} args.signerId
 * @returns {{ vendor: string, model: string, firmwareVersion: string | null } | null}
 */

const cache = /** @type {Map<string, any[]>} */ (new Map());

export function useSignerInfo({ walletId, signerId }) {
    const { messaging } = useMessaging();
    const [rows, setRows] = useState(/** @type {any[]} */ (
        walletId && cache.has(walletId) ? cache.get(walletId) : []
    ));

    useEffect(() => {
        if (!walletId || typeof messaging?.listSigners !== 'function') return undefined;
        let cancelled = false;
        // Serve from cache first to avoid the "loading flicker" when the
        // hook re-mounts (e.g. user navigates Send → Home → Send).
        const cached = cache.get(walletId);
        if (cached) setRows(cached);
        messaging.listSigners(walletId)
            .then((next) => {
                if (cancelled) return;
                const arr = Array.isArray(next) ? next : [];
                cache.set(walletId, arr);
                setRows(arr);
            })
            .catch(() => { /* silent; banner / advisory just doesn't render */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    return useMemo(() => {
        if (!signerId) return null;
        const rec = rows.find((s) => s?.id === signerId);
        if (!rec) return null;
        return {
            vendor: rec.vendor,
            model: rec.model,
            firmwareVersion: rec.firmwareVersion ?? null,
        };
    }, [rows, signerId]);
}

/**
 * Test helper: clears the module-level signer-list cache between
 * spec runs so a stale mock doesn't leak across cases.
 */
export function __clearSignerInfoCache() {
    cache.clear();
}
