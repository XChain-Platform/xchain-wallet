// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useLayoutEffect, useState } from 'react';
import { buildBalanceRows } from '@xchain-wallet/core/shared/components/BalanceList.jsx';
import { loadDisplayBalances } from '@xchain-wallet/core/shared/utils/displayBalances.js';
import { useCommandPaletteOnlineRetry } from '@xchain-wallet/core/shared/commandPalette/useCommandPalette.js';

export function usePopupPaletteData({
    open,
    sessionState,
    walletId,
    accountId,
    messaging,
    chainRegistry,
    loadSites,
}) {
    const [contacts, setContacts] = useState(/** @type {any[]} */ ([]));
    const [tokenRows, setTokenRows] = useState(/** @type {any[]} */ ([]));
    const [sites, setSites] = useState(/** @type {any[]} */ ([]));
    const onlineRetryKey = useCommandPaletteOnlineRetry(
        open && sessionState === 'unlocked' && Boolean(walletId),
    );

    useLayoutEffect(() => {
        setContacts([]);
        setTokenRows([]);
        setSites([]);
    }, [open, sessionState, walletId, accountId, onlineRetryKey]);

    useEffect(() => {
        if (!open || sessionState !== 'unlocked' || !walletId) return undefined;

        let cancelled = false;
        messaging.listContacts()
            .then((rows) => { if (!cancelled) setContacts(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* The palette remains usable without contacts. */ });
        loadDisplayBalances(messaging, walletId, accountId)
            .then((balances) => {
                if (!cancelled) setTokenRows(buildBalanceRows(balances, chainRegistry, null));
            })
            .catch(() => { /* The palette remains usable without token rows. */ });
        loadSites()
            .then((rows) => { if (!cancelled) setSites(Array.isArray(rows) ? rows : []); })
            .catch(() => { /* The palette remains usable without connected sites. */ });

        return () => { cancelled = true; };
    }, [open, sessionState, walletId, accountId, messaging, chainRegistry, loadSites, onlineRetryKey]);

    return { contacts, tokenRows, sites };
}
