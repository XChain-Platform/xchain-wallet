// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Trezor Connect bridge window, owned by the main process.
//
// TRUST BOUNDARY (§40.12). Trezor Connect is a hosted third-party script
// (T-RSL keeps it out of the bundle), so it never runs in the app's own
// renderer: that document holds the preload bridges and the WebHID grant
// for a paired Ledger. It runs in a window main builds here, because only a
// window main constructs itself honours `webPreferences.session`. A child
// from `window.open` runs in its opener's session whatever the open handler
// asks for, which would hand the hosted script the main session's HID
// handlers.
//
// The window:
//   - lives on the isolated in-memory partition index.js builds, which is
//     wired to permissions.js#attachHidDenial and never to the HID grant;
//   - runs sandboxed, with context isolation on and Node off;
//   - loads a packaged local document (trezorBridge/connect.html), never a
//     data: URL, which Chromium refuses as a top-level navigation;
//   - carries only the bridge preload (trezorBridge/preload.cjs), whose one
//     world answers Connect requests and nothing else.
//
// The app renderer reaches it through `xchainWalletTrezorBridge` in the app
// preload: main checks each call against CONNECT_METHODS, opens and
// initializes the window on demand, relays the request on the window's own
// IPC, and accepts a reply only from that window's main frame at the bridge
// document's URL. A window the person closes settles every waiting call
// with BRIDGE_CLOSED_MESSAGE, which the confirm screen reads as a retryable
// disconnect, so nothing is broadcast and the next call opens a fresh window.

import { pathToFileURL } from 'node:url';

import { showWindow } from './testFocus.js';

/** Main to bridge: one Connect request. Mirrored in trezorBridge/preload.cjs. */
export const TREZOR_BRIDGE_REQUEST_CHANNEL = 'xchain:trezor-bridge-request';
/** Bridge to main: one Connect reply. Mirrored in trezorBridge/preload.cjs. */
export const TREZOR_BRIDGE_REPLY_CHANNEL = 'xchain:trezor-bridge-reply';
/** Bridge to main: the document and its responder are loaded. Mirrored in trezorBridge/preload.cjs. */
export const TREZOR_BRIDGE_READY_CHANNEL = 'xchain:trezor-bridge-ready';

/**
 * The Connect methods the app renderer may call: exactly what core's
 * makeTrezorFactory and TrezorSigner use. `init` is main's alone, sent once
 * per window with the manifest below.
 */
export const CONNECT_METHODS = Object.freeze([
    'getFeatures',
    'getAddress',
    'getPublicKey',
    'signTransaction',
    'signMessage',
]);

/**
 * Trezor Connect manifest. Must match a domain Trezor whitelists or the
 * popup blocks. Desktop uses the same manifest as the extension and web.
 */
export const TREZOR_CONNECT_MANIFEST = Object.freeze({
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
});

/**
 * The refusal for work a closed bridge cannot answer. Worded so the confirm
 * screen reads it as a retryable disconnect: the app never received a signed
 * transaction from this window, so nothing was broadcast.
 */
export const BRIDGE_CLOSED_MESSAGE = 'desktop trezorFactory: the Trezor Connect transport disconnected because its '
    + 'window closed before the device answered. Nothing was broadcast.';

const REFUSED_CALL_MESSAGE = 'desktop trezorFactory: the Trezor Connect bridge refuses this call';
const REPLY_ID_PATTERN = /^[1-9]\d{0,14}$/;
const REPLY_ERROR_MAX_LENGTH = 2000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}

/**
 * A renderer call main relays: `{ method, args }` with a Connect method the
 * signer uses and a plain-object (or absent) argument.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidBridgeCall(message) {
    return isRecord(message)
        && hasOnlyKeys(message, ['method', 'args'])
        && CONNECT_METHODS.includes(message.method)
        && (message.args === undefined || isRecord(message.args));
}

/**
 * A bridge reply main accepts: `{ id, ok: true, result }` or
 * `{ id, ok: false, error }` with a non-empty error string.
 *
 * @param {unknown} message
 * @returns {boolean}
 */
export function isValidBridgeReply(message) {
    if (!isRecord(message) || !hasOnlyKeys(message, ['id', 'ok', 'result', 'error'])) return false;
    if (typeof message.id !== 'string' || !REPLY_ID_PATTERN.test(message.id)) return false;
    if (message.ok === true) return !Object.hasOwn(message, 'error');
    if (message.ok !== false || Object.hasOwn(message, 'result')) return false;
    return typeof message.error === 'string' && message.error.length > 0
        && message.error.length <= REPLY_ERROR_MAX_LENGTH;
}

/**
 * BrowserWindow options for the bridge. Exported so the isolation it pins
 * is tested on the object main passes to Electron.
 *
 * @param {{ session: unknown, preloadPath: string, devTools?: boolean }} options
 */
export function bridgeWindowOptions({ session, preloadPath, devTools = false }) {
    return {
        show: false,
        width: 420,
        height: 640,
        title: 'Trezor Connect',
        autoHideMenuBar: true,
        webPreferences: {
            session,
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            devTools,
        },
    };
}

/**
 * Build the bridge controller. Electron pieces are injected so the relay and
 * its lifecycle run under plain Node in tests.
 *
 * @param {{
 *   BrowserWindow: new (options: object) => any,
 *   getSession: () => unknown,
 *   preloadPath: string,
 *   documentPath: string,
 *   devTools?: boolean,
 *   show?: (win: any) => void,
 * }} deps
 */
export function createTrezorBridge({
    BrowserWindow,
    getSession,
    preloadPath,
    documentPath,
    devTools = false,
    show = showWindow,
}) {
    const documentUrl = pathToFileURL(documentPath).href;
    /** @type {any | null} */
    let current = null;
    /** @type {Promise<void> | null} */
    let ready = null;
    /** @type {Map<string, { win: any, resolve: (envelope: object) => void }>} */
    const pending = new Map();
    let nextId = 1;

    /** True when an IPC event comes from `win`'s own top frame at the bridge document. */
    function fromBridgeDocument(event, win) {
        if (!win || win.isDestroyed() || event?.sender !== win.webContents) return false;
        const frame = event.senderFrame;
        return Boolean(frame) && frame === win.webContents.mainFrame && frame.url === documentUrl;
    }

    function settleWindow(win, envelope) {
        for (const [id, entry] of pending) {
            if (entry.win !== win) continue;
            pending.delete(id);
            entry.resolve(envelope);
        }
    }

    function post(win, method, args) {
        if (!win || win.isDestroyed()) return Promise.resolve({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
        const id = String(nextId);
        nextId += 1;
        return new Promise((resolve) => {
            pending.set(id, { win, resolve });
            try {
                win.webContents.send(TREZOR_BRIDGE_REQUEST_CHANNEL, { id, method, args });
            } catch {
                pending.delete(id);
                resolve({ ok: false, error: BRIDGE_CLOSED_MESSAGE });
            }
        });
    }

    function handleReply(win, event, message) {
        if (win !== current || !fromBridgeDocument(event, win) || !isValidBridgeReply(message)) return;
        const entry = pending.get(message.id);
        if (!entry || entry.win !== win) return;
        pending.delete(message.id);
        entry.resolve(message.ok ? { ok: true, result: message.result } : { ok: false, error: message.error });
    }

    function closeWindow(win) {
        if (win && !win.isDestroyed()) win.close();
    }

    /** Open a bridge window and resolve once its document reports ready. */
    function openWindow() {
        const win = new BrowserWindow(bridgeWindowOptions({ session: getSession(), preloadPath, devTools }));
        current = win;
        const loaded = new Promise((resolve, reject) => {
            const fail = () => reject(new Error(BRIDGE_CLOSED_MESSAGE));
            win.webContents.ipc.on(TREZOR_BRIDGE_READY_CHANNEL, (event) => {
                if (win === current && fromBridgeDocument(event, win)) resolve();
            });
            win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
                if (isMainFrame !== false) closeWindow(win);
            });
            win.on('closed', () => {
                if (current === win) {
                    current = null;
                    ready = null;
                }
                settleWindow(win, { ok: false, error: BRIDGE_CLOSED_MESSAGE });
                fail();
            });
        });
        win.webContents.ipc.on(TREZOR_BRIDGE_REPLY_CHANNEL, (event, message) => handleReply(win, event, message));
        win.once('ready-to-show', () => {
            if (!win.isDestroyed()) show(win);
        });
        Promise.resolve(win.loadFile(documentPath)).catch(() => closeWindow(win));
        return { win, loaded };
    }

    /** Open and initialize a bridge once; concurrent callers share it. */
    function ensureReady() {
        if (current && ready) return ready;
        const { win, loaded } = openWindow();
        const opening = (async () => {
            await loaded;
            const init = await post(win, 'init', {
                manifest: { ...TREZOR_CONNECT_MANIFEST },
                lazyLoad: true,
                popup: false,
            });
            if (!init.ok) throw new Error(init.error);
        })();
        const tracked = opening.catch((err) => {
            if (ready === tracked) ready = null;
            closeWindow(win);
            throw err;
        });
        ready = tracked;
        return tracked;
    }

    return {
        /**
         * Relay one renderer call. Always resolves to an envelope.
         *
         * @param {unknown} message
         * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string }>}
         */
        async call(message) {
            if (!isValidBridgeCall(message)) return { ok: false, error: REFUSED_CALL_MESSAGE };
            try {
                await ensureReady();
            } catch (err) {
                return { ok: false, error: String(err?.message || BRIDGE_CLOSED_MESSAGE) };
            }
            return post(current, message.method, message.args);
        },
        /** Close the open bridge window; every waiting call settles as closed. */
        close() {
            closeWindow(current);
            return { ok: true };
        },
        /** The open bridge window, or null. */
        window() {
            return current;
        },
    };
}
