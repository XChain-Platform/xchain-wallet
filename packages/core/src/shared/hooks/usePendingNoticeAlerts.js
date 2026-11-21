// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useMemo, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { useSharedCoinpayObligations } from './useCoinpayObligations.js';
import { buildPendingNoticeAlerts } from '../walletAlerts.js';

/**
 * The Home notices that ask the user to act (payment due, pending airdrop) as
 * notification items, so the bell's list and its unread badge carry them too.
 * Reads the same sources Home reads: the tree's shared COINPAY scan and the
 * wallet's pending airdrops. Feed the result to the notifications list and the
 * unread counter beside the wallet-level alerts.
 */
export function usePendingNoticeAlerts({ walletId, accountId, isWatcherMode = false, onResumeCoinpay, onResumeAirdrop } = {}) {
    const { messaging } = useMessaging();
    const { obligations, incomplete } = useSharedCoinpayObligations(walletId, accountId);
    const [airdrops, setAirdrops] = useState(/** @type {any[]} */ ([]));

    useEffect(() => {
        if (!walletId || typeof messaging?.listPendingAirdropsForWallet !== 'function') {
            setAirdrops([]);
            return undefined;
        }
        let active = true;
        const read = () => {
            Promise.resolve(messaging.listPendingAirdropsForWallet({ walletId }))
                .then((records) => {
                    if (!active) return;
                    setAirdrops((Array.isArray(records) ? records : [])
                        .filter((r) => r.stage === 'waiting-index' || r.stage === 'ready-to-airdrop'));
                })
                .catch(() => {});
        };
        read();
        const timer = setInterval(read, 30_000);
        globalThis.addEventListener?.('focus', read);
        return () => {
            active = false;
            clearInterval(timer);
            globalThis.removeEventListener?.('focus', read);
        };
    }, [messaging, walletId]);

    return useMemo(() => buildPendingNoticeAlerts({
        pendingCoinpays: walletId ? obligations : [],
        coinpaysIncomplete: Boolean(walletId) && incomplete === true,
        pendingAirdrops: airdrops,
        isWatcherMode,
    }, { onResumeCoinpay, onResumeAirdrop }), [walletId, obligations, incomplete, airdrops, isWatcherMode, onResumeCoinpay, onResumeAirdrop]);
}
