// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';
import { isActionRequiredAlert, withoutDeadNoticeAlerts } from '../walletAlerts.js';
import {
    NOTIFICATIONS_CHANGED_EVENT,
    announceNotificationsChanged,
} from '../alertInbox.js';

export { NOTIFICATIONS_CHANGED_EVENT, announceNotificationsChanged };

/**
 * Counts unread notifications the way the Notifications page shows them: the
 * stored inbox rows plus the wallet-level entries the shell builds, an entry
 * counting once by id and as read when either source has it read. Re-reads
 * when a notification changes, when the window regains focus, and every 30 s
 * so a notification recorded in the background shows on the bell.
 */
export function useNotificationUnreadCount(args = {}) {
    return useNotificationUnreadSummary(args).unread;
}

/**
 * The same count, split: `unread` is every unread item, `actionRequired` the
 * unread ones that need the user to act (payment due, pending airdrop, an
 * unfinished migration). Dead notice rows are dropped before either count.
 */
export function useNotificationUnreadSummary({ walletId, alerts = [] } = {}) {
    const { messaging } = useMessaging();
    const [inbox, setInbox] = useState([]);

    useEffect(() => {
        if (typeof messaging?.listAlertInbox !== 'function') return undefined;
        let active = true;
        const read = () => {
            messaging.listAlertInbox({ walletId })
                .then((rows) => { if (active) setInbox(Array.isArray(rows) ? rows : []); })
                .catch(() => {});
        };
        read();
        const timer = setInterval(read, 30_000);
        globalThis.addEventListener?.(NOTIFICATIONS_CHANGED_EVENT, read);
        globalThis.addEventListener?.('focus', read);
        return () => {
            active = false;
            clearInterval(timer);
            globalThis.removeEventListener?.(NOTIFICATIONS_CHANGED_EVENT, read);
            globalThis.removeEventListener?.('focus', read);
        };
    }, [messaging, walletId]);

    const readById = new Map();
    const actionById = new Map();
    // Pass the live notice items (usePendingNoticeAlerts) inside `alerts`; a
    // stored payment-due or airdrop-pending row without one is dead and not counted.
    for (const row of [...withoutDeadNoticeAlerts(inbox, alerts), ...(Array.isArray(alerts) ? alerts : [])]) {
        if (!row?.id) continue;
        readById.set(row.id, readById.get(row.id) === true || row.read === true);
        actionById.set(row.id, isActionRequiredAlert(row));
    }
    let unread = 0;
    let actionRequired = 0;
    for (const [id, isRead] of readById) {
        if (isRead) continue;
        unread += 1;
        if (actionById.get(id)) actionRequired += 1;
    }
    return { unread, actionRequired };
}
