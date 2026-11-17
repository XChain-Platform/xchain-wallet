// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

/**
 * Build the desktop OS notification adapter around Electron's Notification.
 * A false result tells producers the notification was not shown, so a price
 * alert stays armed and a receipt can be announced on a later attempt. Only a
 * shown notification returns true.
 *
 * Settings > Notifications > Desktop notifications (`notifications.desktop`)
 * gates the OS surface: false never shows one, true or unset (desktop has no
 * separate permission step, so unset keeps today's behaviour) shows it. A muted
 * notification returns true so producers treat it as handled and do not keep
 * retrying; the in-app inbox is written before this adapter runs. A failed
 * settings read (vault locked) shows the notification.
 *
 * @param {{ Notification: any, reportFailure?: (label: string, err: unknown) => void, getSettings?: () => (object | undefined | Promise<object | undefined>) }} deps
 * @returns {(n: { title: string, body: string }) => Promise<boolean>}
 */
export function createOsNotifier({ Notification, reportFailure = () => {}, getSettings }) {
    return async ({ title, body }) => {
        try {
            let settings;
            try { settings = typeof getSettings === 'function' ? await getSettings() : undefined; } catch { settings = undefined; }
            if (settings?.notifications?.desktop === false) return true;
            if (!Notification?.isSupported?.()) return false;
            new Notification({ title, body }).show();
            return true;
        } catch (err) {
            reportFailure('desktop notification', err);
            return false;
        }
    };
}
