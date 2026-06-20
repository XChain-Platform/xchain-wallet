// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ChromeRuntimeAdapter: bridges a MessageHost to `chrome.runtime`.
// Runs in the MV3 service worker; popup, content script, and inject
// script send messages via `chrome.runtime.sendMessage`.
//
// Protocol: a request shaped `{ type, request }` goes in; the handler
// returns a Promise; the host's response envelope
// (`{ ok, result } | { ok, error }`) comes back.
//
// `chrome.runtime.onMessage` listeners indicate async response by
// returning `true` from the listener and invoking `sendResponse` after
// the Promise settles. Newer Chrome also supports returning a Promise
// from the listener; we use the sendResponse pattern for broadest MV3
// compatibility.
//
// Co-exists with the pre-host listener in `sessionMeta.js`: this adapter
// returns `false` for types in `PRE_HOST_MESSAGE_TYPES` so the two
// listeners stay disjoint and no message ever gets two sendResponses.

import { PRE_HOST_MESSAGE_TYPES } from './sessionMeta.js';

/**
 * Attach a MessageHost to a chrome.runtime surface. Returns a function
 * that detaches the listener (useful for hot reload and tests).
 *
 * @param {import('./MessageHost.js').MessageHost} host
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void}                                                       detach fn
 */
export function attachChromeRuntime(host, chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        throw new Error(
            'attachChromeRuntime: chrome.runtime.onMessage is not available; pass a runtime object for tests',
        );
    }

    const listener = (message, _sender, sendResponse) => {
        // Pre-host listener (sessionMeta.js) owns a small set of types
        // that must work before the MessageHost's vault-backed handlers
        // are registered. Skip those here so no message ever sees two
        // sendResponses.
        if (
            message &&
            typeof message === 'object' &&
            typeof message.type === 'string' &&
            PRE_HOST_MESSAGE_TYPES.has(message.type)
        ) {
            return false;
        }
        Promise.resolve()
            .then(() => host.handle(message))
            .then((response) => sendResponse(response))
            .catch((err) => {
                // host.handle already serializes errors; this catch guards
                // against truly unexpected failures.
                sendResponse({
                    ok: false,
                    error: {
                        name: (err && err.name) || 'Error',
                        message: (err && err.message) || String(err),
                    },
                });
            });
        return true; // signals async response per MV3 contract
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
