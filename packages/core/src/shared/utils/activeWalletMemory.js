// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Active-WALLET memory. The twin of activeAccountMemory, which already does
// exactly this one level down (which account inside a wallet), and of
// lastViewMemory.
//
// WHY IT EXISTS. Without it a page reload snapped the app back to the FIRST
// wallet: `activeWalletId` was plain component state, and the post-unlock load
// set it to `list[0].id` unconditionally. Since a reload always re-locks (the
// password is never persisted), that fired on every refresh, popup reopen and
// desktop restart. The user sees only a wallet name change in the nav, and
// anything composed afterwards - a send, a receive address, a mint - is signed
// by the wrong wallet. It was found on a regtest run where a mint intended for
// the second wallet was composed from the first, leaving one wallet with double
// the balance and the other with none.
//
// Same storage choice and the same caveat as activeAccountMemory: localStorage,
// because this is an ephemeral per-device UI preference that should not survive
// a from-seed restore onto a fresh device, and the caller MUST validate the
// stored id against the live wallet list before honoring it so a stale id
// (wallet removed, different device) falls back to the default.

const KEY = 'xc:activeWallet';

function safeGet() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(KEY);
    } catch { return null; }
}

/**
 * Read the saved active-wallet id, or null when none is stored. The caller
 * must still check the id exists in the current wallet list.
 *
 * @returns {string | null}
 */
export function readActiveWallet() {
    const v = safeGet();
    return typeof v === 'string' && v ? v : null;
}

/**
 * Persist the active-wallet id.
 *
 * @param {string | null | undefined} walletId
 */
export function writeActiveWallet(walletId) {
    if (typeof walletId !== 'string' || !walletId) return;
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(KEY, walletId);
    } catch { /* noop */ }
}

/** Drop the saved active-wallet id (e.g. on remove-wallet). */
export function clearActiveWallet() {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.removeItem(KEY);
    } catch { /* noop */ }
}
