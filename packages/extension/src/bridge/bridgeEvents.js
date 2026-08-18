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
// the background-side sender. Bridge handlers call
// `events.accountsChanged(origin, accounts)` etc. when permissions or
// connected-site state change, and the broadcaster delivers the message
// to each tab known to be talking to that origin via
// `chrome.tabs.sendMessage`.
//
// The delivery set comes from the connected-tab registry
// (`../background/connectedTabs.js`), NOT from `chrome.tabs.query` plus
// `new URL(tab.url).origin`. That URL filter was the original design and it
// never delivered anything: MV3 leaves `Tab.url` undefined unless the
// extension holds the "tabs" permission or a matching host permission, and
// this manifest holds neither, so every tab failed the
// `typeof tab.url === 'string'` guard. The registry answers the same question
// from the unforgeable `sender.tab.id` and sender origin the worker already
// receives on every `bridge.*` call, with no permission escalation and no
// broadcast to unrelated tabs. That module carries the full rationale.
//
// A registry entry is a delivery HINT, not a boundary: a tab that navigated
// since it last called the bridge is still addressed by id. Every message
// therefore carries the origin it was meant for, and `contentScript.js` drops
// any `bridge.event` whose stamp does not match the document actually loaded.
// That receiver-side check is the authority, and it is unchanged.
//
// Send failures are swallowed; a tab may have closed between lookup and send,
// and the event is best-effort anyway.
//
// Without a `chrome.tabs.sendMessage` surface, or without a registry (Node
// smokes, web/desktop shells that expose no extension APIs), every method
// becomes a no-op. The wallet can still mutate state without crashing.

const EVENT_MESSAGE_TYPE = 'bridge.event';

/**
 * @param {{
 *   tabs?: { sendMessage: Function },
 *   connectedTabs?: { tabsForOrigin: (origin: string) => Promise<number[]> | number[] },
 *   runtime?: { lastError?: { message: string } | undefined },
 *   logger?: { warn?: (msg: string, err?: unknown) => void },
 * }} deps
 */
export function createBridgeEventBroadcaster(deps = {}) {
    const tabs = deps.tabs;
    const runtime = deps.runtime;
    const connectedTabs = deps.connectedTabs;

    async function fanOut(origin, event, payload) {
        if (!origin || typeof origin !== 'string') return;
        if (!tabs || typeof tabs.sendMessage !== 'function') return;
        if (!connectedTabs || typeof connectedTabs.tabsForOrigin !== 'function') return;
        let targets;
        try {
            targets = await connectedTabs.tabsForOrigin(origin);
        } catch (_err) {
            return;
        }
        if (!Array.isArray(targets)) return;
        for (const tabId of targets) {
            if (!Number.isInteger(tabId)) continue;
            try {
                // Delivery is bound to a mutable tab id, so a tab that navigated
                // since it last called the bridge would hand the NEW origin's
                // content script the old origin's event (accountsChanged carries
                // account ids and names). Stamp the intended origin: the receiver
                // always runs against the document actually loaded and can drop
                // what was never meant for it.
                tabs.sendMessage(
                    tabId,
                    { type: EVENT_MESSAGE_TYPE, event, payload, origin },
                    // The callback exists to READ runtime.lastError, which is
                    // what stops Chrome logging "Unchecked runtime.lastError"
                    // (and, on the callback-free overload, rejecting the
                    // returned promise into the worker's unhandled set). An
                    // event is one-way, so the receiver never calls
                    // sendResponse and lastError is set on a healthy send as
                    // well as on a stale tab id. Neither is actionable: a tab
                    // that has gone re-registers on its next bridge call.
                    () => { void runtime?.lastError; },
                );
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
