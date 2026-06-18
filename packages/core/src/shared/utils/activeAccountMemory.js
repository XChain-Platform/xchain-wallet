// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Per-wallet active-account memory. Persists the user's last selected
// account id per wallet to localStorage so a reload / popup reopen /
// desktop restart returns to the account they were using instead of
// snapping back to the lowest-index account every time. Twin of
// lastViewMemory.
//
// Why localStorage instead of vault settings: this is an ephemeral
// per-device UI preference that should not survive a from-seed restore
// onto a fresh device. The caller validates the stored id against the
// wallet's live account list before honoring it, so a stale id (account
// removed, different device) safely falls back to the default.

const NS = 'xc:activeAccount:';

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

function safeRemove(key) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(NS + key);
    } catch { /* noop */ }
}

/**
 * Read the saved active-account id for a wallet. Returns null when no
 * value is stored or the wallet id is missing. The caller must still
 * check the id exists in the wallet's current account list.
 *
 * @param {string | null | undefined} walletId
 * @returns {string | null}
 */
export function readActiveAccount(walletId) {
    if (typeof walletId !== 'string' || !walletId) return null;
    const v = safeGet(walletId);
    return typeof v === 'string' && v ? v : null;
}

/**
 * Persist the active-account id for a wallet.
 *
 * @param {string | null | undefined} walletId
 * @param {string | null | undefined} accountId
 */
export function writeActiveAccount(walletId, accountId) {
    if (typeof walletId !== 'string' || !walletId) return;
    if (typeof accountId !== 'string' || !accountId) return;
    safeSet(walletId, accountId);
}

/**
 * Drop the saved active-account id for a wallet (e.g., on remove-wallet).
 *
 * @param {string | null | undefined} walletId
 */
export function clearActiveAccount(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    safeRemove(walletId);
}
