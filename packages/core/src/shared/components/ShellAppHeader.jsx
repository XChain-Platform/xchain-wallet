// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppHeader } from './AppHeader.jsx';
import { useNotificationUnreadSummary } from '../hooks/useNotificationUnreadCount.js';
import { usePendingNoticeAlerts } from '../hooks/usePendingNoticeAlerts.js';

/**
 * The app header every shell mounts: AppHeader plus the Notifications bell at
 * every width and in every shell. The bell's unread badge counts the same
 * list the Notifications page shows: the stored inbox, the wallet-level
 * alerts the shell builds, and the Home notices (payment due, pending
 * airdrop). Must render under the shell's CoinpayObligationsProvider.
 *
 * @param {object} props  AppHeader props, plus:
 * @param {string | null} [props.walletId]
 * @param {string | null} [props.accountId]
 * @param {any[]} [props.alerts]  wallet-level alerts from buildWalletAlerts
 * @param {() => void} [props.onOpenNotifications]  opens the Notifications page
 * @param {(ref: object) => void} [props.onResumeCoinpay]
 * @param {(id: string) => void} [props.onResumeAirdrop]
 */
export function ShellAppHeader({
    walletId = null,
    accountId = null,
    alerts = [],
    onOpenNotifications,
    onResumeCoinpay,
    onResumeAirdrop,
    isWatcherMode = false,
    ...headerProps
}) {
    const noticeAlerts = usePendingNoticeAlerts({ walletId, accountId, isWatcherMode, onResumeCoinpay, onResumeAirdrop });
    const { unread, actionRequired } = useNotificationUnreadSummary({ walletId, alerts: [...(Array.isArray(alerts) ? alerts : []), ...noticeAlerts] });
    return (
        <AppHeader
            {...headerProps}
            isWatcherMode={isWatcherMode}
            onNotifications={onOpenNotifications || (() => {})}
            notificationsUnread={unread}
            notificationsActionRequired={actionRequired}
        />
    );
}
