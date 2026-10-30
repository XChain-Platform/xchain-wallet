// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const AUTO_LOCK_GUARD_CHANGED_EVENT = 'xc:auto-lock-guard-changed';

/**
 * Longest one signing or broadcast request holds a due idle lock. A hardware
 * wallet confirm can run for minutes; a request hung on an unreachable
 * network must not keep a wallet open for good. The extension worker applies
 * the same ceiling to the requests it tracks.
 */
export const AUTO_LOCK_REQUEST_CEILING_MS = 10 * 60_000;

/** @type {Set<{ startedAt: number }>} */
const holds = new Set();

function now() {
    return Date.now();
}

// A hold older than the ceiling stops counting and is dropped, so its late
// release finds nothing to remove and leaves every other hold in place.
function pruneExpired() {
    const at = now();
    for (const hold of holds) {
        if (at - hold.startedAt >= AUTO_LOCK_REQUEST_CEILING_MS) holds.delete(hold);
    }
}

function notify() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTO_LOCK_GUARD_CHANGED_EVENT, {
        detail: { active: isAutoLockHeld() },
    }));
}

/**
 * Keep auto-lock from clearing signer material during an approved operation,
 * for at most AUTO_LOCK_REQUEST_CEILING_MS.
 * The returned release is idempotent so every terminal path can call it.
 */
export function holdAutoLock() {
    pruneExpired();
    const hold = { startedAt: now() };
    holds.add(hold);
    notify();
    return () => {
        if (!holds.delete(hold)) return;
        notify();
    };
}

export function isAutoLockHeld() {
    pruneExpired();
    return holds.size > 0;
}

/**
 * Run one approved signing or broadcast request under the hold, so an idle
 * deadline that passes while it is in flight waits for the request to settle
 * instead of tearing the session down under it and dropping the outcome.
 *
 * @template T
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export async function withAutoLockHold(run) {
    const release = holdAutoLock();
    try {
        return await run();
    } finally {
        release();
    }
}
