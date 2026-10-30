// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Screen capture protection for a desktop window that shows key material
// (§1, stage S4). Core's screenGuard decides WHICH screens need it (recovery
// phrase, private key, secret entry, unlock); the renderer forwards each on
// and off through the preload, and this applies it with
// BrowserWindow.setContentProtection, which keeps the window's pixels out of
// screenshots, screen recordings and screen shares on macOS and Windows.

export const SCREEN_PROTECTION_CHANNEL = 'xchain:screen-protection';
export const WINDOW_HIDDEN_CHANNEL = 'xchain:window-hidden';

/**
 * Tell one trusted renderer that its native window is hidden or minimized.
 * Minimize and tray-hide do not reliably produce DOM blur or visibility events.
 *
 * @param {{ webContents?: { send: (channel: string) => void, isDestroyed?: () => boolean }, isDestroyed?: () => boolean } | null} win
 * @returns {boolean}
 */
export function notifyWindowHidden(win) {
    if (!win || win.isDestroyed?.() || !win.webContents || win.webContents.isDestroyed?.()) {
        return false;
    }
    win.webContents.send(WINDOW_HIDDEN_CHANNEL);
    return true;
}

/**
 * Apply a renderer's protect or release request to the window that sent it.
 * The target is always the sender's own window, so one renderer can never
 * change another window's protection.
 *
 * @param {any} event   the IpcMainInvokeEvent
 * @param {unknown[]} args   the arguments after the event
 * @param {{
 *   isTrustedSender: (event: any) => boolean,
 *   windowFor: (sender: any) => ({ setContentProtection: (on: boolean) => void, isDestroyed?: () => boolean } | null),
 * }} deps
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function applyScreenProtection(event, args, { isTrustedSender, windowFor }) {
    if (!isTrustedSender(event)) {
        return { ok: false, error: 'screen-protection: rejected from untrusted frame' };
    }
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'boolean') {
        return { ok: false, error: 'screen-protection: takes one boolean' };
    }
    const win = windowFor(event?.sender);
    if (!win || win.isDestroyed?.()) {
        return { ok: false, error: 'screen-protection: no window for this sender' };
    }
    win.setContentProtection(args[0]);
    return { ok: true };
}
