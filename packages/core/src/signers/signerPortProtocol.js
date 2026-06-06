// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// signerPortProtocol — shared RPC plumbing for the renderer↔background
// signer bridge. Implements the protocol on top of a neutral
// `{ postMessage, onMessage }` port adapter so the same code works for
// chrome.runtime ports (extension), postMessage pipes (web workers),
// and Electron's ipcMain/ipcRenderer (desktop).
//
// Two roles:
//
//   bindRendererPortBridge(port, { getSigner })
//     Run on the renderer side. Listens for `signer.sign.request` +
//     `signer.status.request` messages from the background, looks
//     up the live signer instance via `getSigner(id)`, calls the
//     method, posts a `signer.sign.response` with the result (or
//     error). Expose a `register(id)` method so callers can notify
//     the background which signerIds they own.
//
//   createBackgroundTransport(port)
//     Run on the background side. Returns a transport function
//     (same shape `RemoteSigner` expects) that posts
//     `signer.sign.request` / `signer.status.request` to the port
//     and awaits the matching response. Correlates via a monotonic
//     request id. Throws if the port disconnects mid-request.
//
// Message shapes (always JSON-serializable, port boundaries may
// marshal via structuredClone / JSON so no functions / Promises):
//
//   renderer → background
//     { kind: 'register', signerIds: string[] }
//     { kind: 'unregister', signerIds: string[] }
//     { kind: 'response', reqId: number, ok: true, result: unknown }
//     { kind: 'response', reqId: number, ok: false, error: { name, message } }
//
//   background → renderer
//     { kind: 'request', reqId: number, op: string, payload: object }

/**
 * @typedef {Object} PortLike
 * @property {(msg: any) => void} postMessage
 * @property {{ addListener: (fn: (msg: any) => void) => void, removeListener: (fn: (msg: any) => void) => void }} onMessage
 * @property {{ addListener: (fn: () => void) => void, removeListener: (fn: () => void) => void }} [onDisconnect]
 */

/**
 * Background-side: wrap a port into a transport function usable by
 * RemoteSigner. Correlates requests/responses via a monotonic reqId.
 * Requests in-flight when the port disconnects reject with
 * "signer bridge disconnected".
 *
 * @param {PortLike} port
 * @returns {import('./RemoteSigner.js').RemoteSignerTransport}
 */
export function createBackgroundTransport(port) {
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void }>} */
    const pending = new Map();
    let nextReqId = 1;
    let disconnected = false;

    port.onMessage.addListener((msg) => {
        if (!msg || msg.kind !== 'response') return;
        const entry = pending.get(msg.reqId);
        if (!entry) return;
        pending.delete(msg.reqId);
        if (msg.ok) entry.resolve(msg.result);
        else {
            const err = new Error(msg.error?.message || 'renderer returned no message');
            err.name = msg.error?.name || 'Error';
            entry.reject(err);
        }
    });

    const disconnectHandler = () => {
        disconnected = true;
        for (const entry of pending.values()) {
            entry.reject(new Error('signer bridge disconnected'));
        }
        pending.clear();
    };
    if (port.onDisconnect) port.onDisconnect.addListener(disconnectHandler);

    return function transport({ op, payload }) {
        if (disconnected) return Promise.reject(new Error('signer bridge disconnected'));
        const reqId = nextReqId++;
        return new Promise((resolve, reject) => {
            pending.set(reqId, { resolve, reject });
            try {
                port.postMessage({ kind: 'request', reqId, op, payload });
            } catch (err) {
                pending.delete(reqId);
                reject(err);
            }
        });
    };
}

/**
 * Renderer-side: bind a port to a signer registry. Forwards every
 * `request` message through `getSigner(signerId).<op>(payload)` and
 * posts back a matching `response`. `getSigner` returns null / undef
 * when the signer isn't registered — reply with an error so the
 * background can surface "signer not available" cleanly.
 *
 * @param {PortLike} port
 * @param {Object} opts
 * @param {(signerId: string) => import('./Signer.js').Signer | null | undefined} opts.getSigner
 * @returns {{ announce: (signerIds: string[]) => void, dispose: () => void }}
 */
export function bindRendererPortBridge(port, { getSigner }) {
    const listener = async (msg) => {
        if (!msg || msg.kind !== 'request') return;
        const { reqId, op, payload } = msg;
        try {
            const result = await dispatch(getSigner, op, payload);
            try {
                port.postMessage({ kind: 'response', reqId, ok: true, result });
            } catch {
                // Port likely disconnected. Nothing more to do.
            }
        } catch (err) {
            try {
                port.postMessage({
                    kind: 'response', reqId, ok: false,
                    error: {
                        name: (err && err.name) || 'Error',
                        message: (err && err.message) || String(err),
                    },
                });
            } catch {
                // Swallow.
            }
        }
    };
    port.onMessage.addListener(listener);

    function announce(signerIds) {
        try {
            port.postMessage({ kind: 'register', signerIds: Array.from(signerIds) });
        } catch {
            // Port might not be open yet — callers should retry, but
            // swallowing here is fine for first-announce-at-boot paths.
        }
    }

    function dispose() {
        try { port.onMessage.removeListener(listener); } catch { /* ignore */ }
    }

    return { announce, dispose };
}

async function dispatch(getSigner, op, payload) {
    const signerId = payload?.signerId;
    if (typeof signerId !== 'string' || signerId.length === 0) {
        throw new Error(`signerPort: request missing signerId (op="${op}")`);
    }
    const signer = getSigner(signerId);
    if (!signer) {
        const err = new Error(`signerPort: no renderer signer registered for id "${signerId}"`);
        err.name = 'SignerNotRegisteredError';
        throw err;
    }
    switch (op) {
        case 'status':
            return signer.getStatus(payload);
        case 'getAddresses':
            return signer.getAddresses(payload);
        case 'getPublicKey':
            return signer.getPublicKey(payload);
        case 'signPsbt':
            return signer.signPsbt(payload);
        case 'signMessage':
            return signer.signMessage(payload);
        default:
            throw new Error(`signerPort: unknown op "${op}"`);
    }
}
