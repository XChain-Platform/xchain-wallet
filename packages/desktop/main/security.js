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

/**
 * True when `url` is a local `file://` URL (our packaged renderer).
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isLocalFileUrl(url) {
    return typeof url === 'string' && /^file:\/\//i.test(url);
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
 * the local app. A renderer that tries to navigate to a remote origin
 * (which would keep the preload attached, exposing the bridge to that
 * origin) is stopped; in-app SPA routing uses history/hash and never
 * fires `will-navigate`, so this never impedes normal use.
 *
 * @param {unknown} url  the navigation target
 * @returns {boolean}    true means the navigation must be prevented
 */
export function shouldBlockNavigation(url) {
    return !isLocalFileUrl(url);
}

/**
 * Sender-trust check for privileged IPC channels. Returns true only when
 * the calling frame can be POSITIVELY identified as a non-local origin
 * (any explicit scheme other than file://). Kept deliberately lenient -
 * an unknown/empty URL is not treated as remote - so a legitimate local
 * renderer is never rejected while a hijacked frame (which, post the
 * navigation guard, could only ever be http(s)/other) is. This is a
 * belt-and-suspenders layer behind the navigation lockdown.
 *
 * @param {unknown} url  the sender frame's URL
 * @returns {boolean}    true means reject the IPC call
 */
export function isRemoteFrameUrl(url) {
    if (typeof url !== 'string' || url.length === 0) return false;
    if (isLocalFileUrl(url)) return false;
    // Any explicit non-file scheme (http, https, ws, data, blob, ...) is
    // treated as remote/untrusted. A bare path with no scheme is not.
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
 * True when an IPC event comes from a trusted (local, non-remote) sender.
 * Rejects only frames positively identified as remote; see isRemoteFrameUrl.
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @returns {boolean}
 */
export function isTrustedSenderEvent(event) {
    return !isRemoteFrameUrl(senderFrameUrl(event));
}
