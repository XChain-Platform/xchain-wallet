// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The dispenser address the create form derived for a preview that was never
// signed, kept for the rest of this app session so the next preview reuses it.
//
// Each derivation adds a "Dispenser #n" record to the wallet, so without this
// every reopened form that was previewed and rejected left one more unused
// address behind. Memory only: nothing is written to the vault, and a reload
// simply derives again.

/** walletId|accountId|chainId -> the derived address record. */
const unused = new Map();

function keyOf({ walletId, accountId, chainId }) {
    return [walletId || '', accountId || '', chainId || ''].join('|');
}

/**
 * Remember an address derived for a preview that has not been signed yet.
 *
 * @param {{ walletId?: string, accountId?: string, chainId?: string }} scope
 * @param {{ address?: string } | null | undefined} record
 */
export function rememberUnusedDispenserAddress(scope, record) {
    if (record && typeof record.address === 'string' && record.address) unused.set(keyOf(scope), record);
}

/**
 * The remembered address for this scope, but only while the wallet still holds
 * a record for it: a deleted record's index can be derived again for another
 * purpose, so reusing it would open a dispenser on an address nothing tracks.
 *
 * @param {{ walletId?: string, accountId?: string, chainId?: string }} scope
 * @param {Array<{ address?: string }>} walletAddresses   the wallet's addresses on scope.chainId
 * @returns {any | null}
 */
export function recallUnusedDispenserAddress(scope, walletAddresses) {
    const record = unused.get(keyOf(scope));
    if (!record) return null;
    const held = (walletAddresses || []).some((a) => a && a.address === record.address);
    return held ? record : null;
}

/**
 * Forget the remembered address once an action that opens a dispenser on it has
 * been signed, since from then on it is no longer unused.
 *
 * @param {{ walletId?: string, accountId?: string, chainId?: string }} scope
 * @param {string | undefined} usedAddress   the GET_ADDRESS that was signed
 */
export function forgetUnusedDispenserAddress(scope, usedAddress) {
    const key = keyOf(scope);
    if (usedAddress && unused.get(key)?.address === usedAddress) unused.delete(key);
}

/** Drop every remembered address (test isolation). */
export function clearUnusedDispenserAddresses() {
    unused.clear();
}
