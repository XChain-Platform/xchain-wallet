// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// How long a saved read of this wallet's explorer data (balances, owned
// tokens, recent activity) is reused before the next one goes to the network.
// A broadcast from this device stamps every saved copy stale at once, through
// one stored time rather than a rewrite of each copy, so a screen that was
// unmounted during the send reads fresh data when it opens again.

/** A saved read younger than this is shown without a request. */
export const BALANCE_MAX_AGE_MS = 5 * 60_000;

/** How often an open screen checks whether its data has aged past the limit. */
export const BALANCE_CHECK_INTERVAL_MS = 60_000;

// Under the balance cache prefix so the wallet wipe and the quota trim clear it.
export const WALLET_DATA_STALE_KEY = 'xc:balanceCache:staleAt';

/** @type {Set<() => void>} */
const listeners = new Set();
// Kept in memory as well, for a realm whose storage refuses the write.
let memoryStaleAt = 0;

/** When this device last broadcast, or 0. */
export function readWalletDataStaleAt() {
    let stored = 0;
    try {
        const raw = globalThis.localStorage?.getItem(WALLET_DATA_STALE_KEY);
        const parsed = raw == null ? NaN : Number(raw);
        if (Number.isFinite(parsed) && parsed > 0) stored = parsed;
    } catch { /* storage unavailable */ }
    return Math.max(memoryStaleAt, stored);
}

/**
 * Was a read taken at `readAt` recent enough to show without a request?
 * A read from before this device's last broadcast never is.
 *
 * @param {number | null | undefined} readAt
 * @param {number} [now]
 * @param {number} [maxAgeMs]
 */
export function isWalletDataFresh(readAt, now = Date.now(), maxAgeMs = BALANCE_MAX_AGE_MS) {
    if (typeof readAt !== 'number' || !Number.isFinite(readAt) || readAt <= 0) return false;
    const age = now - readAt;
    // A read stamped in the future means the clock moved; trust it no longer.
    if (age < 0 || age >= maxAgeMs) return false;
    // A tie is a read the mark itself started, so it counts as after it.
    return readAt >= readWalletDataStaleAt();
}

/**
 * The time a read that began at `startedAt` and lands now counts from: its
 * landing, unless this device broadcast while it was in flight, in which case
 * its start, which leaves it stale.
 *
 * @param {number} startedAt
 * @param {number} [now]
 */
export function readTimeOf(startedAt, now = Date.now()) {
    return readWalletDataStaleAt() > startedAt ? startedAt : now;
}

function notify() {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch { /* one subscriber's failure must not block the others */ }
    }
}

/**
 * A transaction left this device, or the user asked for a refresh: every saved
 * wallet read is now out of date. `notify: false` only stamps the time, for a
 * caller that remounts the readers itself.
 *
 * @param {{ now?: number, notify?: boolean }} [options]
 */
export function markWalletDataStale({ now = Date.now(), notify: tell = true } = {}) {
    memoryStaleAt = Math.max(memoryStaleAt, now);
    try {
        globalThis.localStorage?.setItem(WALLET_DATA_STALE_KEY, String(memoryStaleAt));
    } catch { /* the memory copy still covers this window */ }
    if (tell) notify();
}

function onStorage(event) {
    if (event?.key === WALLET_DATA_STALE_KEY) notify();
}

/**
 * Hear every stale mark: this window's own, and another window's through the
 * storage event (an extension approval window, a second tab).
 *
 * @param {() => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeWalletDataStale(listener) {
    if (typeof listener !== 'function') return () => {};
    if (listeners.size === 0) globalThis.addEventListener?.('storage', onStorage);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage);
    };
}

/** Test hook: forget the in-memory stale time. */
export function _resetWalletDataStale() {
    memoryStaleAt = 0;
}
