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
 * @param {{ Notification: any, reportFailure?: (label: string, err: unknown) => void }} deps
 * @returns {(n: { title: string, body: string }) => boolean}
 */
export function createOsNotifier({ Notification, reportFailure = () => {} }) {
    return ({ title, body }) => {
        try {
            if (!Notification?.isSupported?.()) return false;
            new Notification({ title, body }).show();
            return true;
        } catch (err) {
            reportFailure('desktop notification', err);
            return false;
        }
    };
}
