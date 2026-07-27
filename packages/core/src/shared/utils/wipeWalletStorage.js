// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/**
 * Nuke the wallet's IndexedDB database AND its localStorage meta entry.
 *
 * Two escapes need this and must not drift apart: the Locked screen's
 * "Forgot password" wipe, and the demo exit once it has removed the
 * last wallet. Removing a wallet record alone leaves the vault meta
 * behind, and the meta is what the shell reads to decide "a wallet
 * already exists" - so the next boot shows an unlock screen for a vault
 * with nothing in it.
 *
 * Two stores to clear:
 *   - IndexedDB `xchain-wallet` (matches DEFAULT_DB_NAME in
 *     IndexedDBStorageBackend.js): holds the encrypted vault blob.
 *   - localStorage `xchain-wallet:vault-meta` (matches DEFAULT_META_KEY
 *     in WebMetaBackend.js): holds the kdfParams metadata that the
 *     bridge's "a wallet already exists" check reads. Without this
 *     clear, a fresh `wallet.import` call after the IDB wipe still
 *     trips the existence check and the demo flow can't restart.
 *
 * Best-effort: we resolve as soon as the delete completes (or errors)
 * because every caller reloads the page afterwards.
 *
 * @returns {Promise<void>}
 */
export function wipeWalletStorage() {
    // Clear the localStorage meta entry first (synchronous, can't fail).
    try {
        globalThis.localStorage?.removeItem('xchain-wallet:vault-meta');
    } catch { /* ignore */ }
    return new Promise((resolve) => {
        try {
            const idb = typeof globalThis !== 'undefined' ? globalThis.indexedDB : null;
            if (!idb || typeof idb.deleteDatabase !== 'function') {
                resolve();
                return;
            }
            const req = idb.deleteDatabase('xchain-wallet');
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        } catch {
            resolve();
        }
    });
}
