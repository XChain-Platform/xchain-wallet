// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop main-process security predicates (§9.3.2 trust boundary).
//
// Pure, Electron-free helpers so the navigation-lockdown + IPC
// sender-trust logic is unit-testable under plain Node (same posture as
// runtime.js / storage.js). index.js imports these and wires them to the
// real Electron APIs (setWindowOpenHandler, will-navigate, shell.openExternal).
//
// Why this exists: every desktop BrowserWindow loads the local renderer
// (`file://.../renderer/dist/index.html`) with the preload attached, and
// the preload exposes `xchainWalletBridge.sendMessage` (unlock / send /
// sign, backed by an auto-unlocked vault). Electron's DEFAULT behavior is
// to ALLOW `window.open` and to inherit the opener's webPreferences
// (including the preload) into the child window, and to allow top-level
// navigation. Without the guards below, any content that reaches a
// preload-bearing window (an external link opened in-app, an inherited
// child window, a mis-wired navigation) can drive the privileged bridge.
// This is the desktop analog of the extension's BRIDGE-1 fix. The guards
// keep every preload-bearing webContents pinned to the local app and push
// all external URLs out to the system browser.
//
// "The local app" means the packaged renderer DIRECTORY, not the `file://`
// scheme. Every caller therefore threads the resolved app root in; see
// isAppUrl for the four ways a naive comparison gets this wrong.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True when `url` carries the `file://` scheme.
 *
 * NOT a trust predicate: the scheme alone says nothing about WHICH local
 * file, and every downloaded HTML page shares it. Use `isAppUrl`.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isLocalFileUrl(url) {
    return typeof url === 'string' && /^file:\/\//i.test(url);
}

/**
 * True when `url` resolves to a file inside the packaged renderer
 * directory `appRoot`, i.e. it really is this app's own renderer.
 *
 * Four properties the comparison has to hold, each one a way a naive
 * check goes wrong:
 *   - Parse, never string-match. Our own window loads
 *     `.../index.html?xc-init-route=<base64>`, so the search string must
 *     drop out; fileURLToPath also decodes the percent-escapes a
 *     packaged path containing spaces carries.
 *   - Require an EMPTY host. `file://server/share/x.html` is a remote UNC
 *     path on Windows and must never read as local.
 *   - Compare resolved paths, not prefixes. A bare startsWith admits a
 *     sibling `renderer/dist-evil/` directory.
 *   - Absent or malformed `appRoot` yields false, so a caller that forgot
 *     to thread it can never accidentally trust anything.
 *
 * Kept fs-free (no realpath) so the module stays pure and Node-testable.
 *
 * @param {unknown} url       the URL to classify
 * @param {unknown} appRoot   absolute path of the packaged renderer dir
 * @returns {boolean}
 */
export function isAppUrl(url, appRoot) {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (typeof appRoot !== 'string' || appRoot.length === 0) return false;
    let resolved;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') return false;
        if (parsed.host !== '') return false;
        resolved = fileURLToPath(parsed);
    } catch {
        return false;
    }
    const rel = path.relative(path.resolve(appRoot), path.resolve(resolved));
    if (rel.length === 0) return false;
    if (path.isAbsolute(rel)) return false;
    return !rel.startsWith('..');
}

/**
 * True when `url` is an http(s) URL, i.e. an external link the wallet
 * should hand to the OS browser rather than load in a preload window.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
    return typeof url === 'string' && /^https?:\/\//i.test(url);
}

/**
 * Navigation guard: block any top-level navigation whose target is not
 * this app's own renderer. A renderer that tries to navigate to a remote
 * origin (which would keep the preload attached, exposing the bridge to
 * that origin) is stopped, and so is one aimed at an arbitrary local HTML
 * file; in-app SPA routing uses history/hash and never fires
 * `will-navigate`, so this never impedes normal use.
 *
 * Fails closed on a missing `appRoot`: a throw here would leave
 * `preventDefault` uncalled and the navigation would proceed.
 *
 * @param {unknown} url       the navigation target
 * @param {unknown} appRoot   absolute path of the packaged renderer dir
 * @returns {boolean}         true means the navigation must be prevented
 */
export function shouldBlockNavigation(url, appRoot) {
    return !isAppUrl(url, appRoot);
}

/**
 * Sender-trust check for privileged IPC channels. Returns true when the
 * calling frame is POSITIVELY identified as something other than this
 * app's own renderer: any non-file scheme, or a `file://` URL outside
 * `appRoot`. Kept deliberately lenient about an unknown/empty URL - not
 * treated as remote - so a legitimate local renderer is never rejected.
 * This is a belt-and-suspenders layer behind the navigation lockdown.
 *
 * Throws when `appRoot` is missing rather than guessing a direction: both
 * consumers (ipcMain handlers, the WebHID permission callback) fail closed
 * on a throw, and a silent scheme-only fallback is the very defect this
 * predicate was rewritten to remove.
 *
 * @param {unknown} url       the sender frame's URL
 * @param {unknown} appRoot   absolute path of the packaged renderer dir
 * @returns {boolean}         true means reject the IPC call
 */
export function isRemoteFrameUrl(url, appRoot) {
    if (typeof appRoot !== 'string' || appRoot.length === 0) {
        throw new TypeError('isRemoteFrameUrl: appRoot (packaged renderer dir) is required');
    }
    if (typeof url !== 'string' || url.length === 0) return false;
    if (isAppUrl(url, appRoot)) return false;
    // Anything else carrying an explicit scheme (http, https, data, blob,
    // or a file:// path outside the app) is remote. A bare path is not.
    return /^[a-z][a-z0-9+.-]*:/i.test(url);
}

/**
 * Resolve the effective URL of an Electron IPC event's sender frame.
 * Prefers `event.senderFrame.url` (the WebFrameMain URL) and falls back
 * to `event.sender.getURL()` (the webContents URL). Returns '' when
 * neither is available (test fakes / pre-load).
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @returns {string}
 */
export function senderFrameUrl(event) {
    const frameUrl = event?.senderFrame?.url;
    if (typeof frameUrl === 'string' && frameUrl.length > 0) return frameUrl;
    const wcUrl = event?.sender?.getURL?.();
    if (typeof wcUrl === 'string' && wcUrl.length > 0) return wcUrl;
    return '';
}

/**
 * True when an IPC event comes from a trusted (this app's own renderer)
 * sender. Rejects only frames positively identified as remote; see
 * isRemoteFrameUrl.
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @param {unknown} appRoot   absolute path of the packaged renderer dir
 * @returns {boolean}
 */
export function isTrustedSenderEvent(event, appRoot) {
    return !isRemoteFrameUrl(senderFrameUrl(event), appRoot);
}
