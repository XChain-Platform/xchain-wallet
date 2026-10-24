// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Answers a dApp's `bridge.*` call that arrives while the service worker holds
// no host.
//
// The host listener (ChromeRuntimeAdapter) exists only while the vault is open.
// A page call that lands while the worker is locked, or while a restarted
// worker is still rebuilding its host, reaches no listener at all. Chrome then
// closes the port, and the page reads INTERNAL_ERROR with Chrome's own
// "message port closed" text, so a dApp that branches on the published
// WALLET_LOCKED code never sees it.
//
// This gate is attached once at load, ahead of any host. For a web-page
// `bridge.*` message with no host it waits for the host build: a built host
// takes the message through the normal listener, and a build that finds no
// session answers WALLET_LOCKED. Trusted extension pages are left alone.

import { isPublicBridgeType, isTrustedExtensionSender } from '../bridge/publicSurface.js';

export const WALLET_LOCKED_ENVELOPE = Object.freeze({
    ok: false,
    error: Object.freeze({
        name: 'BridgeError',
        code: 'WALLET_LOCKED',
        message: 'bridge: WALLET_LOCKED',
    }),
});

const INTERNAL_ERROR_ENVELOPE = Object.freeze({
    ok: false,
    error: Object.freeze({
        name: 'BridgeError',
        code: 'INTERNAL_ERROR',
        message: 'bridge: INTERNAL_ERROR',
    }),
});

/**
 * @param {{
 *   runtime?: { id?: string, onMessage: { addListener: Function, removeListener: Function } },
 *   hasHost: () => boolean,
 *   ensureHost: () => Promise<unknown>,
 *   dispatch: (message: unknown, sender: unknown, sendResponse: Function) => unknown,
 * }} deps   `dispatch` hands a message to the host listener once a host exists
 * @returns {() => void} detach function
 */
export function attachBridgeBootGate(deps) {
    const runtime = deps.runtime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime?.onMessage) return () => {};

    const listener = (message, sender, sendResponse) => {
        const type = message && typeof message === 'object' ? message.type : undefined;
        if (!isPublicBridgeType(type)) return false;
        if (isTrustedExtensionSender(sender, runtime.id)) return false;
        if (deps.hasHost()) return false;

        Promise.resolve()
            .then(() => deps.ensureHost())
            .then((built) => {
                if (built) return deps.dispatch(message, sender, sendResponse);
                return sendResponse(WALLET_LOCKED_ENVELOPE);
            })
            .catch(() => sendResponse(INTERNAL_ERROR_ENVELOPE));
        return true;
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
