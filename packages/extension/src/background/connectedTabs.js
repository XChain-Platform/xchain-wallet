// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Connected-tab registry: which tab ids are sitting on which dApp origin,
// derived from browser-supplied sender data rather than from tab URLs.
//
// The §43.2 bridge event broadcaster has to answer "which tabs should receive
// accountsChanged for https://dapp.example?". The obvious answer -
// `chrome.tabs.query({})` filtered by `new URL(tab.url).origin` - cannot work
// in this extension: MV3 populates `Tab.url` only for an extension holding the
// "tabs" permission or a host permission matching that tab, and the manifest
// deliberately holds neither (`content_scripts.matches` confer no host
// permission). Every tab therefore arrives with `url === undefined`, every tab
// is skipped, and the sender half of the event pipeline is silently dead.
// Asking for "tabs" would put a "read your browsing history" warning on a
// self-custodial wallet's install prompt, and broadcasting to every open tab
// would push one dApp's account ids and names through unrelated sites'
// content-script worlds. So the answer comes from data the worker already has.
//
// `chrome.runtime.onMessage` hands the service worker a `sender` the page
// cannot forge, carrying `sender.tab.id` and the sending frame's origin. Any
// dApp that can receive an event has, by construction, already sent at least
// one `bridge.*` message through that listener, so recording tabId -> origin
// there builds exactly the delivery set the broadcaster needs, with no new
// permission and no fan-out to unrelated tabs.
//
// Two properties worth stating plainly:
//
//   - The map is a delivery HINT, never a security boundary. A tab that
//     navigates away keeps its entry until it is evicted or overwritten, so a
//     stale entry can address an event at a document it was not meant for.
//     `contentScript.js` drops any `bridge.event` whose `origin` stamp does
//     not match `window.location.origin`, and that receiver-side check - the
//     only one running against the document actually loaded - stays the
//     authority, exactly as it was under the URL-snapshot design.
//   - A tab that has never called a bridge method receives nothing. That is
//     the intended shape: a page holding no bridge conversation has no
//     provider subscription the wallet knows about, and it re-registers on its
//     next call.
//
// `chrome.storage.session` backs the map because Chrome evicts an idle MV3
// service worker in ~30s while the main event source is the wallet UI mutating
// site permissions long after that; without persistence the registry would be
// empty at exactly the moment it is read. Session storage defaults to
// TRUSTED_CONTEXTS (this extension never calls `setAccessLevel`), so no
// content script can read it, and it clears on browser close.

/** chrome.storage.session key holding the tabId -> origin map. */
export const CONNECTED_TABS_SESSION_KEY = 'xchain.connectedTabs';

/** Upper bound on retained entries; oldest insertion is dropped first. */
export const DEFAULT_MAX_CONNECTED_TABS = 200;

/**
 * @typedef {Object} ConnectedTabRegistry
 * @property {(tabId: number, origin: string) => void} record        note a tab as talking to `origin`
 * @property {(tabId: number) => void} forget                        drop a tab (closed, or evicted)
 * @property {(origin: string) => Promise<number[]>} tabsForOrigin   delivery set for a fan-out
 * @property {(tabsSurface?: any) => () => void} attach              wire tab-close eviction
 * @property {() => Promise<Record<string, string>>} snapshot        hydrated map, for tests/diagnostics
 */

/**
 * @param {{
 *   sessionArea?: { get: Function, set: Function },
 *   maxEntries?: number,
 * }} [deps]
 * @returns {ConnectedTabRegistry}
 */
export function createConnectedTabRegistry(deps = {}) {
    const area = deps.sessionArea ?? globalThis.chrome?.storage?.session ?? null;
    const maxEntries =
        Number.isInteger(deps.maxEntries) && deps.maxEntries > 0
            ? deps.maxEntries
            : DEFAULT_MAX_CONNECTED_TABS;

    /** @type {Map<number, string>} tabId -> origin, insertion-ordered */
    const memo = new Map();
    // Tabs closed before hydration finished. Without this, a forget() racing a
    // cold read would be undone by the stored copy it has not seen yet.
    /** @type {Set<number>} */
    const forgotten = new Set();
    /** @type {Promise<void> | null} */
    let hydrating = null;
    let hydrated = !area;
    let writeChain = Promise.resolve();

    // chrome.storage accepts either a callback or (MV3) a returned promise, and
    // test doubles implement one or the other. Settle on whichever arrives and
    // never reject: a registry read failure degrades delivery, and must not
    // propagate into a bridge handler.
    function readStored() {
        return new Promise((resolve) => {
            try {
                const ret = area.get(CONNECTED_TABS_SESSION_KEY, (items) => {
                    resolve(items?.[CONNECTED_TABS_SESSION_KEY]);
                });
                if (ret && typeof ret.then === 'function') {
                    ret.then(
                        (items) => resolve(items?.[CONNECTED_TABS_SESSION_KEY]),
                        () => resolve(undefined),
                    );
                }
            } catch {
                resolve(undefined);
            }
        });
    }

    function writeStored(record) {
        return new Promise((resolve) => {
            try {
                const ret = area.set({ [CONNECTED_TABS_SESSION_KEY]: record }, () => resolve());
                if (ret && typeof ret.then === 'function') {
                    ret.then(() => resolve(), () => resolve());
                }
            } catch {
                resolve();
            }
        });
    }

    function ensureHydrated() {
        if (hydrated) return Promise.resolve();
        if (!hydrating) {
            hydrating = readStored().then((stored) => {
                if (stored && typeof stored === 'object') {
                    for (const [key, origin] of Object.entries(stored)) {
                        const tabId = Number(key);
                        if (!Number.isInteger(tabId) || typeof origin !== 'string') continue;
                        // In-memory state is newer than anything on disk: a record()
                        // that landed during the read wins, and a forget() stays gone.
                        if (memo.has(tabId) || forgotten.has(tabId)) continue;
                        memo.set(tabId, origin);
                    }
                    trim();
                }
                hydrated = true;
                forgotten.clear();
            });
        }
        return hydrating;
    }

    function trim() {
        while (memo.size > maxEntries) {
            const oldest = memo.keys().next();
            if (oldest.done) break;
            memo.delete(oldest.value);
        }
    }

    function currentRecord() {
        /** @type {Record<string, string>} */
        const out = {};
        for (const [tabId, origin] of memo) out[String(tabId)] = origin;
        return out;
    }

    // Writes serialize behind one chain so two records in the same turn cannot
    // interleave read-modify-write, and every write waits on hydration so a
    // cold worker never persists a partial map over a fuller stored one.
    function persist() {
        if (!area) return;
        writeChain = writeChain
            .then(ensureHydrated)
            .then(() => writeStored(currentRecord()))
            .catch(() => {});
    }

    function record(tabId, origin) {
        if (!Number.isInteger(tabId)) return;
        if (typeof origin !== 'string' || origin.length === 0) return;
        forgotten.delete(tabId);
        if (memo.get(tabId) === origin) return;
        memo.set(tabId, origin);
        trim();
        persist();
    }

    function forget(tabId) {
        if (!Number.isInteger(tabId)) return;
        memo.delete(tabId);
        if (!hydrated) forgotten.add(tabId);
        persist();
    }

    async function tabsForOrigin(origin) {
        if (typeof origin !== 'string' || origin.length === 0) return [];
        await ensureHydrated();
        const out = [];
        for (const [tabId, recorded] of memo) {
            if (recorded === origin) out.push(tabId);
        }
        return out;
    }

    function attach(tabsSurface) {
        const surface = tabsSurface ?? globalThis.chrome?.tabs ?? null;
        if (typeof surface?.onRemoved?.addListener !== 'function') return () => {};
        // chrome.tabs.onRemoved reports a tab id and nothing URL-derived, so it
        // is available to a manifest holding no "tabs" permission - the one
        // tab-lifecycle signal this extension can actually subscribe to.
        const listener = (tabId) => forget(tabId);
        surface.onRemoved.addListener(listener);
        return () => {
            if (typeof surface.onRemoved.removeListener === 'function') {
                surface.onRemoved.removeListener(listener);
            }
        };
    }

    async function snapshot() {
        await ensureHydrated();
        return currentRecord();
    }

    return { record, forget, tabsForOrigin, attach, snapshot };
}
