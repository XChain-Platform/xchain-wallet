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

    function send(type, request) {
        return new Promise((resolve, reject) => {
            const id = genId();
            pending.set(id, { resolve, reject });
            window.postMessage({ source: SOURCE, id, type, request }, window.location.origin);
        });
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

        connect(opts = {}) { return send('bridge.connect', { ...opts }); },
        disconnect() { return send('bridge.disconnect', {}); },
        getAccounts() { return send('bridge.getAccounts', {}); },
        getAddresses(chainId) { return send('bridge.getAddresses', { chainId }); },
        getBalances(chainId, address) { return send('bridge.getBalances', { chainId, address }); },
        getSupportedChains() { return send('bridge.getSupportedChains', {}); },
        getActiveChains() { return send('bridge.getActiveChains', {}); },

        signMessage(params) { return send('bridge.signMessage', params); },
        signAction(params) { return send('bridge.signAction', params); },
        signPsbt(params) { return send('bridge.signPsbt', params); },
        signIn(params) { return send('bridge.signIn', params); },

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
