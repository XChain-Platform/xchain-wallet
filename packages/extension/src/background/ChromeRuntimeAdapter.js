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
import {
    isMessageAllowedFromSender,
    isTrustedExtensionSender,
    webSenderOrigin,
} from '../bridge/publicSurface.js';
import { bridgeErrorCodeFor } from '../bridge/errorCodes.js';

/**
 * Attach a MessageHost to a chrome.runtime surface. Returns a function
 * that detaches the listener (useful for hot reload and tests).
 *
 * @param {import('./MessageHost.js').MessageHost} host
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @param {{
 *   onActivity?: () => void,
 *   onWebSender?: (tabId: number, origin: string) => void,
 * }} [opts]   onActivity fires once per message from the trusted extension UI,
 *        feeding the background auto-lock backstop. onWebSender fires once per
 *        accepted `bridge.*` message from a web page, carrying the browser's own
 *        reading of which tab and which origin it came from.
 * @returns {() => void}                                                       detach fn
 */
export function attachChromeRuntime(host, chromeRuntime, opts = {}) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        throw new Error(
            'attachChromeRuntime: chrome.runtime.onMessage is not available; pass a runtime object for tests',
        );
    }
    const onActivity = typeof opts.onActivity === 'function' ? opts.onActivity : null;
    const onWebSender = typeof opts.onWebSender === 'function' ? opts.onWebSender : null;

    const listener = (message, sender, sendResponse) => {
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
        // Trust boundary: the privileged handler surface (wallet.*,
        // action.*, settings.*, ...) is registered on this same host as
        // the public `bridge.*` surface. A web page reaches this listener
        // via the content-script relay, so confine untrusted senders to
        // `bridge.*` (which self-enforce per-origin permissions). Trusted
        // extension pages may call anything.
        const type = message && typeof message === 'object' ? message.type : undefined;
        if (!isMessageAllowedFromSender(type, sender, runtime.id)) {
            sendResponse({
                ok: false,
                error: {
                    name: 'BridgeError',
                    code: 'FORBIDDEN_SENDER',
                    message: 'this message type is not available to web origins',
                },
            });
            return true;
        }
        const trusted = isTrustedExtensionSender(sender, runtime.id);
        // A message from the trusted extension UI counts as user activity for
        // the background auto-lock backstop. A `bridge.*` call from a web page
        // (allowed above, but not extension-origin) deliberately does NOT.
        if (onActivity && trusted) {
            try { onActivity(); } catch { /* best-effort */ }
        }
        // Second layer under the confused-deputy defense. Every bridge.*
        // permission decision keys on `request.origin`, and until now the ONLY
        // thing binding that field to the page it came from was one line in
        // the content-script relay that stamps window.location.origin last in
        // a spread. Reorder that spread and any page inherits any connected
        // site's grants. The browser hands us the real origin right here, so
        // check it and refuse the mismatch: the relay stays the first layer,
        // this is the one a refactor of the relay cannot take away.
        //
        // Fails OPEN when the sender origin is not derivable (see
        // webSenderOrigin) - a second layer must never be the reason a
        // legitimate call fails, and the first layer still holds.
        if (!trusted) {
            const senderOrigin = webSenderOrigin(sender);
            const claimed =
                message && typeof message.request === 'object' && message.request !== null
                    ? /** @type {any} */ (message.request).origin
                    : undefined;
            if (senderOrigin && typeof claimed === 'string' && claimed !== senderOrigin) {
                sendResponse({
                    ok: false,
                    error: {
                        name: 'BridgeError',
                        code: 'INVALID_PARAMS',
                        message: 'bridge: ORIGIN_MISMATCH (request origin is not the sending page)',
                    },
                });
                return true;
            }
            // §43.2 delivery set. Anything reaching here from an untrusted
            // sender is a `bridge.*` call that passed both confused-deputy
            // layers, so this tab is genuinely in conversation with the wallet
            // at this origin. Record it: the event broadcaster cannot learn the
            // same fact from `chrome.tabs.query`, which withholds `Tab.url`
            // from a manifest with no "tabs" or host permission. `sender` is
            // filled in by the browser, so a page cannot register itself under
            // someone else's origin. Skipped when the origin is not derivable
            // (opaque/sandboxed frames), which costs delivery, never safety.
            if (onWebSender && senderOrigin && typeof sender?.tab?.id === 'number') {
                try { onWebSender(sender.tab.id, senderOrigin); } catch { /* best-effort */ }
            }
        }
        Promise.resolve()
            .then(() => host.handle(message))
            .then((response) => sendResponse(publishedError(response, trusted)))
            .catch((err) => {
                // host.handle already serializes errors; this catch guards
                // against truly unexpected failures.
                sendResponse(publishedError({
                    ok: false,
                    error: {
                        name: (err && err.name) || 'Error',
                        message: (err && err.message) || String(err),
                    },
                }, trusted));
            });
        return true; // signals async response per MV3 contract
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}

/**
 * Last point at which a failure envelope is still ours, for a sender that is
 * not the extension's own UI.
 *
 * The bridge handlers already translate their internal vocabulary to a
 * published BridgeErrorCode on the way out, but two envelopes never pass
 * through that wrapper because they are produced BEFORE a handler is found:
 * MessageHost's UnknownMessageTypeError / InvalidMessageError, and this
 * adapter's own catch-all. Both reach the page with no `code` at all, which is
 * the one page-visible shape a dApp exhaustively switching on the union cannot
 * match. Stamp the published code here, keeping `name` and `message` so the
 * precise cause still reads in a Developer-Mode log.
 *
 * Trusted extension UI is left untouched: it is not a bridge consumer, and
 * widening its diagnostics to INTERNAL_ERROR would lose detail for no gain.
 *
 * @param {any} response
 * @param {boolean} trusted
 * @returns {any}
 */
function publishedError(response, trusted) {
    if (trusted) return response;
    if (!response || typeof response !== 'object' || response.ok !== false) return response;
    const error = response.error;
    if (!error || typeof error !== 'object') {
        return {
            ...response,
            error: { name: 'BridgeError', code: 'INTERNAL_ERROR', message: 'bridge: INTERNAL_ERROR' },
        };
    }
    // bridgeErrorCodeFor hands a published code straight back, so an envelope
    // the handlers already translated is returned untouched by identity.
    const code = bridgeErrorCodeFor(error);
    if (code === error.code) return response;
    return { ...response, error: { ...error, code } };
}
