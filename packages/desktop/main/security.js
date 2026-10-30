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

export const DESKTOP_RENDERER_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
].join('; ');

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
 * Return response headers with the full renderer CSP applied to app files.
 * The response header carries frame-ancestors, which a meta policy ignores.
 *
 * @param {unknown} url
 * @param {Record<string, string | string[]> | undefined} responseHeaders
 * @param {unknown} appRoot
 * @returns {Record<string, string | string[]>}
 */
export function rendererCspResponseHeaders(url, responseHeaders, appRoot) {
    const headers = { ...(responseHeaders ?? {}) };
    if (!isAppUrl(url, appRoot)) return headers;
    for (const name of Object.keys(headers)) {
        if (name.toLowerCase() === 'content-security-policy') delete headers[name];
    }
    headers['Content-Security-Policy'] = [DESKTOP_RENDERER_CSP];
    return headers;
}

/**
 * Attach the renderer CSP to local app responses in an Electron session.
 *
 * @param {{ onHeadersReceived: Function }} webRequest
 * @param {unknown} appRoot
 */
export function attachRendererCspHeaders(webRequest, appRoot) {
    webRequest.onHeadersReceived(
        { urls: ['file://*/*'] },
        (details, callback) => {
            callback({
                responseHeaders: rendererCspResponseHeaders(
                    details.url,
                    details.responseHeaders,
                    appRoot,
                ),
            });
        },
    );
}

/**
 * True when `url` is an http(s) URL, i.e. an external link the wallet
 * should hand to the OS browser rather than load in a preload window.
 *
 * @param {unknown} url
 * @returns {boolean}
 */
export function isHttpUrl(url) {
    return allowlistedExternalUrl(url) !== null;
}

/**
 * Return the normalized URL when it uses a protocol allowed for the system
 * browser. Credentials are rejected so a displayed host cannot conceal a
 * different destination in userinfo.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function allowlistedExternalUrl(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        if (parsed.username || parsed.password) return null;
        return parsed.href;
    } catch {
        return null;
    }
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
 * Sender classification helper for privileged IPC channels. Returns true
 * when the calling frame is positively identified as something other than
 * this app's own renderer: any non-file scheme, or a `file://` URL outside
 * `appRoot`. Unknown URLs are not classified as remote, but the trust
 * predicate below still rejects them because IPC authority requires a
 * positive app URL.
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
 * Resolve an Electron IPC event's sender-frame URL. The top-level
 * webContents URL is not a substitute: a child frame and its containing
 * page share one webContents but do not share IPC authority.
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @returns {string}
 */
export function senderFrameUrl(event) {
    const frameUrl = event?.senderFrame?.url;
    return typeof frameUrl === 'string' ? frameUrl : '';
}

/**
 * True when an IPC event comes from a trusted (this app's own renderer)
 * sender. IPC authority is fail-closed: an absent, empty, malformed, or
 * non-app frame URL is untrusted.
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @param {unknown} appRoot   absolute path of the packaged renderer dir
 * @returns {boolean}
 */
export function isTrustedSenderEvent(event, appRoot) {
    return isAppUrl(senderFrameUrl(event), appRoot);
}

/**
 * Decide what happens when a page's beforeunload handler tries to cancel an
 * unload (a form with unsent input registers one). Electron has no prompt of
 * its own: with no `will-prevent-unload` listener a reload, a window close
 * and an app quit all stop silently, so a quit, a SIGTERM or a logout
 * would never finish while such a form is open. A quit in progress always
 * lets the page go; any other unload asks the person first.
 *
 * @param {{ quitting: boolean, testMode?: boolean, confirmLeave: () => boolean }} options
 * @returns {boolean}  true means ignore the page's handler and unload
 */
export function shouldIgnoreBeforeUnload({ quitting, testMode = false, confirmLeave }) {
    if (quitting || testMode) return true;
    try {
        return confirmLeave() === true;
    } catch {
        return false;
    }
}

const IPC_MESSAGE_TYPE_MAX_LENGTH = 128;
const OPEN_WINDOW_VIEW_MAX_LENGTH = 128;
const OPEN_WINDOW_CONTEXT_MAX_LENGTH = 16 * 1024;
const OPEN_WINDOW_CONTEXT_MAX_DEPTH = 8;
const OPEN_WINDOW_CONTEXT_MAX_NODES = 1_024;
const SIGNER_ID_MAX_LENGTH = 256;

function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowedKeys) {
    return Object.keys(value).every((key) => allowedKeys.has(key));
}

/**
 * True when an invoke handler received no renderer-supplied arguments.
 * Electron passes the event separately, so handlers collect only the
 * remaining arguments before calling this predicate.
 *
 * @param {unknown} args
 * @returns {boolean}
 */
export function hasNoIpcArguments(args) {
    return Array.isArray(args) && args.length === 0;
}

/**
 * Validate the single generic MessageHost envelope exposed by the preload.
 * Request bodies stay operation-specific and are validated by their
 * dispatcher; this boundary owns the outer `{ type, request? }` shape.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidDesktopIpcMessage(message) {
    if (!isPlainRecord(message)) return false;
    if (!hasOnlyKeys(message, new Set(['type', 'request']))) return false;
    return typeof message.type === 'string'
        && message.type.length > 0
        && message.type.length <= IPC_MESSAGE_TYPE_MAX_LENGTH;
}

function isBoundedJsonValue(value, depth, state, ancestors) {
    state.nodes += 1;
    if (state.nodes > OPEN_WINDOW_CONTEXT_MAX_NODES) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= OPEN_WINDOW_CONTEXT_MAX_LENGTH;
    if (depth >= OPEN_WINDOW_CONTEXT_MAX_DEPTH || typeof value !== 'object') return false;
    if (ancestors.has(value)) return false;

    const isArray = Array.isArray(value);
    if (!isArray && !isPlainRecord(value)) return false;
    ancestors.add(value);
    const entries = isArray ? value : Object.values(value);
    const valid = entries.every((entry) => isBoundedJsonValue(entry, depth + 1, state, ancestors));
    ancestors.delete(value);
    return valid;
}

/**
 * Validate and normalize the detached-window route documented by the
 * preload. The context is data for renderer routing only and must remain a
 * bounded JSON object that main never interprets as a path, URL, or
 * executable input.
 *
 * @param {unknown} args
 * @returns {{ initialView: string, initialContext: object | null } | null}
 */
export function normalizeOpenWindowArgs(args) {
    if (!isPlainRecord(args)) return null;
    if (!hasOnlyKeys(args, new Set(['initialView', 'initialContext']))) return null;

    let initialView = '';
    if (Object.hasOwn(args, 'initialView')) {
        if (typeof args.initialView !== 'string') return null;
        if (args.initialView.length === 0 || args.initialView.length > OPEN_WINDOW_VIEW_MAX_LENGTH) return null;
        initialView = args.initialView;
    }

    let initialContext = null;
    if (Object.hasOwn(args, 'initialContext')) {
        if (!isPlainRecord(args.initialContext)) return null;
        const state = { nodes: 0 };
        if (!isBoundedJsonValue(args.initialContext, 0, state, new WeakSet())) return null;
        let serialized;
        try { serialized = JSON.stringify(args.initialContext); } catch { return null; }
        if (serialized.length > OPEN_WINDOW_CONTEXT_MAX_LENGTH) return null;
        initialContext = args.initialContext;
    }

    if (!initialView && !initialContext) return null;
    return { initialView, initialContext };
}

/**
 * Validate renderer-to-main frames on the signer bridge. Registration and
 * response frames are the complete inbound surface documented by the shared
 * signer port protocol.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidSignerBridgeMessage(message) {
    if (!isPlainRecord(message) || typeof message.kind !== 'string') return false;

    if (message.kind === 'register' || message.kind === 'unregister') {
        if (!hasOnlyKeys(message, new Set(['kind', 'signerIds']))) return false;
        if (!Array.isArray(message.signerIds)) return false;
        return message.signerIds.every((signerId) => (
            typeof signerId === 'string'
            && signerId.length > 0
            && signerId.length <= SIGNER_ID_MAX_LENGTH
        ));
    }

    if (message.kind !== 'response') return false;
    if (!Number.isSafeInteger(message.reqId) || message.reqId < 1) return false;
    if (typeof message.ok !== 'boolean') return false;
    if (message.ok) {
        return hasOnlyKeys(message, new Set(['kind', 'reqId', 'ok', 'result']))
            && Object.hasOwn(message, 'result');
    }
    if (!hasOnlyKeys(message, new Set(['kind', 'reqId', 'ok', 'error']))) return false;
    return isPlainRecord(message.error)
        && hasOnlyKeys(message.error, new Set(['name', 'message']))
        && typeof message.error.name === 'string'
        && message.error.name.length > 0
        && typeof message.error.message === 'string'
        && message.error.message.length > 0;
}

