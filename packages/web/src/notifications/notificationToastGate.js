// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Burst control for in-app notification toasts. ToastHost queues every toast
// it is given and shows three at a time for eight seconds each, so a burst of
// incoming payments (a back-fill, a reconnect, an airdrop) would otherwise
// keep the screen busy for minutes with stale lines. The gate lets the first
// few toasts of a burst through and folds the rest into one summary toast
// that updates in place.

/** Toast id of the folded summary; showing it again replaces it in place. */
export const SUMMARY_TOAST_ID = 'notification-burst-summary';

/**
 * @param {{ limit?: number, windowMs?: number, now?: () => number }} [options]
 * @returns {(message: string) => { id?: string, message: string }}
 */
export function createNotificationToastGate({ limit = 3, windowMs = 8000, now = Date.now } = {}) {
    /** @type {number[]} */
    let shown = [];
    let folded = 0;

    return function gate(message) {
        const at = now();
        shown = shown.filter((time) => at - time < windowMs);
        if (shown.length === 0) folded = 0;
        if (shown.length < limit) {
            shown.push(at);
            return { message };
        }
        folded += 1;
        return {
            id: SUMMARY_TOAST_ID,
            message: folded === 1 ? '1 more notification' : `${folded} more notifications`,
        };
    };
}
