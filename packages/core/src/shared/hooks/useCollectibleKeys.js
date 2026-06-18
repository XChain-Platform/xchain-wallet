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
import { fetchTokenInfo } from './useTokenInfo.js';

/**
 * Canonical collectible (NFT-pattern) classification for balance rows.
 * protocol/NFT_Standard.md: a token is a collectible when DECIMALS = 0
 * AND LOCK_MAX_SUPPLY = 1. Mirrors sdk.nft.isNft; keep the two in sync.
 *
 * Divisibility rides on the balance row, so rows are pre-filtered to the
 * 0-decimal candidates; the supply lock comes from the shared token-info
 * lookup (module-cached: revisits and the per-card image lookups in
 * `CollectiblesView` reuse the same entries, so nothing fetches twice).
 *
 * A row only joins the returned set once its info has resolved AND shows
 * a locked cap. Unknown/unfetchable infos stay excluded (conservative:
 * a tab tile asserts "this cannot inflate or split", so it must never
 * appear on a guess).
 *
 * @param {Array<{kind?: string, chainId: string, tick: string, divisibility?: number}> | null | undefined} rows
 * @returns {Set<string>} keys (`chainId:tick`) of rows classified as collectibles
 */
export function useCollectibleKeys(rows) {
    const { messaging } = useMessaging();
    // Bumped whenever a new token-info resolves so the memo recomputes
    const [version, setVersion] = useState(0);
    const [infoByKey] = useState(() => new Map());

    const candidates = useMemo(
        () => (Array.isArray(rows) ? rows : []).filter(
            (r) => r && r.kind !== 'native' && Number(r.divisibility) === 0,
        ),
        [rows],
    );
    const candidateKey = candidates.map((r) => `${r.chainId}:${r.tick}`).join('|');

    useEffect(() => {
        let cancelled = false;
        for (const r of candidates) {
            const key = `${r.chainId}:${r.tick}`;
            if (infoByKey.has(key)) continue;
            fetchTokenInfo(messaging, r.chainId, r.tick).then((info) => {
                if (cancelled) return;
                infoByKey.set(key, info);
                setVersion((v) => v + 1);
            });
        }
        return () => { cancelled = true; };
        // candidateKey captures the candidate identity; `candidates` itself is
        // a fresh array each render and would re-run the effect needlessly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateKey, messaging]);

    return useMemo(() => {
        const keys = new Set();
        for (const r of candidates) {
            const key = `${r.chainId}:${r.tick}`;
            const info = infoByKey.get(key);
            if (info && info.locks && info.locks.max_supply === true) keys.add(key);
        }
        return keys;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [candidateKey, version]);
}
