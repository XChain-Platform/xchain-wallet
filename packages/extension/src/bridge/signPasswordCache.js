// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// signPasswordCache (§48.6 / Cluster Q FOLLOWUP 3): the password cache that
// backs Developer-Mode localhost auto-sign.
//
// A sign request unwraps the seed, which needs the wallet password. Auto-sign
// therefore cannot short-circuit the approval prompt without a password to
// reuse. This cache holds the password captured by a REAL user approval so a
// subsequent sign request from the same localhost dApp can proceed without a
// fresh prompt, for as long as the user-chosen timeout allows.
//
// Security posture (why this is safe enough to exist, and only for dev):
//   - The cache lives ONLY in the background service-worker's memory. It is
//     never written to chrome.storage / disk, so it dies with the SW and never
//     survives a browser restart. A re-prompt on SW restart is the fail-safe.
//   - Entries are keyed by walletId and bounded by an absolute expiry; a lookup
//     past expiry evicts and returns null.
//   - Nothing writes here unless Developer Mode is on AND the localhost
//     auto-sign timeout is a positive value (both off by default). The bridge
//     handlers gate every remember()/recall() behind shouldAutoApproveSign, so
//     on mainnet / production this cache is inert.
//
// The clock is injectable so tests can advance time deterministically.

// The cache holds the password and nothing else. No approval screen
// ever collected a BIP39 passphrase, and a passphrase wallet now carries its
// own encrypted 25th word on the record, so the second field was always
// undefined and is now gone from the shape.

/**
 * @typedef {{ password: string }} CachedCredential
 */

/**
 * @typedef {Object} SignPasswordCache
 * @property {(walletId: string, creds: CachedCredential, ttlMs: number) => void} remember
 * @property {(walletId: string) => CachedCredential | null} recall
 * @property {(walletId: string) => void} forget
 * @property {() => void} clear
 * @property {number} size
 */

/**
 * @param {{ now?: () => number }} [opts]
 * @returns {SignPasswordCache}
 */
export function createSignPasswordCache(opts = {}) {
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    /** @type {Map<string, { password: string, expiresAt: number }>} */
    const entries = new Map();

    return {
        remember(walletId, creds, ttlMs) {
            // A missing wallet id or password is not cacheable; a non-positive
            // TTL means the feature is off, so storing would be a leak with no
            // upside. Both are silent no-ops rather than throws so a caller can
            // fire this unconditionally after any approval.
            if (typeof walletId !== 'string' || walletId.length === 0) return;
            if (!creds || typeof creds.password !== 'string' || creds.password.length === 0) return;
            if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;
            entries.set(walletId, {
                password: creds.password,
                expiresAt: now() + ttlMs,
            });
        },

        recall(walletId) {
            if (typeof walletId !== 'string' || walletId.length === 0) return null;
            const entry = entries.get(walletId);
            if (!entry) return null;
            if (now() >= entry.expiresAt) {
                entries.delete(walletId);
                return null;
            }
            return { password: entry.password };
        },

        forget(walletId) {
            if (typeof walletId === 'string') entries.delete(walletId);
        },

        clear() {
            entries.clear();
        },

        get size() {
            return entries.size;
        },
    };
}
