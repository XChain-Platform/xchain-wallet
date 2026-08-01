// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One place that answers "which stores does this device use" ( S2).
//
// hostBridge constructs a storage backend and a meta backend at seven call
// sites (create, import, unlock, session-status, …). Before this file each
// site said `new IndexedDBStorageBackend()` directly, which was fine while
// there was one answer. There are two now, and the failure mode of getting it
// wrong is not a broken build: it is a wallet that CREATES into the native
// vault and then LOOKS for it in IndexedDB, reports "no wallet", and offers
// to make a new one over the top. So the choice is made once, here, and the
// call sites ask.
//
// The decision is per-device and cannot change under a running app: either
// the native plugin is there or it is not. It is cached for that reason - and
// so that a plugin that starts failing mid-session surfaces as a vault error
// on the operation that failed, rather than as a silent fallback to an empty
// IndexedDB that would look exactly like a wiped wallet.

import { IndexedDBStorageBackend } from './IndexedDBStorageBackend.js';
import { WebMetaBackend } from './WebMetaBackend.js';
import { CapacitorStorageBackend, CapacitorMetaBackend } from './CapacitorStorageBackend.js';
import { installScreenGuard } from '@xchain-wallet/core/shared/utils/screenGuard.js';
import {
    BROKEN_SHELL_MESSAGE,
    callNativeVault,
    hasNativeVault,
    nativeShellIsBroken,
} from './nativeVault.js';
import { storage as coreStorage } from '@xchain-wallet/core';

const { VaultUnavailableError } = coreStorage;

/** @type {boolean | null} */
let nativeCache = null;

/**
 * @returns {boolean}
 * @throws {VaultUnavailableError} on a native shell whose plugin never
 *   registered - a broken build, not a browser .
 *
 * The throw is the point. Every other answer this function could give on that
 * device is a downgrade to WebView storage, and the wallet would work
 * perfectly until the OS reclaimed it or the user tapped "Clear data", with no
 * second copy anywhere by design. main.jsx catches this state before React
 * mounts and shows a blocking screen; this throw is the backstop for any call
 * site that boots some other way.
 */
export function usingNativeVault() {
    if (nativeCache === null) {
        if (nativeShellIsBroken()) throw new VaultUnavailableError(BROKEN_SHELL_MESSAGE);
        nativeCache = hasNativeVault();
    }
    return nativeCache;
}

/** Test seam: forget the cached platform decision. */
export function __resetBackendCacheForTests() {
    nativeCache = null;
}

/**
 * The encrypted-blob store for this device.
 * @returns {import('@xchain-wallet/core').storage.StorageBackend}
 */
export function createStorageBackend() {
    return usingNativeVault()
        ? new CapacitorStorageBackend()
        : new IndexedDBStorageBackend();
}

/**
 * The kdfParams store for this device. Same instance shape either way:
 * `{ load, save, clear }` over a JSON-able record.
 */
export function createMetaBackend() {
    return usingNativeVault()
        ? new CapacitorMetaBackend()
        : new WebMetaBackend();
}

/** Human-readable, for diagnostics and the smoke. */
export function storageBackendName() {
    return usingNativeVault() ? 'native-vault' : 'indexeddb';
}

/**
 * Give core's screen guard something to actually do ( §1, S4).
 *
 * Core decides WHICH screens are protected - seed display, key export,
 * mnemonic entry, unlock - and knows nothing about how. This connects that
 * policy to Android's FLAG_SECURE. In a browser it is never installed, which
 * is the honest answer: a tab cannot stop a screenshot, and a wallet that
 * implied otherwise would be lying on the one screen where it matters most.
 *
 * @returns {boolean} whether the guard was installed
 */
export function installNativeScreenGuard() {
    if (!usingNativeVault()) return false;
    installScreenGuard((protectedNow) => {
        // Fire-and-forget: this runs inside a React effect and its cleanup,
        // and a rejected promise there would surface as an unhandled
        // rejection in the middle of someone's backup flow.
        Promise.resolve(callNativeVault('setScreenProtected', { protected: protectedNow }))
            .catch(() => { /* an older shell build without the method */ });
    });
    return true;
}

/**
 * Publish the shell wipe hook core already knows how to call.
 *
 * `wipeWalletStorage()` (core/shared/utils) clears IndexedDB + localStorage
 * itself and then hands off to `globalThis.xchainWalletBridge.wipeStorage()`
 * for stores no renderer API can reach - the contract the Electron preload
 * fulfils. On a native mobile shell the vault is exactly such a store, so
 * without this hook "Forgot password" would clear two WebView stores the
 * wallet no longer uses, report success, and reload straight back into the
 * unlock screen for the vault it just promised to erase. Core's failure
 * policy does the rest: a shell wipe that fails REJECTS and the user is told.
 *
 * Idempotent, and it never displaces a hook another shell installed.
 */
export function installNativeWipeHook() {
    if (!usingNativeVault()) return false;
    const g = /** @type {any} */ (globalThis);
    if (g.xchainWalletBridge?.wipeStorage) return true;
    g.xchainWalletBridge = {
        ...(g.xchainWalletBridge || {}),
        wipeStorage: async () => {
            try {
                await callNativeVault('clearVault');
                await callNativeVault('clearMeta');
                await callNativeVault('biometricClear');
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err?.message || String(err) };
            }
        },
    };
    return true;
}
