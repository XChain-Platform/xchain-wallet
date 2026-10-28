// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Trezor Connect factory: Electron desktop renderer.
//
// LICENSE NOTE (T-RSL): `@trezor/connect-web` and its `@trezor/*`
// dependency tree ship under the Trezor Reference Source License,
// which forbids redistribution outside your company. Bundling it into
// the packaged desktop app would violate that license and the wallet's
// own AGPL. So we do NOT depend on the npm package; the hosted Trezor
// Connect global build (`https://connect.trezor.io/9/trezor-connect.js`,
// exposing `window.TrezorConnect`) is loaded at runtime. The packaged
// artifact contains zero `@trezor/*` code.
//
// TRUST BOUNDARY (§40.12). The hosted script used to load as a
// plain <script> tag into THIS renderer's own top-level document. That
// made a compromised script indistinguishable from the app's own code:
// same document, same origin, same everything the WebHID device handlers
// in main/permissions.js check. It ran inside the same session that had
// been granted `hid` for the app's own paired Ledger/Trezor.
//
// It now runs inside a dedicated BRIDGE WINDOW that main/index.js opens
// on its own Electron session (see security.js#isTrezorConnectBridgeWindowOpen),
// a session explicitly wired to permissions.js#attachHidDenial and so
// cannot be granted a device no matter what the hosted script does. This
// module opens that window via a plain `window.open()` (main.js's
// window-open handler recognizes the marker name and swaps in the
// isolated session; nothing here needs Electron APIs or a preload change)
// and talks to it over `postMessage`, which is the one channel two
// browsing contexts on different sessions still share.
//
// The bridge window gets no preload, so it never sees xchainWalletBridge
// or xchainWalletSignerBridge; all it can do is run TrezorConnect and
// answer the narrow, allowlisted RPC below.
//
// Same pair-sequence shape as the web shell; the sequence itself lives
// in core's `makeTrezorFactory`, this file only owns the desktop
// bridge-window loader + RPC + init.

import { makeTrezorFactory, walletOnlyRegistry } from '@xchain-wallet/core/signerFactories';

// Must match main/security.js's TREZOR_CONNECT_BRIDGE_WINDOW_NAME
// byte-for-byte (index.js's window-open handler keys off it). Not
// imported: security.js also carries `node:path`/`node:url` predicates
// for the main-process trust boundary, and this renderer bundle (vite,
// no Node built-ins beyond the polyfilled shims in vite.config.js) fails
// to build against those. A plain string is the whole shared contract.
const TREZOR_CONNECT_BRIDGE_WINDOW_NAME = 'xchain-trezor-connect-bridge';

/**
 * Hosted Trezor Connect global build (9.x line, matching the API
 * surface TrezorSigner expects).
 */
const TREZOR_CONNECT_SCRIPT_SRC = 'https://connect.trezor.io/9/trezor-connect.js';
const TREZOR_CONNECT_ORIGIN = 'https://connect.trezor.io';

/**
 * Trezor Connect manifest. Must match a domain Trezor whitelists or
 * the popup blocks. Desktop uses the same manifest as extension/web
 * for now; a separate desktop manifest is a Step-19 follow-up.
 */
const MANIFEST = {
    email: 'support@xchain.io',
    appUrl: 'https://xchain.io/wallet',
};

/**
 * The only methods the bridge will forward to `window.TrezorConnect`.
 * Matches exactly what core's makeTrezorFactory + TrezorSigner call
 * (getFeatures, getAddress, getPublicKey, signTransaction, signMessage)
 * plus `init` itself. A strict allowlist rather than an open method-name
 * forward, even though the bridge only ever takes requests from the
 * window that opened it: defense in depth against a future caller
 * threading an unexpected method name through.
 */
const ALLOWED_METHODS = ['init', 'getFeatures', 'getAddress', 'getPublicKey', 'signTransaction', 'signMessage'];

/**
 * The bridge document's entire script, as a string rather than a real
 * function: this module is bundled by vite, and a `Function#toString()`
 * embed would depend on the bundler preserving the exact source text of
 * a function it is free to rename or transform. As a template string it
 * is just data and ships byte for byte.
 *
 * Runs inside the isolated bridge window (its own Electron session, no
 * preload, CSP-restricted to the Trezor Connect origin below). On
 * load it posts a ready message to `window.opener`, then answers
 * postMessage RPC calls of the shape `{ id, method, args }` by calling
 * `window.TrezorConnect[method](args)` and replying `{ id, ok, result }`
 * or `{ id, ok: false, error }`. Refuses any message whose `event.source`
 * is not `window.opener`: that is the one signal that survives here
 * (this document's own reported origin is an opaque `data:` origin, of no
 * use for a same-origin check), and it also excludes Trezor's own
 * cross-origin iframe, which is a different `event.source`.
 */
const BRIDGE_READY_MESSAGE = 'xchain-trezor-bridge-ready';
function buildBridgeResponderSource(allowedMethodsJson, readyType) {
    return `(function(){
  var allowed = {};
  var list = ${allowedMethodsJson};
  for (var i = 0; i < list.length; i += 1) allowed[list[i]] = true;
  window.addEventListener('message', function (event) {
    if (!window.opener || event.source !== window.opener) return;
    var msg = event.data;
    if (!msg || typeof msg.id !== 'string' || !allowed[msg.method]) return;
    Promise.resolve().then(function () {
      if (!window.TrezorConnect) throw new Error('TrezorConnect not loaded');
      return window.TrezorConnect[msg.method](msg.args);
    }).then(function (result) {
      event.source.postMessage({ id: msg.id, ok: true, result: result }, '*');
    }).catch(function (err) {
      event.source.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) }, '*');
    });
  });
  if (window.opener) window.opener.postMessage({ type: '${readyType}' }, '*');
})();`;
}

/**
 * Build the isolated bridge document. Everything it needs is inlined so
 * there is no separate HTML file to keep in sync with this module.
 *
 * CSP is deliberately tight: `default-src 'none'` plus exactly the
 * Trezor Connect origin for script/connect/frame, and the one inline
 * responder script admitted by a fresh per-window nonce rather than
 * `'unsafe-inline'`.
 *
 * @returns {string} a `data:` URL for `window.open`
 */
function buildBridgeDataUrl() {
    const nonce = makeNonce();
    const csp = [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' ${TREZOR_CONNECT_ORIGIN}`,
        `connect-src ${TREZOR_CONNECT_ORIGIN}`,
        `frame-src ${TREZOR_CONNECT_ORIGIN}`,
        "style-src 'unsafe-inline'",
    ].join('; ');
    const responder = buildBridgeResponderSource(JSON.stringify(ALLOWED_METHODS), BRIDGE_READY_MESSAGE);
    const html = `<!doctype html><html><head>`
        + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
        + `<script src="${TREZOR_CONNECT_SCRIPT_SRC}"></script>`
        + `</head><body><script nonce="${nonce}">${responder}</script></body></html>`;
    return `data:text/html;base64,${toBase64(html)}`;
}

function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

function makeNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

/** @type {Window | null} */
let bridgeWindow = null;
/** @type {((event: MessageEvent) => void) | null} */
let messageListener = null;
/** @type {((event: MessageEvent) => void) | null} */
let readyListener = null;
/** @type {((err: Error) => void) | null} */
let rejectOpen = null;
/** @type {ReturnType<typeof setInterval> | null} */
let closeWatch = null;
/** @type {Promise<void> | null} */
let bridgeReady = null;
/** Whether bridgeReady has resolved: the bridge is open and TrezorConnect is initialized. */
let bridgeLive = false;
/** @type {Map<string, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const pendingCalls = new Map();
let nextCallId = 1;

/**
 * How often an open bridge window is checked for having been closed. It is a
 * real window the user can close, and a closed window never answers, so a call
 * waiting on it would otherwise wait forever behind a locked confirm screen.
 */
const BRIDGE_CLOSED_POLL_MS = 500;

/**
 * The refusal for work a closed bridge cannot answer. Worded so the
 * confirm screen reads it as a retryable disconnect: the app never received a
 * signed transaction from this window, so nothing was broadcast.
 */
function bridgeClosedError() {
    return new Error('desktop trezorFactory: the Trezor Connect transport disconnected because its '
        + 'window closed before the device answered. Nothing was broadcast.');
}

function handleBridgeMessage(event) {
    if (!bridgeWindow || event.source !== bridgeWindow) return;
    const msg = event.data;
    if (!msg || typeof msg.id !== 'string') return;
    const entry = pendingCalls.get(msg.id);
    if (!entry) return;
    pendingCalls.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'desktop trezorFactory: bridge call failed'));
}

/**
 * Forget the bridge window and settle everything waiting on it with `err`, so
 * the next call opens a fresh bridge. Closes the window if it is still open.
 *
 * @param {Error} err
 */
function dropBridge(err) {
    const win = bridgeWindow;
    bridgeWindow = null;
    bridgeReady = null;
    bridgeLive = false;
    if (closeWatch !== null) {
        clearInterval(closeWatch);
        closeWatch = null;
    }
    if (readyListener && typeof window !== 'undefined') window.removeEventListener('message', readyListener);
    readyListener = null;
    const reject = rejectOpen;
    rejectOpen = null;
    if (reject) reject(err);
    for (const entry of pendingCalls.values()) entry.reject(err);
    pendingCalls.clear();
    if (win && !win.closed) {
        try {
            win.close();
        } catch {
            // best-effort
        }
    }
}

/** Drop the bridge once `win` reports closed, settling whatever waits on it. */
function watchForClose(win) {
    if (closeWatch !== null) clearInterval(closeWatch);
    closeWatch = setInterval(() => {
        if (bridgeWindow === win && win.closed) dropBridge(bridgeClosedError());
    }, BRIDGE_CLOSED_POLL_MS);
}

/**
 * Open the isolated bridge window and wait for its ready signal. Only
 * ensureBridge calls this, and never while a bridge is open or opening.
 *
 * @returns {Promise<Window>}
 */
function openBridgeWindow() {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            reject(new Error('desktop trezorFactory: no window available to open the Trezor Connect bridge (renderer-only)'));
            return;
        }
        const win = window.open(buildBridgeDataUrl(), TREZOR_CONNECT_BRIDGE_WINDOW_NAME);
        if (!win) {
            reject(new Error('desktop trezorFactory: Trezor Connect bridge window was refused'));
            return;
        }
        bridgeWindow = win;
        rejectOpen = reject;
        if (!messageListener) {
            messageListener = handleBridgeMessage;
            window.addEventListener('message', messageListener);
        }
        readyListener = (event) => {
            if (event.source !== win) return;
            if (event.data && event.data.type === BRIDGE_READY_MESSAGE) {
                window.removeEventListener('message', readyListener);
                readyListener = null;
                rejectOpen = null;
                resolve(win);
            }
        };
        window.addEventListener('message', readyListener);
        watchForClose(win);
    });
}

/**
 * Post one allowlisted method to the open bridge's `window.TrezorConnect`.
 *
 * @param {string} method
 * @param {any} [args]
 * @returns {Promise<any>}
 */
function postBridgeCall(method, args) {
    if (!bridgeWindow || bridgeWindow.closed) return Promise.reject(bridgeClosedError());
    const target = bridgeWindow;
    return new Promise((resolve, reject) => {
        const id = String(nextCallId);
        nextCallId += 1;
        pendingCalls.set(id, { resolve, reject });
        target.postMessage({ id, method, args }, '*');
    });
}

/**
 * Open the bridge and init TrezorConnect inside it, once per bridge window.
 * A failed open or init closes the window and is not kept, so the next call
 * tries again, and a window closed later is replaced by the next call.
 *
 * @returns {Promise<void>}
 */
function ensureBridge() {
    if (bridgeReady && bridgeWindow && !bridgeWindow.closed) return bridgeReady;
    if (bridgeWindow) dropBridge(bridgeClosedError());
    const pending = (async () => {
        await openBridgeWindow();
        await postBridgeCall('init', { manifest: MANIFEST, lazyLoad: true });
        bridgeLive = true;
    })();
    const ready = pending.catch((err) => {
        if (bridgeReady === ready) dropBridge(err);
        throw err;
    });
    bridgeReady = ready;
    return ready;
}

/**
 * Call one allowlisted method on the bridge's `window.TrezorConnect`,
 * opening a fresh bridge first when the last one closed.
 *
 * @param {string} method
 * @param {any} [args]
 * @returns {Promise<any>}
 */
function bridgeCall(method, args) {
    // Posted in the same tick when the bridge is live, so calls keep their order.
    if (bridgeLive && bridgeWindow && !bridgeWindow.closed) return postBridgeCall(method, args);
    return ensureBridge().then(() => postBridgeCall(method, args));
}

/**
 * The object handed back to core's `makeTrezorFactory` / `TrezorSigner`:
 * exactly the method surface they call, each one proxied to the bridge
 * window over postMessage.
 */
function makeConnectProxy() {
    return {
        getFeatures: (args) => bridgeCall('getFeatures', args),
        getAddress: (args) => bridgeCall('getAddress', args),
        getPublicKey: (args) => bridgeCall('getPublicKey', args),
        signTransaction: (args) => bridgeCall('signTransaction', args),
        signMessage: (args) => bridgeCall('signMessage', args),
    };
}

/** @type {Promise<any> | null} */
let connectPromise = null;

/**
 * Production path: open the bridge window, init TrezorConnect inside it,
 * hand back the proxy.
 *
 * @returns {Promise<any>}
 */
async function connectOverBridge() {
    await ensureBridge();
    return makeConnectProxy();
}

/**
 * Lazy-init Trezor Connect. `loader` is injectable for tests: when given,
 * it bypasses the bridge entirely and must resolve to a usable
 * TrezorConnect-shaped object (or `{ default: <that> }`), matching the
 * previous npm dynamic-import return shape. In production (no loader)
 * Trezor Connect runs inside the isolated bridge window. A failed connect is
 * not kept, so the next call tries again.
 *
 * @param {() => Promise<any>} [loader]
 */
export async function getTrezorConnect(loader) {
    if (!connectPromise) {
        const pending = loader ? loadViaInjectedLoader(loader) : connectOverBridge();
        const retryable = pending.catch((err) => {
            if (connectPromise === retryable) connectPromise = null;
            throw err;
        });
        connectPromise = retryable;
    }
    return connectPromise;
}

async function loadViaInjectedLoader(loader) {
    const mod = await loader();
    const TrezorConnect = mod?.default ?? mod;
    if (!TrezorConnect || typeof TrezorConnect.init !== 'function') {
        throw new Error('desktop trezorFactory: loaded module does not look like Trezor Connect');
    }
    await TrezorConnect.init({ manifest: MANIFEST, lazyLoad: true });
    return TrezorConnect;
}

/**
 * @param {Object} [opts]
 * @param {() => Promise<any>} [opts.loader]
 * @param {() => Promise<any>} [opts.walletLoader]
 */
export async function pairTrezorSigner({ loader, walletLoader = defaultWalletLoader } = {}) {
    const factory = makeTrezorFactory({
        getConnect: () => getTrezorConnect(loader),
        getSdkRegistry: async () => {
            const mod = await walletLoader();
            return walletOnlyRegistry(mod?.default ?? mod);
        },
    });
    return factory();
}

function defaultWalletLoader() {
    return import('xchain-sdk/src/wallet.js');
}

export function resetTrezorConnect() {
    connectPromise = null;
    dropBridge(new Error('desktop trezorFactory: Trezor Connect bridge was reset'));
    if (typeof window !== 'undefined' && messageListener) {
        window.removeEventListener('message', messageListener);
    }
    messageListener = null;
}
