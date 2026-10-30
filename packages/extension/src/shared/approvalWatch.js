// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An approval window holds a port to the service worker for as long as it
// shows a parked request. The worker never answers on it; the port closing is
// the signal. A worker that stops drops every parked request with it, so the
// window learns at once, not when the user presses Sign.

import { isTrustedExtensionSender } from '../bridge/publicSurface.js';

export const APPROVAL_WATCH_PORT = 'approval-watch';

/**
 * Background half: hold approval-window ports open. A port from anything but
 * this extension's own pages is closed at once.
 *
 * @param {{ id?: string, onConnect: { addListener: Function, removeListener: Function } }} [runtime]
 * @returns {() => void}
 */
export function attachApprovalWatchListener(runtime) {
    const rt = runtime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (typeof rt?.onConnect?.addListener !== 'function') return () => {};
    // Held until the window closes it, so the port lives as long as the
    // window and closes only with the window or this worker.
    const held = new Set();
    const listener = (port) => {
        if (!port || port.name !== APPROVAL_WATCH_PORT) return;
        if (!isTrustedExtensionSender(port.sender, rt.id)) {
            try { port.disconnect?.(); } catch { /* already closed */ }
            return;
        }
        held.add(port);
        port.onDisconnect?.addListener?.(() => { held.delete(port); });
    };
    rt.onConnect.addListener(listener);
    return () => rt.onConnect.removeListener(listener);
}

/**
 * Window half: call `onLost` once the worker that holds request `id` is gone.
 * A closed port is checked against the broker before it counts, so a port
 * that closed while the request is still parked just reconnects.
 *
 * @param {object} args
 * @param {() => Promise<unknown>} args.stillParked  resolves while the broker holds the request, rejects once it is lost
 * @param {(err: any) => void} args.onLost
 * @param {{ connect?: Function, lastError?: unknown }} [args.runtime]
 * @param {number} [args.reconnectMs]
 * @returns {() => void} stops watching
 */
export function watchApprovalWorker({ stillParked, onLost, runtime, reconnectMs = 1000 }) {
    const rt = runtime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (typeof rt?.connect !== 'function') return () => {};
    let stopped = false;
    let port = null;
    let timer = null;
    const open = () => {
        if (stopped) return;
        try {
            port = rt.connect({ name: APPROVAL_WATCH_PORT });
        } catch {
            port = null;
            return;
        }
        port?.onDisconnect?.addListener(() => {
            // Read so Chrome does not log the closed port as unchecked.
            void rt.lastError;
            port = null;
            if (stopped) return;
            Promise.resolve()
                .then(stillParked)
                .then(() => {
                    if (!stopped) timer = setTimeout(open, reconnectMs);
                }, (err) => {
                    if (!stopped) onLost(err);
                });
        });
    };
    open();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        try { port?.disconnect?.(); } catch { /* already closed */ }
    };
}
