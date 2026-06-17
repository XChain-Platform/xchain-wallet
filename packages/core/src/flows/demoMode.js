// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §25.2 / G058 + G059 — Demo mode bookkeeping. Tracks the "this wallet
// is the throwaway demo" flag in localStorage so the shell can render a
// persistent banner and offer a one-tap "Exit demo + wipe" affordance.
//
// The demo wallet itself is created via the regular `messaging.createWallet`
// path with a randomly-generated mnemonic + password (kept in the
// session-password cache). Marking it as demo here is just metadata —
// no schema bump, no host-handler changes. When the user exits demo
// mode the shell calls the existing `wallet.remove` flow and then
// `clearDemoWalletId()`.
//
// Cluster J FOLLOWUP 6 — auto-expire. `markDemoWallet` records the
// walletId AND a creation timestamp. `getDemoWalletExpiry` returns the
// epoch-ms past which the demo wallet should be auto-wiped (default
// 24 hours from creation; overridable via `markDemoWallet(walletId, ttl)`).
// `isDemoWalletExpired()` short-circuits the banner / shell into
// triggering an exit + wipe.

const STORAGE_KEY = 'xc:demoWalletId';
const TIMESTAMP_KEY = 'xc:demoWalletCreatedAt';
const TTL_KEY = 'xc:demoWalletTtlMs';
const PASSWORD_KEY = 'xc:demoWalletPassword';
export const DEMO_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} walletId
 * @param {object} [opts]
 * @param {number} [opts.ttlMs]      Override the default 24-hour expiry.
 * @param {number} [opts.now]        Clock injection for tests.
 * @param {string} [opts.password]   The demo wallet's auto-generated password. Persisted
 *                                    (only for demo wallets) so the shell can silently
 *                                    re-unlock after a reload instead of stranding the user
 *                                    on the password screen with a key they never typed. The
 *                                    demo wallet is throwaway and holds only zero-balance
 *                                    synthetic data, so persisting it is an acceptable
 *                                    trade-off; it is cleared on demo exit / wipe.
 */
export function markDemoWallet(walletId, opts = {}) {
    if (typeof walletId !== 'string' || !walletId) return;
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0
        ? Math.floor(opts.ttlMs)
        : DEMO_DEFAULT_TTL_MS;
    try {
        globalThis.localStorage?.setItem(STORAGE_KEY, walletId);
        globalThis.localStorage?.setItem(TIMESTAMP_KEY, String(now));
        globalThis.localStorage?.setItem(TTL_KEY, String(ttlMs));
        if (typeof opts.password === 'string' && opts.password) {
            globalThis.localStorage?.setItem(PASSWORD_KEY, opts.password);
        }
    } catch { /* best-effort */ }
}

/**
 * The persisted demo-wallet password, or null. Only ever populated for a
 * demo wallet (see {@link markDemoWallet}); real wallets never store a
 * password. Used by the Locked screen to auto-unlock a demo wallet.
 *
 * @returns {string | null}
 */
export function getDemoWalletPassword() {
    try {
        const v = globalThis.localStorage?.getItem(PASSWORD_KEY);
        return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

/** @returns {string | null} */
export function getDemoWalletId() {
    try {
        const v = globalThis.localStorage?.getItem(STORAGE_KEY);
        return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

/**
 * @returns {{ createdAt: number, ttlMs: number, expiresAt: number } | null}
 */
export function getDemoWalletExpiry() {
    try {
        const tsRaw = globalThis.localStorage?.getItem(TIMESTAMP_KEY);
        const ttlRaw = globalThis.localStorage?.getItem(TTL_KEY);
        if (!tsRaw || !ttlRaw) return null;
        const createdAt = Number(tsRaw);
        const ttlMs = Number(ttlRaw);
        if (!Number.isFinite(createdAt) || !Number.isFinite(ttlMs) || ttlMs <= 0) return null;
        return { createdAt, ttlMs, expiresAt: createdAt + ttlMs };
    } catch {
        return null;
    }
}

/**
 * Cluster J FOLLOWUP 6 — true when the demo wallet exists AND its TTL
 * has elapsed. Used by the shell to trigger an auto-exit on the next
 * mount of the demo banner / wallet picker.
 *
 * @param {object} [opts]
 * @param {number} [opts.now]  Clock injection for tests.
 * @returns {boolean}
 */
export function isDemoWalletExpired(opts = {}) {
    if (!getDemoWalletId()) return false;
    const expiry = getDemoWalletExpiry();
    if (!expiry) return false;
    const now = typeof opts.now === 'number' ? opts.now : Date.now();
    return now >= expiry.expiresAt;
}

export function clearDemoWalletId() {
    try {
        globalThis.localStorage?.removeItem(STORAGE_KEY);
        globalThis.localStorage?.removeItem(TIMESTAMP_KEY);
        globalThis.localStorage?.removeItem(TTL_KEY);
        globalThis.localStorage?.removeItem(PASSWORD_KEY);
    } catch { /* best-effort */ }
}

/**
 * @param {string} walletId
 * @returns {boolean}
 */
export function isDemoWallet(walletId) {
    return typeof walletId === 'string' && walletId.length > 0
        && getDemoWalletId() === walletId;
}
