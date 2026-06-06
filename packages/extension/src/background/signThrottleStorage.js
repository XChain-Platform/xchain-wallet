// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// signThrottleStorage — §12 / Cluster S FOLLOWUP 2.
//
// Persistence layer for the per-origin sign-throttle bucket state. Without
// this, a service-worker restart (extension MV3) drops the bucket map and
// a malicious dApp that just got rate-limited could burst-spam right after
// reload because the wallet "forgot". The throttle layer (createSignThrottle
// in core/flows/signThrottle.js) emits a snapshot on every mutation; this
// module persists those snapshots and rehydrates at boot.
//
// Mirrors broadcastQueueStorage's shape:
//   - Extension SW    → `chrome.storage.local`
//   - Web renderer    → `localStorage`
//   - Desktop renderer → `localStorage` (same Chromium runtime)
//   - Tests / no shell → null (in-memory only, the v0.219.0 behavior)
//
// Snapshot shape: `{ buckets: Record<origin, number[]> }`. The number list
// is a chronological series of recent request timestamps (ms). Stale
// timestamps fall out via the existing windowMs eviction in the throttle.

const STORAGE_KEY = 'xchain.signThrottle';

/**
 * @typedef {{ buckets: Record<string, number[]> }} ThrottleSnapshot
 */

/**
 * @typedef {Object} SignThrottleStorage
 * @property {() => Promise<ThrottleSnapshot>} load
 * @property {(snapshot: ThrottleSnapshot) => Promise<void>} save
 * @property {() => Promise<void>} clear
 */

/**
 * @returns {SignThrottleStorage | null}
 */
export function createSignThrottleStorage() {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        return chromeLocalAdapter();
    }
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            return localStorageAdapter();
        }
    } catch (_e) {
        /* ignore */
    }
    return null;
}

function chromeLocalAdapter() {
    return {
        async load() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(STORAGE_KEY, (items) => {
                        resolve(coerceSnapshot(items?.[STORAGE_KEY]));
                    });
                } catch (_e) {
                    resolve({ buckets: {} });
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
                if (typeof raw !== 'string' || !raw) return { buckets: {} };
                return coerceSnapshot(JSON.parse(raw));
            } catch (_e) {
                return { buckets: {} };
            }
        },
        async save(snapshot) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
            } catch (_e) {
                // Quota / privacy mode — tolerate so the throttle mutation
                // itself still completes (it's already in memory).
            }
        },
        async clear() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
        },
    };
}

/**
 * Defensive parse — only origins → finite-number arrays survive. Anything
 * malformed gets dropped silently rather than crashing the background.
 */
function coerceSnapshot(v) {
    if (!v || typeof v !== 'object') return { buckets: {} };
    const rawBuckets = v.buckets;
    if (!rawBuckets || typeof rawBuckets !== 'object') return { buckets: {} };
    /** @type {Record<string, number[]>} */
    const out = {};
    for (const origin of Object.keys(rawBuckets)) {
        if (typeof origin !== 'string' || origin.length === 0) continue;
        const arr = rawBuckets[origin];
        if (!Array.isArray(arr)) continue;
        const filtered = arr.filter((ts) => Number.isFinite(ts));
        if (filtered.length > 0) out[origin] = filtered;
    }
    return { buckets: out };
}
