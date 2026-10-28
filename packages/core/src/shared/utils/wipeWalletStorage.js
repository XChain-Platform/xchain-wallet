// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { clearLockoutState } from '../../flows/lockoutTracking.js';
import { clearDuressPassphrase } from '../../flows/duressPassphrase.js';
import { clearPanicModeState } from '../../flows/panicMode.js';
import { clearBackupReminderState } from '../../flows/backupReminder.js';
import { clearMigrationSweeps } from '../../flows/migrationSweeps.js';
import { clearBalanceCache } from './balanceCache.js';
import { HISTORY_CACHE_PREFIX } from './historyCache.js';

/** Key of the localStorage record that answers "a wallet already exists"; the wipe removes it first. */
export const VAULT_META_STORAGE_KEY = 'xchain-wallet:vault-meta';

/** Key a renderer-hosted broadcast queue persists under; core owns it so the wipe and the store agree. */
export const BROADCAST_QUEUE_STORAGE_KEY = 'xchain.broadcastQueue';

/** Prefix of the queue's pruned-wallet ledger, one key per walletId; the wipe sweeps the whole range. */
export const BROADCAST_QUEUE_PRUNED_PREFIX = 'xchain.broadcastQueue.pruned.';

/** Renderer records that belong to the erased vault rather than to the app installation. */
const WALLET_LOCAL_STORAGE_KEYS = Object.freeze([
    'xchain-wallet:biometric',
    'xc:activeWallet',
    'xc:backupVerifiedAt',
    'xc:backupReminderFundedAt',
    'xc:backupReminderDismissedUntil',
    'xc:demoWalletId',
    'xc:demoWalletCreatedAt',
    'xc:demoWalletTtlMs',
    'xc:demoWalletPassword',
    'xc:envelopeCommits',
    'xchain.governancePolls.seen',
    'xchain.deadlines.seen',
    'xchain.dispenserEscrow.seen',
    // The diagnostic console log names the wallet ids it unlocked and locked.
    'xchain.logConsole',
]);

/** Renderer key families scoped to a wallet or one of its accounts. */
const WALLET_LOCAL_STORAGE_PREFIXES = Object.freeze([
    'xc:activeAccount:',
    'xc:lastView:',
    'xc:msgRead:',
    'xc:msgUnread:',
    'xc:msgRequestDeclined:',
    'xc:formdraft:',
    'xc:chainFilter:',
    'xc:contacts:sort:',
    'xc:historyGroupingMode:',
    'xc:alertCenter:',
    'xc:balanceCache:',
    'xc:balances:sort:',
    HISTORY_CACHE_PREFIX,
    'xc:homeFilters:',
]);

/** Tab-session key family holding each History screen's filters and search, keyed by wallet and account. */
const HISTORY_VIEW_STATE_PREFIX = 'xc:historyViewState:';

/** Key families whose wallet id is the final colon-delimited component. */
const WALLET_SUFFIX_STORAGE_PREFIXES = Object.freeze([
    'xc:chainFilter:',
    'xc:contacts:sort:',
    'xc:formdraft:',
    'xc:historyGroupingMode:',
]);

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
 *   - localStorage `xchain-wallet:lockout` (LOCKOUT_STORAGE_KEY in
 *     flows/lockoutTracking.js, or the injected guard slot on native): the
 *     Locked screen's failed-unlock ladder. An inherited ladder would punish
 *     the next wallet's user for the old one's typos, the same reason the
 *     shells clear their own unlock throttle. It goes only after the shell
 *     wipe succeeds, so a failed wipe keeps the throttle on a surviving vault.
 *   - localStorage `xchain-wallet:panic` and `xchain-wallet:duress` (or their
 *     injected stores): the signing freeze and the configured duress password.
 *     Both belong to the erased wallet, so a successful wipe removes them and
 *     a failed shell wipe keeps them guarding the wallet that survived.
 *   - localStorage `xchain.logConsole`: the diagnostic log, whose entries carry wallet ids.
 *   - localStorage wallet-scoped UI records: biometric enrollment, active
 *     wallet/account ids, backup state, demo credentials, pending envelope
 *     recovery, route memory, messaging state, drafts and list preferences.
 *     These records must not outlive the wallet ids or secrets they describe.
 *
 * Shell-side stores (desktop, extension, native mobile): the Electron
 * shell keeps its vault blob, kdfParams meta, cached session key, unlock
 * throttle and auto-lock record in files under `app.getPath('userData')`
 * (the `targets` of `wipeRuntimeStores` in packages/desktop/main/runtime.js
 * are the full list), and the extension keeps those and more in
 * `chrome.storage` (`WALLET_LOCAL_KEYS` and the session-area clear in
 * packages/extension/src/background/wipeExtensionStorage.js). No renderer
 * API reaches either, so clearing localStorage + IndexedDB is a silent
 * no-op there and the user lands
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
        globalThis.localStorage?.removeItem(VAULT_META_STORAGE_KEY);
    } catch { /* ignore */ }
    await deleteVaultDatabase();
    await wipeShellStorage();
    // Drop the queue only after the shell wipe succeeds, so a failed wipe keeps a live wallet's signed txs.
    try {
        globalThis.localStorage?.removeItem(BROADCAST_QUEUE_STORAGE_KEY);
    } catch { /* ignore */ }
    removeLocalStorageKeys(WALLET_LOCAL_STORAGE_KEYS);
    sweepLocalStoragePrefix(BROADCAST_QUEUE_PRUNED_PREFIX);
    for (const prefix of WALLET_LOCAL_STORAGE_PREFIXES) sweepLocalStoragePrefix(prefix);
    sweepStoragePrefix(globalThis.sessionStorage, HISTORY_VIEW_STATE_PREFIX);
    // The guards belong to this wallet. A failed wipe leaves the vault they still guard.
    clearLockoutState();
    clearPanicModeState();
    clearDuressPassphrase();
    clearBackupReminderState();
    clearMigrationSweeps();
}

/**
 * Call `onWipe` when another tab of this origin wipes the wallet. The wipe
 * removes the vault meta record, which fires a storage event with no new value
 * in every other tab; those tabs still hold an unlocked session and keep
 * writing wallet-scoped records for a vault that no longer exists. The event
 * does not fire in the tab that made the change.
 *
 * @param {() => void} onWipe
 * @returns {() => void} unsubscribe
 */
export function subscribeVaultWipe(onWipe) {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    const onStorage = (event) => {
        if (event?.key !== VAULT_META_STORAGE_KEY || event.newValue !== null) return;
        onWipe();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
}

/**
 * Remove device-local records owned by one wallet while preserving every
 * other wallet and installation-wide preference.
 *
 * @param {string} walletId
 */
export function clearRemovedWalletStorage(walletId) {
    if (typeof walletId !== 'string' || walletId.length === 0) return;
    clearBalanceCache(walletId);
    clearBackupReminderState(walletId);
    // A migration list names the legacy wallet and its sweep destination;
    // either one leaving makes the list meaningless.
    clearMigrationSweeps(walletId);
    try {
        const store = globalThis.localStorage;
        if (!store) return;
        const encodedId = encodeURIComponent(walletId);
        const exactKeys = new Set([
            `xc:activeAccount:${walletId}`,
            `xc:alertCenter:${walletId}`,
            `xc:balances:sort:${walletId}`,
            `xc:contacts:sort:${walletId}`,
            `xc:historyGroupingMode:${walletId}`,
            `xc:homeFilters:${walletId}`,
            `xc:lastView:${walletId}`,
        ]);
        const walletPrefixes = [
            `xc:balanceCache:${encodedId}:`,
            `${HISTORY_CACHE_PREFIX}${encodedId}:`,
            `xc:msgRead:${walletId}:`,
            `xc:msgUnread:${walletId}:`,
            `xc:msgRequestDeclined:${walletId}:`,
        ];
        const suffix = `:${walletId}`;
        const keys = [];
        for (let i = 0; i < store.length; i++) {
            const key = store.key(i);
            if (!key) continue;
            if (exactKeys.has(key)
                || walletPrefixes.some((prefix) => key.startsWith(prefix))
                || (key.endsWith(suffix)
                    && WALLET_SUFFIX_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix)))) {
                keys.push(key);
            }
        }
        for (const key of keys) store.removeItem(key);
        sweepStoragePrefix(globalThis.sessionStorage, `${HISTORY_VIEW_STATE_PREFIX}${walletId}:`);
        if (activeWalletId(store.getItem('xc:activeWallet')) === walletId) {
            store.removeItem('xc:activeWallet');
        }
    } catch { /* best-effort cleanup */ }
}

function activeWalletId(raw) {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'string' ? parsed : parsed?.id || null;
    } catch {
        return raw;
    }
}

/**
 * Remove a fixed set of localStorage keys without making wipe success depend
 * on a renderer preference store being available.
 *
 * @param {readonly string[]} keys
 */
function removeLocalStorageKeys(keys) {
    try {
        const store = globalThis.localStorage;
        if (!store) return;
        for (const key of keys) store.removeItem(key);
    } catch { /* ignore */ }
}

/**
 * Remove every localStorage key under `prefix`, best-effort like the other
 * renderer stores. Keys are collected first because removing while indexing
 * shifts `localStorage.key(i)`.
 *
 * @param {string} prefix
 */
function sweepLocalStoragePrefix(prefix) {
    sweepStoragePrefix(globalThis.localStorage, prefix);
}

/**
 * Same sweep over any Storage, best-effort.
 *
 * @param {Storage | undefined} store
 * @param {string} prefix
 */
function sweepStoragePrefix(store, prefix) {
    try {
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
