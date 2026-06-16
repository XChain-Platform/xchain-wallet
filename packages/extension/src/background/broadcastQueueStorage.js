// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueueStorage — §49.5 / Cluster G FOLLOWUP 2.
//
// Persistence layer for the queued-broadcast surface. The queue itself
// lives as an in-memory `Map<walletId, entry[]>` inside createBackground-
// Host; this module rehydrates that map at boot and writes it back on
// every mutation so a service-worker restart (extension), a tab refresh
// (web), or an Electron app relaunch (desktop) doesn't lose the user's
// signed-but-unbroadcast txs.
//
// One adapter handles all three shells:
//   - Extension SW    → `chrome.storage.local` (no localStorage in MV3)
//   - Web renderer    → `localStorage`
//   - Desktop renderer → `localStorage` (Chromium has both; localStorage
//                                       is simpler than wiring electron-
//                                       store across the IPC boundary)
//
// When neither API is available (Node tests, ad-hoc smoke harness),
// `createBroadcastQueueStorage` returns null and createBackgroundHost
// falls back to in-memory only — the prior v0.292.0 behavior.

const STORAGE_KEY = 'xchain.broadcastQueue';

/**
 * Internal entry shape (mirrors what createBackgroundHost pushes).
 * @typedef {{ id: string, chainId: string, signedTxHex: string, summary: string, signedAt: number, txid?: string }} QueueEntry
 */

/**
 * Snapshot shape persisted to storage.
 * @typedef {Record<string, QueueEntry[]>} QueueSnapshot
 */

/**
 * @typedef {Object} BroadcastQueueStorage
 * @property {() => Promise<QueueSnapshot>} load
 * @property {(snapshot: QueueSnapshot) => Promise<void>} save
 * @property {() => Promise<void>} clear
 */

/**
 * Pick the right adapter for the current process. Extension SW prefers
 * `chrome.storage.local`; renderer-hosts prefer `localStorage`. Returns
 * `null` when neither is reachable so the caller can fall back to
 * in-memory only.
 *
 * @returns {BroadcastQueueStorage | null}
 */
export function createBroadcastQueueStorage() {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        return chromeLocalAdapter();
    }
    // Some smoke harnesses provide a global `localStorage` polyfill.
    // Only use it when we can actually call get/set without throwing.
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            return localStorageAdapter();
        }
    } catch (_e) {
        // Access can throw under strict iframe sandboxes etc.
    }
    return null;
}

function chromeLocalAdapter() {
    return {
        async load() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(STORAGE_KEY, (items) => {
                        const v = items?.[STORAGE_KEY];
                        resolve(coerceSnapshot(v));
                    });
                } catch (_e) {
                    resolve({});
                }
            });
        },
        async save(snapshot) {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.set({ [STORAGE_KEY]: snapshot }, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
        async clear() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.remove(STORAGE_KEY, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
    };
}

function localStorageAdapter() {
    return {
        async load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (typeof raw !== 'string' || !raw) return {};
                return coerceSnapshot(JSON.parse(raw));
            } catch (_e) {
                return {};
            }
        },
        async save(snapshot) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            } catch (_e) {
                // Quota errors / privacy modes — tolerate so the queue
                // mutation itself still succeeds.
            }
        },
        async clear() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
        },
    };
}

/**
 * Defensive parse: only walletIds → entry-arrays survive. Anything that
 * isn't a sane shape gets dropped silently rather than crashing the
 * background process at boot.
 */
function coerceSnapshot(v) {
    if (!v || typeof v !== 'object') return {};
    /** @type {QueueSnapshot} */
    const out = {};
    for (const walletId of Object.keys(v)) {
        const arr = v[walletId];
        if (!Array.isArray(arr)) continue;
        const filtered = arr.filter((e) => (
            e
            && typeof e === 'object'
            && typeof e.id === 'string'
            && typeof e.chainId === 'string'
            && typeof e.signedTxHex === 'string'
        ));
        if (filtered.length > 0) out[walletId] = filtered;
    }
    return out;
}
