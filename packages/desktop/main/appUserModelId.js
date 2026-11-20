// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Windows AppUserModelID the running app claims.
//
// The NSIS installer stamps this id onto every shortcut it writes
// (WinShell::SetLnkAUMI with APP_ID, which is the config's appId), and the
// taskbar matches a running window to a pinned or Start-menu shortcut by
// it. Electron sets no id of its own, so without this call Windows derives
// one from the exe path, which matches no shortcut: the running app gets a
// second taskbar button beside a pinned one, and its button cannot borrow
// the shortcut's icon. It must run before the first window exists, so it
// runs before app ready.
//
// Not in the Microsoft Store build: an MSIX app's id comes from its package
// identity, and overriding it detaches the window from the Store tile.
//
// test/unit/desktop/appUserModelId.test.js holds this id equal to
// electron-builder.config.cjs `appId`.

export const WINDOWS_APP_USER_MODEL_ID = 'io.xchain.wallet.desktop';

/**
 * Claim the installer's AppUserModelID on a Windows desktop install.
 *
 * @param {{ setAppUserModelId?: (id: string) => void }} app Electron's app
 * @param {{ platform?: string, windowsStore?: boolean }} [env]
 * @returns {boolean} whether the id was set
 */
export function applyAppUserModelId(app, {
    platform = process.platform,
    windowsStore = process.windowsStore === true,
} = {}) {
    if (platform !== 'win32' || windowsStore) return false;
    if (!app || typeof app.setAppUserModelId !== 'function') return false;
    app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
    return true;
}
