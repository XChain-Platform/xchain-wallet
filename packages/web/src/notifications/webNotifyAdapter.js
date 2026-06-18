// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §46 delivery adapter for the web shell. The in-page NotificationService
// (hosted in hostBridge.js) calls `notify({ kind, title, body })`; this
// translates it to the right surface based on tab focus:
//
//   - Tab backgrounded → OS notification via the browser Notification API
//     (requires the user to have granted permission in Settings).
//   - Tab focused → an in-app toast: we dispatch a window CustomEvent that
//     the React layer (App.jsx) listens for and renders through ToastHost.
//     Showing an OS toast while the user is already looking at the wallet
//     would be noise, so we route to the in-app surface instead.

/** Event name bridging the non-React adapter to the React toast layer. */
export const NOTIFICATION_EVENT = 'xchain:notification';

/**
 * @returns {(n: { kind: string, title: string, body: string }) => void}
 */
export function createWebNotifyAdapter() {
    return function notify({ kind, title, body }) {
        // In-app channel: always dispatched; the React listener decides
        // whether to show it (it only toasts when the tab is focused).
        try {
            if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: { kind, title, body } }));
            }
        } catch {
            // Non-DOM environment (e.g. a Node smoke run); nothing to do.
        }

        // OS channel: only when backgrounded and permission is granted.
        try {
            if (typeof document !== 'undefined'
                && document.visibilityState === 'hidden'
                && typeof Notification !== 'undefined'
                && Notification.permission === 'granted') {
                // eslint-disable-next-line no-new
                new Notification(title, { body });
            }
        } catch {
            // Permission revoked mid-session / unsupported; silently skip.
        }
    };
}
