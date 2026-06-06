// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Lockout tracking — §26 / G066. Persists failed-unlock counters and
// timed lockouts across pop-up close/open and tab reload.
//
// The wallet vault is encrypted under the password the user is trying
// to enter, so we cannot store lockout state inside it. Instead we use
// the host's `localStorage` (web app, extension popup, desktop renderer
// — every shell that mounts the Locked screen has it). When localStorage
// is unavailable (SSR, tests, very old contexts) the helpers degrade to
// in-memory state held only for the lifetime of the process — at the
// cost of "close the popup to reset the counter", which is documented.
//
// Schedule (after N consecutive failed attempts the next attempt is
// gated for `delayFor(N)` seconds):
//
//   N ≤ 2     no delay
//   N = 3     5 s
//   N = 4     15 s
//   N = 5     60 s
//   N = 6     5 min
//   N ≥ 7     15 min  (cap)
//
// A successful unlock clears all state. An unlock attempt that throws
// anything other than InvalidPasswordError is treated as a bug, not a
// bad guess, and does NOT increment the counter.

const STORAGE_KEY = 'xchain-wallet:lockout';

const SCHEDULE_SECONDS = /** @type {const} */ ([
    0,    // N=0
    0,    // N=1
    0,    // N=2
    5,    // N=3
    15,   // N=4
    60,   // N=5
    300,  // N=6
]);
const MAX_DELAY_SECONDS = 900;  // N >= 7 cap

let memoryFallback = null;

/**
 * @typedef {Object} LockoutState
 * @property {number} failedAttempts
 * @property {number} lockedUntilMs   epoch-ms; 0 = not locked
 */

/** @returns {LockoutState} */
export function emptyLockoutState() {
    return { failedAttempts: 0, lockedUntilMs: 0 };
}

function getStorage() {
    try {
        if (typeof globalThis.localStorage !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch (_err) {
        // SecurityError on cross-origin frames, etc. — fall through.
    }
    return null;
}

/** @returns {LockoutState} */
function readState() {
    const store = getStorage();
    if (!store) return memoryFallback ? { ...memoryFallback } : emptyLockoutState();
    try {
        const raw = store.getItem(STORAGE_KEY);
        if (!raw) return emptyLockoutState();
        const parsed = JSON.parse(raw);
        if (
            !parsed
            || typeof parsed.failedAttempts !== 'number'
            || typeof parsed.lockedUntilMs !== 'number'
            || parsed.failedAttempts < 0
            || parsed.lockedUntilMs < 0
        ) {
            return emptyLockoutState();
        }
        return {
            failedAttempts: Math.floor(parsed.failedAttempts),
            lockedUntilMs: Math.floor(parsed.lockedUntilMs),
        };
    } catch (_err) {
        return emptyLockoutState();
    }
}

/** @param {LockoutState} state */
function writeState(state) {
    const store = getStorage();
    if (!store) {
        memoryFallback = { ...state };
        return;
    }
    try {
        if (state.failedAttempts === 0 && state.lockedUntilMs === 0) {
            store.removeItem(STORAGE_KEY);
        } else {
            store.setItem(STORAGE_KEY, JSON.stringify(state));
        }
    } catch (_err) {
        memoryFallback = { ...state };
    }
}

/** @param {number} failedAttempts @returns {number} seconds */
export function delayForAttempts(failedAttempts) {
    if (!Number.isFinite(failedAttempts) || failedAttempts < 0) return 0;
    const n = Math.floor(failedAttempts);
    if (n < SCHEDULE_SECONDS.length) return SCHEDULE_SECONDS[n];
    return MAX_DELAY_SECONDS;
}

/** @returns {LockoutState} */
export function getLockoutState() {
    return readState();
}

/**
 * Compute remaining lockout in milliseconds. Returns 0 when not locked.
 * @param {LockoutState} state
 * @param {number} [nowMs]
 * @returns {number}
 */
export function getRemainingMs(state, nowMs = Date.now()) {
    if (!state || !state.lockedUntilMs) return 0;
    const diff = state.lockedUntilMs - nowMs;
    return diff > 0 ? diff : 0;
}

/**
 * Record a bad-password failure. Increments the counter and sets the
 * next `lockedUntilMs` based on the schedule. Returns the new state.
 *
 * @param {number} [nowMs]
 * @returns {LockoutState}
 */
export function recordFailure(nowMs = Date.now()) {
    const prev = readState();
    const failedAttempts = prev.failedAttempts + 1;
    const delaySec = delayForAttempts(failedAttempts);
    const lockedUntilMs = delaySec > 0 ? nowMs + delaySec * 1000 : 0;
    const next = { failedAttempts, lockedUntilMs };
    writeState(next);
    return next;
}

/** Clear all lockout state — call after a successful unlock. */
export function recordSuccess() {
    writeState(emptyLockoutState());
}

/** Reset for tests / panic-mode resets. */
export function clearLockoutState() {
    memoryFallback = null;
    const store = getStorage();
    if (store) {
        try { store.removeItem(STORAGE_KEY); } catch (_err) { /* ignore */ }
    }
}
