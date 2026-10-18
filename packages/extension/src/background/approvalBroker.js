// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ApprovalBroker: the shell-side `Approvals` implementation (§43.4).
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
// rejection: the deferred resolves with `{ approved: false }`, which
// the bridge surfaces as `USER_REJECTED` to the dApp.
//
// Multiple concurrent approvals are supported; each gets its own id and popup
// window. Concurrent connect requests from one origin share the pending choice
// so a page cannot stack duplicate connection windows. Other requests remain
// independently reviewable, and the map stays keyed by id for resolution.

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
 * @property {{ onRemoved?: { addListener(fn: (tabId: number) => void): void } }} [tabs] chrome.tabs replacement
 * @property {{ setBadgeText?: (details: { text: string }) => Promise<void> | void }} [action] chrome.action replacement
 * @property {string} [approvalPath]                         default 'approval.html'
 * @property {{ width?: number, height?: number }} [windowSize]
 * @property {number} [timeoutMs]
 * @property {(fn: () => void, delay: number) => any} [setTimer]
 * @property {(timer: any) => void} [clearTimer]
 */

/**
 * @typedef {Object} PendingEntry
 * @property {string} id
 * @property {string} kind
 * @property {unknown} payload
 * @property {{ promise: Promise<any>, resolve: (v: any) => void, reject: (err: any) => void }} deferred
 * @property {number | null} windowId
 * @property {number | null} requesterTabId
 * @property {any} timeout
 */

export const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

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
        this._tabs = deps.tabs ?? globalThis.chrome?.tabs;
        this._action = deps.action ?? globalThis.chrome?.action;
        this._timeoutMs = deps.timeoutMs ?? APPROVAL_TIMEOUT_MS;
        // Wrapped, not stored bare: Chrome throws "Illegal invocation" when the
        // global timer functions are called as methods of another object.
        this._setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
        this._clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id));
        this._approvalPath = deps.approvalPath ?? 'approval.html';
        this._windowSize = {
            width: deps.windowSize?.width ?? 400,
            height: deps.windowSize?.height ?? 620,
        };
        /** @type {Map<string, PendingEntry>} */
        this._pending = new Map();
        this._badgeUpdate = Promise.resolve();
        this._queueBadgeUpdate();

        if (this._windows?.onRemoved?.addListener) {
            this._onWindowRemoved = this._onWindowRemoved.bind(this);
            this._windows.onRemoved.addListener(this._onWindowRemoved);
        }
        if (this._tabs?.onRemoved?.addListener) {
            this._onTabRemoved = this._onTabRemoved.bind(this);
            this._tabs.onRemoved.addListener(this._onTabRemoved);
        }
    }

    // -- Approvals interface (called by the bridge handlers) -------------

    /** @param {import('../bridge/Approvals.js').ConnectApprovalRequest} req */
    connect(req) {
        const origin = typeof req?.origin === 'string' ? req.origin : '';
        if (origin) {
            for (const entry of this._pending.values()) {
                if (entry.kind === 'connect' && entry.payload?.origin === origin) {
                    return entry.deferred.promise;
                }
            }
        }
        return this._request('connect', req);
    }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signAction(req) { return this._request('signAction', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signMessage(req) { return this._request('signMessage', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    signPsbt(req) { return this._request('signPsbt', req); }
    /** @param {import('../bridge/Approvals.js').SignApprovalRequest} req */
    coSign(req) { return this._request('coSign', req); }
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
        this._clearTimer(entry.timeout);
        this._queueBadgeUpdate();
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

    /**
     * Reject approvals whose request origin matches a background-owned rule.
     * Revoking or blocking a site uses this to make already-open prompts
     * unactionable before the management request completes.
     *
     * @param {(origin: unknown) => boolean} matches
     * @returns {Promise<number>}
     */
    async cancelOriginsMatching(matches) {
        if (typeof matches !== 'function') {
            throw new TypeError('ApprovalBroker.cancelOriginsMatching: matches is required');
        }
        const entries = [...this._pending.values()].filter((entry) => (
            matches(entry.payload?.origin)
        ));
        await this._cancelEntries(entries);
        return entries.length;
    }

    /**
     * Reject every parked approval and clear the toolbar badge.
     * Lock and wipe call this so requests from an ended session cannot remain
     * actionable or restore attention state after teardown.
     */
    async cancelAll() {
        const entries = [...this._pending.values()];
        await this._cancelEntries(entries);
    }

    async _cancelEntries(entries) {
        const cancelled = [];
        for (const entry of entries) {
            if (this._pending.get(entry.id) !== entry) continue;
            this._pending.delete(entry.id);
            this._clearTimer(entry.timeout);
            entry.deferred.resolve({ approved: false });
            cancelled.push(entry);
        }
        if (cancelled.length === 0) return;
        this._queueBadgeUpdate();

        await Promise.all(cancelled.map(async (entry) => {
            if (entry.windowId == null || !this._windows?.remove) return;
            try {
                await this._windows.remove(entry.windowId);
            } catch (_err) { /* window may already be gone */ }
        }));
        await this._badgeUpdate;
    }

    // -- Internals -------------------------------------------------------

    /**
     * @param {string} kind
     * @param {unknown} payload
     */
    _request(kind, payload) {
        const id = this._newId();
        const deferred = makeDeferred();
        const requesterTabId = Number.isInteger(payload?.requesterTabId)
            ? payload.requesterTabId
            : null;
        const popupPayload = requesterTabId == null
            ? payload
            : omitRequesterTabId(payload);
        /** @type {PendingEntry} */
        const entry = {
            id,
            kind,
            payload: popupPayload,
            deferred,
            windowId: null,
            requesterTabId,
            timeout: null,
        };
        this._pending.set(id, entry);
        entry.timeout = this._setTimer(() => this._rejectPending(id), this._timeoutMs);
        this._queueBadgeUpdate();

        if (!this._windows?.create) {
            this._pending.delete(id);
            this._clearTimer(entry.timeout);
            this._queueBadgeUpdate();
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
            .then(async (win) => {
                const current = this._pending.get(id);
                if (current) {
                    current.windowId = win?.id ?? null;
                } else if (win?.id != null && this._windows?.remove) {
                    try {
                        await this._windows.remove(win.id);
                    } catch (_err) { /* window may already be gone */ }
                }
            })
            .catch((err) => {
                const current = this._pending.get(id);
                if (!current) return;
                this._pending.delete(id);
                this._clearTimer(current.timeout);
                this._queueBadgeUpdate();
                deferred.reject(err);
            });

        return deferred.promise;
    }

    /** @param {number} windowId */
    _onWindowRemoved(windowId) {
        for (const [id, entry] of this._pending) {
            if (entry.windowId === windowId) {
                this._pending.delete(id);
                this._clearTimer(entry.timeout);
                this._queueBadgeUpdate();
                // Convention: window-closed-without-decision = rejected.
                entry.deferred.resolve({ approved: false });
                break;
            }
        }
    }

    /** @param {number} tabId */
    _onTabRemoved(tabId) {
        for (const [id, entry] of this._pending) {
            if (entry.requesterTabId === tabId) this._rejectPending(id);
        }
    }

    /** @param {string} id */
    _rejectPending(id) {
        const entry = this._pending.get(id);
        if (!entry) return false;
        this._pending.delete(id);
        this._clearTimer(entry.timeout);
        this._queueBadgeUpdate();
        entry.deferred.resolve({ approved: false });
        if (entry.windowId != null && this._windows?.remove) {
            Promise.resolve(this._windows.remove(entry.windowId)).catch(() => {});
        }
        return true;
    }

    _queueBadgeUpdate() {
        if (!this._action?.setBadgeText) return;
        this._badgeUpdate = this._badgeUpdate
            .catch(() => {})
            .then(() => this._action.setBadgeText({
                text: approvalBadgeText(this._pending.size),
            }))
            .catch(() => {});
    }
}

/** @param {number} count */
export function approvalBadgeText(count) {
    if (!Number.isFinite(count) || count <= 0) return '';
    return count > 99 ? '99+' : String(Math.floor(count));
}

function makeDeferred() {
    /** @type {(v: any) => void} */
    let resolve = () => {};
    /** @type {(err: any) => void} */
    let reject = () => {};
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function omitRequesterTabId(payload) {
    const { requesterTabId: _requesterTabId, ...rest } = payload;
    return rest;
}
