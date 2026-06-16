// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Browser-facing shim for the `ws` npm package.
//
// `xchain-sdk/src/websocket.js` does:
//     const WebSocket = require('ws');
//     ws.on('open'|'message'|'close'|'error', fn);
//     WebSocket.OPEN, WebSocket.CLOSED, etc.
//
// The browser's native WebSocket uses `.addEventListener` + `.onopen`/
// `.onmessage` rather than EventEmitter-style `.on(event, fn)`. This
// shim translates so the SDK works unchanged in browser builds. The
// Vite configs in `packages/web` and `packages/extension` alias
// `ws` -> this file.
//
// Kept tiny on purpose — every method the SDK actually calls is
// implemented; nothing else. If the SDK grows a new WebSocket call
// site (per-message deflate, pings, etc.) and it fails here, add the
// method. Don't try to be a general-purpose `ws` polyfill.

const globalWs = typeof globalThis !== 'undefined'
    ? globalThis.WebSocket
    : undefined;

if (!globalWs) {
    throw new Error(
        '[xchain-wallet/ws-browser-shim] globalThis.WebSocket is not defined. '
            + 'This shim only runs in browser-like environments.',
    );
}

/**
 * Node-ws-compatible wrapper over the native browser WebSocket. The
 * SDK reads `.readyState`, calls `.send` + `.close`, and subscribes
 * via `.on(event, handler)`.
 */
class BrowserWsShim {
    /**
     * @param {string} url
     * @param {string | string[]} [protocols]
     */
    constructor(url, protocols) {
        this._ws = protocols !== undefined
            ? new globalWs(url, protocols)
            : new globalWs(url);

        /** @type {Record<string, Array<(...args: any[]) => void>>} */
        this._handlers = {
            open: [], message: [], close: [], error: [], ping: [], pong: [],
        };

        this._ws.addEventListener('open', () => this._emit('open'));
        this._ws.addEventListener('message', (event) => {
            // Node's `ws` passes raw data (Buffer | ArrayBuffer | string).
            // Native browser WS gives a MessageEvent whose `.data` is
            // a string for JSON text messages. The SDK calls
            // JSON.parse(data.toString()) — both forms satisfy that.
            this._emit('message', event.data);
        });
        this._ws.addEventListener('close', (event) => {
            this._emit('close', event.code, event.reason);
        });
        this._ws.addEventListener('error', (event) => {
            this._emit('error', event);
        });
    }

    /**
     * @param {'open' | 'message' | 'close' | 'error' | 'ping' | 'pong'} event
     * @param {(...args: any[]) => void} handler
     */
    on(event, handler) {
        if (!this._handlers[event]) this._handlers[event] = [];
        this._handlers[event].push(handler);
        return this;
    }

    off(event, handler) {
        const list = this._handlers[event];
        if (!list) return this;
        const i = list.indexOf(handler);
        if (i >= 0) list.splice(i, 1);
        return this;
    }

    once(event, handler) {
        const wrap = (...args) => {
            this.off(event, wrap);
            handler(...args);
        };
        return this.on(event, wrap);
    }

    _emit(event, ...args) {
        const list = this._handlers[event];
        if (!list) return;
        for (const fn of list.slice()) {
            try { fn(...args); } catch (_err) { /* match Node ws best-effort */ }
        }
    }

    send(data, cb) {
        try {
            this._ws.send(data);
            if (typeof cb === 'function') cb();
        } catch (err) {
            if (typeof cb === 'function') cb(err);
            else throw err;
        }
    }

    close(code, reason) {
        if (code !== undefined && reason !== undefined) {
            this._ws.close(code, reason);
        } else if (code !== undefined) {
            this._ws.close(code);
        } else {
            this._ws.close();
        }
    }

    terminate() {
        // `ws` drops the socket without the close frame; browser
        // WebSocket has no equivalent — close(1000) is the best we can do.
        this._ws.close(1000);
    }

    get readyState() { return this._ws.readyState; }
    get url()        { return this._ws.url; }
    get protocol()   { return this._ws.protocol; }
    get bufferedAmount() { return this._ws.bufferedAmount; }
}

BrowserWsShim.CONNECTING = 0;
BrowserWsShim.OPEN       = 1;
BrowserWsShim.CLOSING    = 2;
BrowserWsShim.CLOSED     = 3;

// Node's `ws` module sets both `module.exports = WebSocket` AND
// `module.exports.WebSocket = WebSocket`, so consumers can write
// either `const WebSocket = require('ws')` or
// `const { WebSocket } = require('ws')`. Replicate both forms.
export default BrowserWsShim;
export { BrowserWsShim as WebSocket };
