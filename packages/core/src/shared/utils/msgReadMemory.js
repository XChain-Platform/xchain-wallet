// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-conversation read marks for the messaging inbox. Stores, per wallet +
// account, a map of counterparty address -> the list of incoming-message txids
// the user has opened past in that thread. A conversation is "unread" when it
// holds an incoming message whose txid is not in that set.
//
// Why identity (txids) and not a high-water timestamp: the inbox re-derives
// every message's block time from chain on each load, so a single stored
// timestamp flips back to unread whenever the recomputed newest-incoming time
// rises above it (a newly indexed message, a reorg shifting block_time). Seen
// txids are stable from mempool through confirmation and reindex, so read state
// stays put across reloads and only a genuinely new message (new txid) re-flags
// the thread.
//
// Why localStorage instead of vault settings: like the rest of the wallet's
// ephemeral per-device UI state (last view, active account), read marks are a
// convenience that should not survive a from-seed restore. A user re-importing
// their seed onto a fresh device starts with everything unread rather than
// inheriting another device's read state, which is the safe default.

const NS = 'xc:msgRead:';

function scopeKey(walletId, accountId) {
    return `${walletId}:${accountId || 'default'}`;
}

function safeGet(key) {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(NS + key);
    } catch { return null; }
}

function safeSet(key, value) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(NS + key, value);
    } catch { /* noop */ }
}

/**
 * Read the seen-txid map for a wallet + account. Returns an empty object when
 * nothing is stored or the persisted value is unparseable, so callers can treat
 * a missing entry as "never read" (no txids seen).
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @returns {Record<string, string[]>}
 */
export function readMsgRead(walletId, accountId) {
    if (typeof walletId !== 'string' || !walletId) return {};
    const raw = safeGet(scopeKey(walletId, accountId));
    if (typeof raw !== 'string' || !raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return {};
        /** @type {Record<string, string[]>} */
        const out = {};
        for (const [cp, value] of Object.entries(parsed)) {
            // Each entry is the list of seen incoming txids. Legacy installs
            // stored a single high-water timestamp (a number) here; that can't
            // be mapped to txids, so it is dropped and the thread reads as
            // unread once after upgrade (the module's safe default).
            if (Array.isArray(value)) {
                out[cp] = value.filter((t) => typeof t === 'string' && t);
            }
        }
        return out;
    } catch { return {}; }
}

/**
 * Persist the full seen-txid map for a wallet + account, replacing any prior
 * value. Callers hold the map in state, update it, and write the whole thing.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @param {Record<string, string[]>} map
 */
export function writeMsgRead(walletId, accountId, map) {
    if (typeof walletId !== 'string' || !walletId) return;
    if (!map || typeof map !== 'object') return;
    safeSet(scopeKey(walletId, accountId), JSON.stringify(map));
}

// --- Unread-count snapshot --------------------------------------------------
//
// The read marks above are per-conversation and only known to the inbox. The
// app-level surfaces (nav badge, Home banner, Home button) need a single number
// without loading the whole inbox, so the inbox publishes a per-account unread
// count here whenever it loads. It is a snapshot of the last sweep, not a live
// figure: real-time arrival is covered by the OS notification path instead.

const UNREAD_NS = 'xc:msgUnread:';

// Fires after every write so a mounted view in the same document refreshes
// without polling. Listeners also watch the cross-tab `storage` event.
export const MSG_UNREAD_EVENT = 'xchain:msgUnread';

/**
 * Read the unread-conversation count for a wallet + account. Returns 0 when
 * nothing is stored or the value is unparseable.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @returns {number}
 */
export function readMsgUnread(walletId, accountId) {
    if (typeof walletId !== 'string' || !walletId) return 0;
    try {
        if (typeof localStorage === 'undefined') return 0;
        const raw = localStorage.getItem(UNREAD_NS + scopeKey(walletId, accountId));
        const n = raw == null ? 0 : Number(JSON.parse(raw)?.count);
        return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
}

/**
 * Persist the unread-conversation count for a wallet + account and notify
 * same-document listeners via the MSG_UNREAD_EVENT window event.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 * @param {number} count
 */
export function writeMsgUnread(walletId, accountId, count) {
    if (typeof walletId !== 'string' || !walletId) return;
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(UNREAD_NS + scopeKey(walletId, accountId), JSON.stringify({ count: n }));
    } catch { /* noop */ }
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(MSG_UNREAD_EVENT, {
                detail: { walletId, accountId: accountId || 'default', count: n },
            }));
        }
    } catch { /* noop */ }
}

// --- Wallet-removal sweep ---------------------------------------------------
//
// A wallet can hold many accounts, each with its own `xc:msgRead:` and
// `xc:msgUnread:` entry (scopeKey embeds accountId), so removal has to sweep
// every entry keyed under that walletId, not just the 'default' account. This
// walks the store the same way clearAllChainFilters does: via
// localStorage.length/.key(i), because Object.keys(localStorage) is known to
// lie in the service-worker / extension-popup environments this wallet ships
// in, which would silently leave orphaned keys behind in exactly those shells.

/**
 * Remove every xc:msgRead: and xc:msgUnread: entry for a wallet, across all
 * of its accounts, and notify same-document listeners (the nav badge via
 * useMessagingUnread) so they refresh without a reload. Call this at every
 * wallet-removal entry point; a removed wallet's messaging read marks and
 * unread counts otherwise persist forever under an id nothing will ever look
 * up again.
 *
 * @param {string | null | undefined} walletId
 * @returns {number}   how many keys were removed (best-effort count;
 *                     localStorage failures are tolerated and counted as 0)
 */
export function sweepMsgMemoryForWallet(walletId) {
    if (typeof walletId !== 'string' || !walletId) return 0;
    let removed = 0;
    try {
        if (typeof localStorage === 'undefined') return 0;
        const readPrefix = NS + walletId + ':';
        const unreadPrefix = UNREAD_NS + walletId + ':';
        /** @type {string[]} */
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (typeof k === 'string' && (k.startsWith(readPrefix) || k.startsWith(unreadPrefix))) {
                toRemove.push(k);
            }
        }
        for (const k of toRemove) {
            try { localStorage.removeItem(k); removed += 1; } catch { /* tolerate */ }
        }
    } catch {
        return 0;
    }
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent(MSG_UNREAD_EVENT, {
                detail: { walletId, accountId: 'default', count: 0 },
            }));
        }
    } catch { /* noop */ }
    return removed;
}
