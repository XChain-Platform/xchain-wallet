// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueueStorage (§49.5 / Cluster G FOLLOWUP 2).
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
// falls back to in-memory only (the prior v0.292.0 behavior).

const STORAGE_KEY = 'xchain.broadcastQueue';

/**
 * Internal entry shape (mirrors what createBackgroundHost pushes).
 * @typedef {{ id: string, chainId: string, signedTxHex: string, summary: string, signedAt: number, txid?: string }} QueueEntry
 */

/**
 * Snapshot shape the host hands `save` and gets back from `load`.
 * @typedef {Record<string, QueueEntry[]>} QueueSnapshot
 */

/**
 * One PendingTx write the vault refused, held until a vault that accepts it.
 * Carries the record's id and the write to apply, never signed bytes.
 * @typedef {{ id: string, walletId?: string, pendingTxId: string, op: 'patch' | 'discard', patch?: object, recordedAt?: number }} OwedSettlement
 */

/**
 * `load` separates "storage is unreadable" from "storage is empty": a real
 * read failure resolves `null`, an absent or empty key resolves `{}`. The
 * host cannot fail closed on a read it cannot tell apart from an empty
 * queue, and a snapshot written back from a state that was never read
 * erases every entry the failed read did not deliver, including other
 * wallets'. A stored blob that parses to nothing usable is still `{}`:
 * there is nothing recoverable behind it, so refusing to persist over it
 * would strand the queue for good.
 *
 * Both halves ride ONE storage key. The wallet wipe clears the local store by
 * enumerated key, so a second key would need registering there to be erased
 * and would otherwise outlive the wallet holding records that name its
 * transactions. `loadSettlements` reports the journal the last successful
 * `load` read, and either save writes the pair, so neither half can erase the
 * other.
 *
 * @typedef {Object} BroadcastQueueStorage
 * @property {() => Promise<QueueSnapshot | null>} load
 * @property {(snapshot: QueueSnapshot) => Promise<void>} save
 * @property {() => Promise<OwedSettlement[]>} loadSettlements
 * @property {(owed: OwedSettlement[]) => Promise<void>} saveSettlements
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

/**
 * Wrap a shell's raw key IO in the two-half envelope.
 *
 * `read` reports `{ ok: false }` for a store it could not reach and
 * `{ ok: true, blob }` otherwise, which is what keeps "unreadable" and "empty"
 * apart all the way up to the host.
 *
 * @param {{ read: () => Promise<{ ok: boolean, blob?: unknown }>,
 *           write: (blob: unknown) => Promise<void>,
 *           remove: () => Promise<void> }} io
 * @returns {BroadcastQueueStorage}
 */
function envelopeAdapter(io) {
    // Last successfully read state of the key. This adapter is its process's
    // only writer, so saving one half alongside the cached other half keeps
    // the pair consistent with no read-modify-write race between them.
    let cached = { queues: /** @type {QueueSnapshot} */ ({}), settlements: /** @type {OwedSettlement[]} */ ([]) };
    async function persist() {
        await io.write({ queues: cached.queues, settlements: cached.settlements });
    }
    return {
        async load() {
            const read = await io.read();
            if (!read.ok) return null;
            cached = splitBlob(read.blob);
            return cached.queues;
        },
        async loadSettlements() {
            return cached.settlements.map((s) => ({ ...s }));
        },
        async save(snapshot) {
            cached.queues = snapshot;
            await persist();
        },
        async saveSettlements(owed) {
            cached.settlements = Array.isArray(owed) ? owed : [];
            await persist();
        },
        async clear() {
            cached = { queues: {}, settlements: [] };
            await io.remove();
        },
    };
}

function chromeLocalAdapter() {
    return envelopeAdapter({
        read() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.get(STORAGE_KEY, (items) => {
                        // MV3 reports a failed read through `lastError` rather
                        // than by throwing, so a get that never touched the
                        // store still arrives here with `items` undefined.
                        // Reading it as an empty queue is what lets the next
                        // save wipe the persisted entries.
                        if (chrome.runtime?.lastError || !items) {
                            resolve({ ok: false });
                            return;
                        }
                        resolve({ ok: true, blob: items[STORAGE_KEY] });
                    });
                } catch (_e) {
                    resolve({ ok: false });
                }
            });
        },
        write(blob) {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.set({ [STORAGE_KEY]: blob }, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
        remove() {
            return new Promise((resolve) => {
                try {
                    chrome.storage.local.remove(STORAGE_KEY, () => resolve());
                } catch (_e) {
                    resolve();
                }
            });
        },
    });
}

function localStorageAdapter() {
    return envelopeAdapter({
        async read() {
            let raw;
            try {
                raw = localStorage.getItem(STORAGE_KEY);
            } catch (_e) {
                // The store itself is unreachable (privacy mode, sandboxed
                // iframe, disabled site data). Entries may well be sitting
                // in it, so report the failure instead of an empty queue.
                return { ok: false };
            }
            if (typeof raw !== 'string' || !raw) return { ok: true, blob: {} };
            try {
                return { ok: true, blob: JSON.parse(raw) };
            } catch (_e) {
                // Unparseable blob: nothing behind it is recoverable, so
                // treat it as empty and let the next save replace it.
                return { ok: true, blob: {} };
            }
        },
        async write(blob) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
            } catch (_e) {
                // Quota errors / privacy modes: tolerate so the queue
                // mutation itself still succeeds.
            }
        },
        async remove() {
            try { localStorage.removeItem(STORAGE_KEY); } catch (_e) { /* ignore */ }
        },
    });
}

/**
 * Split a stored blob into its two halves. A blob written before the journal
 * existed carries the wallet queues at the top level, so anything without an
 * envelope `queues` object reads as queues alone.
 *
 * @param {unknown} blob
 * @returns {{ queues: QueueSnapshot, settlements: OwedSettlement[] }}
 */
function splitBlob(blob) {
    const isEnvelope = !!blob
        && typeof blob === 'object'
        && !Array.isArray(blob)
        && !!(/** @type {any} */ (blob).queues)
        && typeof (/** @type {any} */ (blob).queues) === 'object'
        && !Array.isArray(/** @type {any} */ (blob).queues);
    if (!isEnvelope) return { queues: coerceSnapshot(blob), settlements: [] };
    const env = /** @type {any} */ (blob);
    return { queues: coerceSnapshot(env.queues), settlements: coerceSettlements(env.settlements) };
}

/**
 * Defensive parse for the journal. A record without the id it names or without
 * a write to apply cannot be replayed, so it is dropped rather than kept as a
 * permanent resident of the blob.
 */
function coerceSettlements(v) {
    if (!Array.isArray(v)) return [];
    return v.filter((s) => (
        s
        && typeof s === 'object'
        && typeof s.id === 'string'
        && typeof s.pendingTxId === 'string'
        && s.pendingTxId
        && (s.op === 'discard' || (s.op === 'patch' && !!s.patch && typeof s.patch === 'object'))
    ));
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
