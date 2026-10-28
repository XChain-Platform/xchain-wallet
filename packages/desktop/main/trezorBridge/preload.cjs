// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Trezor Connect bridge window's preload (§40.12). It runs only in the
// window main/trezorBridgeWindow.js builds on the isolated no-HID session,
// never in the app renderer, and exposes one world to the bridge page:
//
//   - `xchainTrezorConnectBridge.onRequest(listener)`: receive main's
//     relayed Connect requests, `{ id, method, args }`, with the method one
//     of the Connect calls the signer uses or main's own `init`. One
//     listener per page.
//   - `xchainTrezorConnectBridge.reply(message)`: answer one request with
//     `{ id, ok: true, result }` or `{ id, ok: false, error }`.
//   - `xchainTrezorConnectBridge.ready()`: report the page loaded.
//
// Nothing else crosses: no wallet message channel, no signer bridge, no
// Electron or Node handle. A frame shape main would drop throws here, and
// main checks every reply again against the sending frame and its URL.
//
// CommonJS for the same reason as the app preload: Electron loads sandboxed
// preloads through its CJS wrapper, and `require('electron')` is the only
// module a sandboxed preload may pull in, so the channel names and the
// method list are written out here and pinned against
// main/trezorBridgeWindow.js by test/unit/desktop/trezorBridgeWindow.test.js.

const { contextBridge, ipcRenderer } = require('electron');

const REQUEST_CHANNEL = 'xchain:trezor-bridge-request';
const REPLY_CHANNEL = 'xchain:trezor-bridge-reply';
const READY_CHANNEL = 'xchain:trezor-bridge-ready';
const REQUEST_METHODS = ['init', 'getFeatures', 'getAddress', 'getPublicKey', 'signTransaction', 'signMessage'];
const ID_PATTERN = /^[1-9]\d{0,14}$/;
const ERROR_MAX_LENGTH = 2000;

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every((key) => allowed.includes(key));
}

function isValidRequest(message) {
    return isRecord(message)
        && hasOnlyKeys(message, ['id', 'method', 'args'])
        && typeof message.id === 'string' && ID_PATTERN.test(message.id)
        && REQUEST_METHODS.includes(message.method)
        && (message.args === undefined || isRecord(message.args));
}

function validateReply(args) {
    const method = 'xchainTrezorConnectBridge.reply';
    if (args.length !== 1) throw new TypeError(`${method}: expected 1 argument`);
    const message = args[0];
    if (!isRecord(message) || !hasOnlyKeys(message, ['id', 'ok', 'result', 'error'])) {
        throw new TypeError(`${method}: expected { id, ok, result } or { id, ok, error }`);
    }
    if (typeof message.id !== 'string' || !ID_PATTERN.test(message.id)) {
        throw new TypeError(`${method}: id must be a request id`);
    }
    if (message.ok === true) {
        if (Object.hasOwn(message, 'error')) throw new TypeError(`${method}: a success carries no error`);
        return { id: message.id, ok: true, result: message.result };
    }
    if (message.ok !== false || Object.hasOwn(message, 'result')) {
        throw new TypeError(`${method}: a failure carries ok false and no result`);
    }
    if (typeof message.error !== 'string' || message.error.length === 0) {
        throw new TypeError(`${method}: error must be a non-empty string`);
    }
    return { id: message.id, ok: false, error: message.error.slice(0, ERROR_MAX_LENGTH) };
}

let requestListenerSet = false;

contextBridge.exposeInMainWorld('xchainTrezorConnectBridge', {
    /**
     * @param {(request: { id: string, method: string, args?: object }) => void} listener
     */
    onRequest(listener) {
        if (arguments.length !== 1 || typeof listener !== 'function') {
            throw new TypeError('xchainTrezorConnectBridge.onRequest: listener must be a function');
        }
        if (requestListenerSet) throw new TypeError('xchainTrezorConnectBridge.onRequest: a listener is already set');
        requestListenerSet = true;
        ipcRenderer.on(REQUEST_CHANNEL, (_event, message) => {
            if (!isValidRequest(message)) return;
            listener({ id: message.id, method: message.method, args: message.args });
        });
    },
    /**
     * @param {{ id: string, ok: boolean, result?: unknown, error?: string }} message
     */
    reply(message) {
        ipcRenderer.send(REPLY_CHANNEL, validateReply(arguments));
    },
    ready() {
        if (arguments.length !== 0) throw new TypeError('xchainTrezorConnectBridge.ready: takes no arguments');
        ipcRenderer.send(READY_CHANNEL);
    },
});
