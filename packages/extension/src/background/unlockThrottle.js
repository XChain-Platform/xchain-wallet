// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Background-enforced unlock throttle (§26).
//
// The renderer had a lockout keyed on localStorage + client Date.now(), which
// a local attacker driving `wallet.unlock` directly can bypass (roll the
// clock, or just not run the renderer). This is the authoritative gate: it
// lives beside the unlock handler in the service worker, persists across popup
// close and worker restart (chrome.storage.local), and is checked BEFORE the
// Argon2id KDF runs so a locked-out attempt costs no CPU and offers no timing
// signal. It is defence-in-depth: the KDF cost (~1s/attempt) is the primary
// brute-force barrier and an offline blob extraction bypasses any in-process
// gate, so this bounds sustained in-process hammering rather than replacing
// the KDF.
//
// Policy: FREE_ATTEMPTS mistypes with no delay, then the published delay
// ladder per additional consecutive failure, capped. A correct unlock clears it.
//
// This matches the Locked screen's G066 ladder in
// packages/core/src/flows/lockoutTracking.js: 2 free, then 5 s, 15 s, 60 s,
// 5 min, and a 15 min cap from failure 7. Desktop main uses this same policy,
// and it is the only one a direct `wallet.unlock` caller meets. The unit test
// pins both implementations together at every ladder step.

export const FREE_ATTEMPTS = 2;
const BACKOFF_MS = /** @type {const} */ ([
    0,                  // N=0
    0,                  // N=1
    0,                  // N=2
    5 * 1000,           // N=3
    15 * 1000,          // N=4
    60 * 1000,          // N=5
    5 * 60 * 1000,      // N=6
]);
const CAP_MS = 15 * 60 * 1000; // N >= 7

/**
 * @typedef {Object} UnlockThrottleState
 * @property {number} failCount        consecutive failed attempts
 * @property {number} lockedUntil      ms epoch; 0 when not currently locked
 */

/**
 * Backoff (ms) imposed AFTER the Nth consecutive failure. Zero for the first
 * FREE_ATTEMPTS so ordinary mistypes never lock the user out.
 *
 * @param {number} failCount
 * @returns {number}
 */
export function computeBackoffMs(failCount) {
    if (!Number.isFinite(failCount) || failCount < 0) return 0;
    const n = Math.floor(failCount);
    if (n < BACKOFF_MS.length) return BACKOFF_MS[n];
    return CAP_MS;
}

/**
 * Pure gate: may an unlock attempt proceed right now?
 *
 * @param {UnlockThrottleState | null} state
 * @param {number} now
 * @returns {{ allowed: boolean, retryAfterMs?: number }}
 */
export function checkUnlockAllowed(state, now) {
    if (!state || typeof state.lockedUntil !== 'number' || state.lockedUntil <= 0) {
        return { allowed: true };
    }
    if (now >= state.lockedUntil) return { allowed: true };
    return { allowed: false, retryAfterMs: state.lockedUntil - now };
}

/**
 * Next state after a failed attempt.
 *
 * @param {UnlockThrottleState | null} state
 * @param {number} now
 * @returns {UnlockThrottleState}
 */
export function recordFailure(state, now) {
    const failCount = ((state && Number(state.failCount)) || 0) + 1;
    const backoff = computeBackoffMs(failCount);
    return { failCount, lockedUntil: backoff > 0 ? now + backoff : 0 };
}

const STORAGE_KEY = 'xchain:unlockThrottle';

/**
 * chrome.storage.local-backed throttle store. Persistent (survives popup close
 * and worker restart) so an attacker can't reset the lockout by reloading. A
 * no-op when chrome.storage is unavailable (desktop / tests supply their own
 * store or none).
 */
export class ChromeUnlockThrottleStore {
    _area() {
        return globalThis.chrome?.storage?.local ?? null;
    }

    /** @returns {Promise<UnlockThrottleState | null>} */
    async load() {
        const area = this._area();
        if (!area) return null;
        try {
            const got = await area.get(STORAGE_KEY);
            const v = got?.[STORAGE_KEY];
            if (!v || typeof v !== 'object') return null;
            return {
                failCount: Number(v.failCount) || 0,
                lockedUntil: Number(v.lockedUntil) || 0,
            };
        } catch {
            return null;
        }
    }

    /** @param {UnlockThrottleState} state */
    async save(state) {
        const area = this._area();
        if (!area) return;
        try { await area.set({ [STORAGE_KEY]: state }); } catch { /* best-effort */ }
    }

    async clear() {
        const area = this._area();
        if (!area) return;
        try { await area.remove(STORAGE_KEY); } catch { /* best-effort */ }
    }
}
