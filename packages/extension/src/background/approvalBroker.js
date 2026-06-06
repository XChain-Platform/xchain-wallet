// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// ApprovalBroker — the shell-side `Approvals` implementation (§43.4).
//
// The bridge handlers (§43.3) call `approvals.connect()`, `signMessage()`,
// `signPsbt()`, `signAction()`, `signIn()` whenever they need a user
// decision. This broker fulfils each call by opening an approval popup
// window (`approval.html`), parking the request in an in-memory table,
// and returning a Promise that resolves when the window reports the
// user's choice (via the `approval.resolve` message handler) or rejects
// / resolves-as-rejected when the window is closed without a decision.
//
// Lifecycle:
//
//   bridge handler                       broker                                  approval window
//        |                                  |                                          |
//        |-- approvals.connect(req) ------->|                                          |
//        |                                  |-- chrome.windows.create ---------------->|
//        |                                  |-- (keep id → deferred) ------------------|
//        |                                  |                        <------------------|-- approval.fetch({id})
//        |                                  |-- reply {kind, payload}-->                |
//        |                                  |                        <------------------|-- approval.resolve({id, result})
//        |                                  |-- deferred.resolve(result)                |
//        |<-- promise resolves -------------|                                           |
//
// A user who closes the window without deciding is treated as a
// rejection — the deferred resolves with `{ approved: false }`, which
// the bridge surfaces as `USER_REJECTED` to the dApp.
//
// Multiple concurrent approvals are supported — each gets its own id
// and its own popup window. The broker's map is keyed by id so a user
// can triage them in any order.

import { sessionRandomUUID } from './uuid.js';

/** @typedef {import('../bridge/Approvals.js').Approvals} Approvals */

/**
 * @typedef {Object} BrokerWindowDeps
 * @property {(options: any) => Promise<{ id?: number } | undefined> | { id?: number } | undefined} create
 * @property {(windowId: number) => Promise<void> | void} [remove]
 * @property {{ addListener(fn: (windowId: number) => void): void, removeListener?: (fn: Function) => void }} [onRemoved]
 */

/**
 * @typedef {Object} BrokerRuntimeDeps
 * @property {() => string} [newId]                          randomUUID replacement for tests
 * @property {(path: string) => string} [getUrl]             chrome.runtime.getURL replacement
 * @property {BrokerWindowDeps} [windows]                    chrome.windows replacement
 * @property {string} [approvalPath]                         default 'approval.html'
 * @property {{ width?: number, height?: number }} [windowSize]
 */

/**
 * @typedef {Object} PendingEntry
 * @property {string} id
 * @property {string} kind
 * @property {unknown} payload
 * @property {{ promise: Promise<any>, resolve: (v: any) => void, reject: (err: any) => void }} deferred
 * @property {number | null} windowId
 */

export class ApprovalBroker {
    /** @param {BrokerRuntimeDeps} [deps] */
    constructor(deps = {}) {
        this._newId = deps.newId ?? sessionRandomUUID;
        this._getUrl =
            deps.getUrl ??
            ((path) =>
                globalThis.chrome?.runtime?.getURL?.(path) ?? path);
        this._windows =
            deps.windows ??
            /** @type {BrokerWindowDeps | undefined} */ (
                globalThis.chrome?.windows
            );
        this._approvalPath = deps.approvalPath ?? 'approval.html';
        this._windowSize = {
            width: deps.windowSize?.width ?? 400,
            height: deps.windowSize?.height ?? 620,
        };
        /** @type {Map<string, PendingEntry>} */
        this._pending = new Map();

        if (this._windows?.onRemoved?.addListener) {
            this._onWindowRemoved = this._onWindowRemoved.bind(this);
            this._windows.onRemoved.addListener(this._onWindowRemoved);
        }
    }

    // -- Approvals interface (called by the bridge handlers) -------------

    /** @param {import('../bridge/Approvals.js').ConnectApprovalRequest} req */
    connect(req) { return this._request('connect', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signAction(req) { return this._request('signAction', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signMessage(req) { return this._request('signMessage', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signPsbt(req) { return this._request('signPsbt', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signIn(req) { return this._request('signIn', req); }

    // -- Broker-side surface, called by the approval popup via -----------
    // -- `approval.fetch` / `approval.resolve` host handlers.

    /**
     * Fetch the parked request payload by id so the approval popup can
     * render it. Returns null if the id is unknown.
     * @param {string} id
     */
    fetch(id) {
        const entry = this._pending.get(id);
        if (!entry) return null;
        return { id: entry.id, kind: entry.kind, payload: entry.payload };
    }

    /**
     * Record the user's decision, resolve the parked deferred, and close
     * the approval window. Returns true on success, false if the id is
     * unknown (already-resolved or never existed).
     *
     * @param {string} id
     * @param {unknown} result
     */
    async resolve(id, result) {
        const entry = this._pending.get(id);
        if (!entry) return false;
        this._pending.delete(id);
        entry.deferred.resolve(result);
        if (entry.windowId != null && this._windows?.remove) {
            try {
                await this._windows.remove(entry.windowId);
            } catch (_err) { /* window may already be gone */ }
        }
        return true;
    }

    /** Test helper: inspect the in-memory map. */
    _pendingSize() { return this._pending.size; }

    // -- Internals -------------------------------------------------------

    /**
     * @param {string} kind
     * @param {unknown} payload
     */
    _request(kind, payload) {
        const id = this._newId();
        const deferred = makeDeferred();
        /** @type {PendingEntry} */
        const entry = { id, kind, payload, deferred, windowId: null };
        this._pending.set(id, entry);

        if (!this._windows?.create) {
            this._pending.delete(id);
            deferred.reject(
                new Error(
                    'ApprovalBroker: chrome.windows.create unavailable; inject windows for tests',
                ),
            );
            return deferred.promise;
        }

        const url = `${this._getUrl(this._approvalPath)}?id=${encodeURIComponent(id)}`;
        Promise.resolve(
            this._windows.create({
                url,
                type: 'popup',
                width: this._windowSize.width,
                height: this._windowSize.height,
                focused: true,
            }),
        )
            .then((win) => {
                const current = this._pending.get(id);
                if (current) current.windowId = win?.id ?? null;
            })
            .catch((err) => {
                this._pending.delete(id);
                deferred.reject(err);
            });

        return deferred.promise;
    }

    /** @param {number} windowId */
    _onWindowRemoved(windowId) {
        for (const [id, entry] of this._pending) {
            if (entry.windowId === windowId) {
                this._pending.delete(id);
                // Convention: window-closed-without-decision = rejected.
                entry.deferred.resolve({ approved: false });
                break;
            }
        }
    }
}

function makeDeferred() {
    /** @type {(v: any) => void} */
    let resolve = () => {};
    /** @type {(err: any) => void} */
    let reject = () => {};
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
