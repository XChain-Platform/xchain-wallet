// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Bridge event broadcaster: §43.2 dApp event pipeline (Cluster F
// FOLLOWUP 1).
//
// The provider's listener side is wired (content script relays
// `chrome.runtime.onMessage({ type: 'bridge.event', event, payload })`
// to the page via postMessage; the inject script dispatches to
// subscribers registered through `provider.on(...)`). This module is
// the missing background-side sender. Bridge handlers call
// `events.accountsChanged(origin, accounts)` etc. when permissions or
// connected-site state change, and the broadcaster fans the message
// out to every tab currently sitting on a matching origin via
// `chrome.tabs.sendMessage`.
//
// Tabs are matched by `URL.origin` against the supplied origin string.
// Mismatches are silently dropped (a dApp on a different origin must
// not see another site's events). Tabs without a `url` (chrome://, the
// New Tab page) are skipped. Send failures are swallowed; a tab may
// have been closed between query and send, and the event is best-
// effort anyway.
//
// In environments without `chrome.tabs` (Node smokes, web/desktop
// shells that do not expose extension APIs) every method becomes a
// no-op. The wallet can still mutate state without crashing.

const EVENT_MESSAGE_TYPE = 'bridge.event';

/**
 * @param {{
 *   tabs?: { query: Function, sendMessage: Function },
 *   runtime?: { lastError?: { message: string } | undefined },
 *   logger?: { warn?: (msg: string, err?: unknown) => void },
 * }} deps
 */
export function createBridgeEventBroadcaster(deps = {}) {
    const tabs = deps.tabs;
    const runtime = deps.runtime;

    async function fanOut(origin, event, payload) {
        if (!origin || typeof origin !== 'string') return;
        if (!tabs || typeof tabs.query !== 'function' || typeof tabs.sendMessage !== 'function') {
            return;
        }
        let matched;
        try {
            matched = await queryTabs(tabs, runtime);
        } catch (_err) {
            return;
        }
        for (const tab of matched) {
            if (!tab || typeof tab.id !== 'number' || typeof tab.url !== 'string') continue;
            let tabOrigin;
            try {
                tabOrigin = new URL(tab.url).origin;
            } catch {
                continue;
            }
            if (tabOrigin !== origin) continue;
            try {
                tabs.sendMessage(tab.id, {
                    type: EVENT_MESSAGE_TYPE,
                    event,
                    payload,
                });
            } catch (_err) {
                // Tab discarded mid-fire; best-effort delivery.
            }
        }
    }

    return {
        /**
         * @param {string} origin
         * @param {Array<{ id: string, name?: string }>} accounts
         */
        async accountsChanged(origin, accounts) {
            await fanOut(origin, 'accountsChanged', accounts);
        },
        /**
         * @param {string} origin
         * @param {string} chainId
         */
        async chainChanged(origin, chainId) {
            await fanOut(origin, 'chainChanged', chainId);
        },
        /**
         * @param {string} origin
         * @param {string} [reason]
         */
        async disconnect(origin, reason) {
            await fanOut(origin, 'disconnect', reason ?? 'user-requested');
        },
    };
}

/**
 * Fire-and-forget no-op broadcaster used when bridge handlers run
 * without a chrome.tabs surface (smokes, web/desktop shells, default
 * dependency for `registerBridgeHandlers`).
 */
export const noopBridgeEvents = {
    async accountsChanged() { /* no-op */ },
    async chainChanged() { /* no-op */ },
    async disconnect() { /* no-op */ },
};

/**
 * Diff two ConnectedSite permissions records and emit only events
 * whose payload actually changed. Centralized here so bridge handlers
 * don't have to re-implement the diff inline.
 *
 * Caller resolves `accountsChangedPayload` (Array<{id, name}>) ahead of
 * time because vault.accounts.list() is async and the broadcaster
 * stays stateless; the bridge handler that has the new permissions
 * already has the account records.
 *
 * @param {{
 *   events: ReturnType<typeof createBridgeEventBroadcaster> | typeof noopBridgeEvents,
 *   origin: string,
 *   prevPermissions?: { chains?: string[], accounts?: string[] } | null,
 *   nextPermissions: { chains?: string[], accounts?: string[] },
 *   accountsChangedPayload?: Array<{ id: string, name?: string }>,
 * }} args
 */
export async function emitPermissionDiff(args) {
    const { events, origin, prevPermissions, nextPermissions, accountsChangedPayload } = args;
    if (!events || !origin) return;
    const prevAccounts = sortedSet(prevPermissions?.accounts);
    const nextAccounts = sortedSet(nextPermissions?.accounts);
    if (prevAccounts !== nextAccounts && accountsChangedPayload) {
        await events.accountsChanged(origin, accountsChangedPayload);
    }
    const prevChains = prevPermissions?.chains ?? [];
    const nextChains = nextPermissions?.chains ?? [];
    const addedChains = nextChains.filter((c) => !prevChains.includes(c));
    if (addedChains.length === 1 && prevChains.length > 0) {
        // Most "user added a chain" flows surface a single chain at a
        // time, so emit chainChanged with the new chainId so the dApp
        // can re-bind its chain-scoped state.
        await events.chainChanged(origin, addedChains[0]);
    }
}

function sortedSet(list) {
    if (!Array.isArray(list)) return '';
    return [...new Set(list)].sort().join(',');
}

async function queryTabs(tabs, runtime) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cb = (result) => {
            if (settled) return;
            settled = true;
            const err = runtime?.lastError;
            if (err) reject(new Error(err.message ?? 'tabs.query failed'));
            else resolve(Array.isArray(result) ? result : []);
        };
        try {
            const ret = tabs.query({}, cb);
            if (ret && typeof ret.then === 'function') {
                ret.then(
                    (result) => {
                        if (settled) return;
                        settled = true;
                        resolve(Array.isArray(result) ? result : []);
                    },
                    (err) => {
                        if (settled) return;
                        settled = true;
                        reject(err);
                    },
                );
            }
        } catch (err) {
            if (!settled) {
                settled = true;
                reject(err);
            }
        }
    });
}
