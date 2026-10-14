// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * BIP44 accounts of a wallet, ordered by hardened index. Shell chrome
 * (the AppHeader gear) needs the account's label to show "what
 * is active" without owning a fetch of its own, and the list is a
 * local-store read, so re-resolving it per consumer is cheap.
 *
 * Returns `[]` while loading, on error, and for shells whose messaging
 * bridge predates `listAccounts`. Callers therefore treat "no accounts"
 * and "not yet known" identically, which is right here: the gear just
 * omits the Account row until there is something to name.
 *
 * @param {string | null | undefined} walletId
 * @param {unknown} [refreshKey]   refetch when an account mutation changes this value
 * @returns {Array<{ id: string, index: number, name?: string }>}
 */
export function useAccountList(walletId, refreshKey) {
    const { messaging } = useMessaging();
    const [accounts, setAccounts] = useState(
        /** @type {Array<{ id: string, index: number, name?: string }>} */ ([]),
    );
    const scopeRef = useRef({ walletId, messaging });
    if (scopeRef.current.walletId !== walletId || scopeRef.current.messaging !== messaging) {
        scopeRef.current = { walletId, messaging };
        // React retries this render with an empty list, so wallet chrome never
        // commits an account name from a different wallet or bridge.
        setAccounts([]);
    }

    useEffect(() => {
        if (!walletId || typeof messaging?.listAccounts !== 'function') {
            setAccounts([]);
            return undefined;
        }
        let cancelled = false;
        Promise.resolve(messaging.listAccounts(walletId))
            .then((list) => {
                if (cancelled) return;
                setAccounts(Array.isArray(list)
                    ? [...list].sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0))
                    : []);
            })
            .catch(() => { if (!cancelled) setAccounts([]); });
        return () => { cancelled = true; };
    }, [walletId, messaging, refreshKey]);

    return accounts;
}
