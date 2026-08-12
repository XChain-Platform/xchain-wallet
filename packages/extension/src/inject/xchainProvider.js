// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Inject script: runs in the page's JavaScript context. Defines
// `window.xchain` per §43.2 as a thin RPC shim that forwards every
// method call to the content script via `window.postMessage`. The
// content script (isolated world) bridges to the background service
// worker via `chrome.runtime.sendMessage`.
//
// This file is bundled as a standalone IIFE in the extension's
// `web_accessible_resources` and injected by the content script. The
// page sees a normal `window.xchain` object with no Chrome-specific
// globals visible.
//
// Message shape on the page side:
//
//   ← inject: window.postMessage({ source: 'xchain-inject', id, type, request })
//   → inject: window.postMessage({ source: 'xchain-inject-response', id, ok, result|error })
//
// Every outbound request carries a unique id; responses are matched
// against pending promises by id. The inject script ignores messages
// from other sources (same-origin policy applies; postMessage within a
// single window is plain event dispatch).
//
// FAILURE SHAPE (). bridge-spec splits the surface in two and this
// shim must respect the split, because a blanket wrap would break half of it:
//
//   - connect / signMessage / signAction / signPsbt / coSign / signIn declare
//     a RESULT UNION (`ConnectResult = ConnectSuccess | BridgeErrorResult`),
//     so a refusal RESOLVES with `{ ok: false, error: <BridgeErrorCode> }`.
//     These went out as rejected promises, so `if (!conn.ok)` - the first line
//     of the spec's own worked example - never ran.
//   - getAccounts / getAddresses / getBalances / getSupportedChains /
//     getActiveChains declare BARE ARRAYS (`Promise<Account[]>` and friends),
//     and disconnect declares `Promise<void>`. These have nowhere to put an
//     `ok` flag and keep rejecting.
//
// parallel() resolves to `SignActionResult[]`, whose ENTRIES carry the
// envelope; a batch-level failure has no slot in the array, so it rejects.
//
// This file IMPORTS NOTHING, deliberately. The content script injects it with a
// plain `<script src>` tag (classic script, not a module) sourced from
// web_accessible_resources, so any static import survives bundling as a real
// `import` of a shared chunk that is neither web-accessible nor loadable in a
// classic script - the provider would fail to install at all and `window.xchain`
// would never appear. Hence the local copy of the error-code list below.

(function installXChainProvider() {
    if (typeof window === 'undefined') return;
    if (window.xchain && window.xchain.isXChainWallet) return;

    const VERSION = '0.1.0';
    const SOURCE = 'xchain-inject';
    const RESPONSE_SOURCE = 'xchain-inject-response';
    const READY_EVENT = 'xchain#initialized';

    /** @type {Map<string, { resolve: Function, reject: Function }>} */
    const pending = new Map();

    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();

    function genId() {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    // The THROTTLED hints bridge-spec's BridgeErrorResult declares. Carried
    // from the wire onto the Error and back off it, so a dApp gets the wait it
    // is supposed to respect instead of having to guess one.
    const ERROR_HINT_FIELDS = ['retryAfterMs', 'burst', 'windowMs'];

    // A local copy of bridge-spec's BRIDGE_ERROR_CODES, because this file
    // cannot import (see the header). Kept honest by a unit test that compares
    // it against the package's own list rather than by anyone remembering.
    const BRIDGE_ERROR_CODES = [
        'USER_REJECTED',
        'NOT_CONNECTED',
        'WALLET_LOCKED',
        'CHAIN_NOT_SUPPORTED',
        'ACCOUNT_NOT_AUTHORIZED',
        'ADDRESS_NOT_AUTHORIZED',
        'UNSUPPORTED_ACTION',
        'INVALID_PARAMS',
        'CHALLENGE_EXPIRED',
        'BROADCAST_FAILED',
        'PANIC_MODE',
        'THROTTLED',
        'BLOCKED_BY_USER',
        'BRIDGE_VERSION_MISMATCH',
        'INTERNAL_ERROR',
    ];

    function send(type, request) {
        return new Promise((resolve, reject) => {
            const id = genId();
            pending.set(id, { resolve, reject });
            window.postMessage({ source: SOURCE, id, type, request }, window.location.origin);
        });
    }

    // A BridgeErrorResult built from a rejected call. An unrecognized code
    // collapses to INTERNAL_ERROR rather than being passed through: the union
    // is only useful to a dApp if everything in it is actually in it.
    function errorResult(err) {
        const result = {
            ok: false,
            error: BRIDGE_ERROR_CODES.indexOf(err?.code) >= 0 ? err.code : 'INTERNAL_ERROR',
        };
        if (err?.message) result.message = err.message;
        for (const field of ERROR_HINT_FIELDS) {
            if (typeof err?.[field] === 'number') result[field] = err[field];
        }
        return result;
    }

    // The result-union methods: resolve on failure, never reject.
    function sendResult(type, request) {
        return send(type, request).then(
            (result) => result,
            (err) => errorResult(err),
        );
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.source === RESPONSE_SOURCE && typeof data.id === 'string') {
            const handle = pending.get(data.id);
            if (!handle) return;
            pending.delete(data.id);
            if (data.ok) handle.resolve(data.result);
            else {
                const err = new Error(data.error?.message ?? 'bridge error');
                err.name = data.error?.name ?? 'Error';
                if (data.error?.code) err.code = data.error.code;
                for (const field of ERROR_HINT_FIELDS) {
                    if (typeof data.error?.[field] === 'number') err[field] = data.error[field];
                }
                handle.reject(err);
            }
        } else if (data.source === 'xchain-inject-event' && typeof data.event === 'string') {
            const handlers = listeners.get(data.event);
            if (!handlers) return;
            for (const fn of handlers) {
                try { fn(data.payload); } catch { /* isolate listener errors */ }
            }
        }
    });

    const provider = {
        version: VERSION,
        isXChainWallet: true,

        // Result-union methods (sendResult): a refusal resolves as
        // BridgeErrorResult. Bare-array + void methods (send): a refusal
        // rejects. See the FAILURE SHAPE note at the top of this file.
        connect(opts = {}) { return sendResult('bridge.connect', { ...opts }); },
        disconnect() { return send('bridge.disconnect', {}); },
        getAccounts() { return send('bridge.getAccounts', {}); },
        getAddresses(chainId) { return send('bridge.getAddresses', { chainId }); },
        getBalances(chainId, address) { return send('bridge.getBalances', { chainId, address }); },
        getSupportedChains() { return send('bridge.getSupportedChains', {}); },
        getActiveChains() { return send('bridge.getActiveChains', {}); },

        signMessage(params) { return sendResult('bridge.signMessage', params); },
        signAction(params) { return sendResult('bridge.signAction', params); },
        signPsbt(params) { return sendResult('bridge.signPsbt', params); },
        coSign(params) { return sendResult('bridge.coSign', params); },
        signIn(params) { return sendResult('bridge.signIn', params); },

        parallel(actions) {
            if (!Array.isArray(actions) || actions.length === 0) {
                return Promise.reject(new Error('xchain: parallel requires a non-empty actions array'));
            }
            return send('bridge.parallel', { actions });
        },

        on(event, handler) {
            if (typeof handler !== 'function') return;
            let set = listeners.get(event);
            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }
            set.add(handler);
        },

        off(event, handler) {
            const set = listeners.get(event);
            if (!set) return;
            set.delete(handler);
            if (set.size === 0) listeners.delete(event);
        },
    };

    Object.defineProperty(window, 'xchain', {
        value: provider,
        configurable: false,
        writable: false,
    });
    window.dispatchEvent(new Event(READY_EVENT));
})();
