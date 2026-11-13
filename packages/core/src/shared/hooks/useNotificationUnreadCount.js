// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/** Fired after a notification is read or recorded, so every counter refreshes at once. */
export const NOTIFICATIONS_CHANGED_EVENT = 'xc:notifications-changed';

/** Tells every unread counter to re-read the inbox now. */
export function announceNotificationsChanged() {
    try { globalThis.dispatchEvent?.(new Event(NOTIFICATIONS_CHANGED_EVENT)); } catch { /* no window */ }
}

/**
 * Counts unread notifications the way the Notifications page shows them: the
 * stored inbox rows plus the wallet-level entries the shell builds, an entry
 * counting once by id and as read when either source has it read. Re-reads
 * when a notification changes, when the window regains focus, and every 30 s
 * so a notification recorded in the background shows on the bell.
 */
export function useNotificationUnreadCount({ walletId, alerts = [] } = {}) {
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
    for (const row of [...inbox, ...(Array.isArray(alerts) ? alerts : [])]) {
        if (!row?.id) continue;
        readById.set(row.id, readById.get(row.id) === true || row.read === true);
    }
    let unread = 0;
    for (const isRead of readById.values()) if (!isRead) unread += 1;
    return unread;
}
