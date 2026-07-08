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
// Policy: FREE_ATTEMPTS mistypes with no delay, then an exponential backoff
// per additional consecutive failure, capped. A correct unlock clears it.

export const FREE_ATTEMPTS = 5;
const BASE_MS = 15 * 1000;          // first penalty once past the free attempts
const CAP_MS = 15 * 60 * 1000;      // 15 minutes maximum lockout

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
    if (!Number.isFinite(failCount) || failCount <= FREE_ATTEMPTS) return 0;
    const over = failCount - FREE_ATTEMPTS;             // 1, 2, 3, ...
    return Math.min(CAP_MS, BASE_MS * 2 ** (over - 1)); // 15s, 30s, 60s, ...
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
