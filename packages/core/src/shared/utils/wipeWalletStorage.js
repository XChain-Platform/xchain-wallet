// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

/** Key a renderer-hosted broadcast queue persists under; core owns it so the wipe and the store agree. */
export const BROADCAST_QUEUE_STORAGE_KEY = 'xchain.broadcastQueue';

/** Prefix of the queue's pruned-wallet ledger, one key per walletId; the wipe sweeps the whole range. */
export const BROADCAST_QUEUE_PRUNED_PREFIX = 'xchain.broadcastQueue.pruned.';

/**
 * Nuke every store that answers "a wallet already exists on this
 * device", across all three shells.
 *
 * Two escapes need this and must not drift apart: the Locked screen's
 * "Forgot password" wipe, and the demo exit once it has removed the
 * last wallet. Removing a wallet record alone leaves the vault meta
 * behind, and the meta is what the shell reads to decide "a wallet
 * already exists" - so the next boot shows an unlock screen for a vault
 * with nothing in it.
 *
 * Renderer-side stores (web + extension pages):
 *   - IndexedDB `xchain-wallet` (matches DEFAULT_DB_NAME in
 *     IndexedDBStorageBackend.js): holds the encrypted vault blob.
 *   - localStorage `xchain-wallet:vault-meta` (matches DEFAULT_META_KEY
 *     in WebMetaBackend.js): holds the kdfParams metadata that the
 *     bridge's "a wallet already exists" check reads. Without this
 *     clear, a fresh `wallet.import` call after the IDB wipe still
 *     trips the existence check and the demo flow can't restart.
 *   - localStorage `xchain.broadcastQueue` (BROADCAST_QUEUE_STORAGE_KEY): the
 *     queued signed txs and settlement journal of a web or native-mobile host.
 *   - localStorage `xchain.broadcastQueue.pruned.*`
 *     (BROADCAST_QUEUE_PRUNED_PREFIX): the walletIds of that queue's
 *     pruned-wallet ledger, swept by prefix since a page that never built a
 *     queue store has nothing to seal them.
 *
 * Shell-side stores (desktop, extension, native mobile): the Electron
 * shell keeps its vault blob, kdfParams meta, cached session key and
 * unlock throttle in files under `app.getPath('userData')`, and the
 * extension keeps the same four plus the cached signing secret in
 * `chrome.storage`. No renderer API reaches either, so clearing
 * localStorage + IndexedDB is a silent no-op there and the user lands
 * back on an unlock screen for the vault they just wiped. When a shell
 * publishes a `wipeStorage` hook on the bridge we hand the job to the
 * process that owns those stores.
 *
 * Failure policy differs per store on purpose. The renderer stores are
 * best-effort (we resolve as soon as the delete completes or errors,
 * because every caller reloads afterwards), but a *failed shell wipe
 * rejects*: the reload that follows would otherwise present the same
 * unlock screen with no explanation, which is exactly the bug this
 * function exists to prevent. Both callers render the thrown message.
 *
 * @returns {Promise<void>}
 * @throws {Error} when a shell-owned wipe was attempted and failed
 */
export async function wipeWalletStorage() {
    // Clear the localStorage meta entry first (synchronous, can't fail).
    try {
        globalThis.localStorage?.removeItem('xchain-wallet:vault-meta');
    } catch { /* ignore */ }
    await deleteVaultDatabase();
    await wipeShellStorage();
    // Drop the queue only after the shell wipe succeeds, so a failed wipe keeps a live wallet's signed txs.
    try {
        globalThis.localStorage?.removeItem(BROADCAST_QUEUE_STORAGE_KEY);
    } catch { /* ignore */ }
    sweepLocalStoragePrefix(BROADCAST_QUEUE_PRUNED_PREFIX);
}

/**
 * Remove every localStorage key under `prefix`, best-effort like the other
 * renderer stores. Keys are collected first because removing while indexing
 * shifts `localStorage.key(i)`.
 *
 * @param {string} prefix
 */
function sweepLocalStoragePrefix(prefix) {
    try {
        const store = globalThis.localStorage;
        if (!store) return;
        const keys = [];
        for (let i = 0; i < store.length; i++) {
            const k = store.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
        for (const k of keys) store.removeItem(k);
    } catch { /* ignore */ }
}

/**
 * Best-effort delete of the renderer-side IndexedDB vault database.
 * Resolves on success, error and blocked alike.
 *
 * @returns {Promise<void>}
 */
function deleteVaultDatabase() {
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

/**
 * Ask the host shell to clear the stores only it can reach.
 *
 * Feature-detected rather than shell-branched: core imports nothing
 * from a shell package (CI enforces that), so a shell publishing
 * `xchainWalletBridge.wipeStorage` is the entire contract. Desktop
 * (preload.cjs), the native mobile shell (installNativeWipeHook) and the
 * extension (storage/wipeHook.js) each publish one; plain web keeps
 * everything in the two renderer stores cleared above, so it needs none.
 *
 * The detect is fail-OPEN, and that is how the extension shipped a wipe
 * that erased nothing while telling the user it had: it kept every store
 * in chrome.storage and published no hook, so this returned quietly and
 * the master key plus the cached plaintext password survived. A shell
 * that holds state the renderer cannot reach and publishes no hook is a
 * defect in that shell; the per-shell census in
 * test/smoke/shells/wipe-hook-conformance.smoke.js is what stops the next
 * one from failing open the same way.
 *
 * @returns {Promise<void>}
 */
async function wipeShellStorage() {
    const bridge = /** @type {any} */ (globalThis).xchainWalletBridge;
    if (!bridge || typeof bridge.wipeStorage !== 'function') return;
    let response;
    try {
        response = await bridge.wipeStorage();
    } catch (err) {
        throw new Error(
            `Could not clear the wallet data this app stores on your computer: ${err?.message || err}`,
        );
    }
    if (!response || response.ok !== true) {
        throw new Error(
            `Could not clear the wallet data this app stores on your computer: ${response?.error || 'the app did not say why'}`,
        );
    }
}
