// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Page-side half of the extension wipe: publish the shell hook core calls.
//
// `wipeWalletStorage()` (core/shared/utils) clears IndexedDB + localStorage
// itself, then hands off to `globalThis.xchainWalletBridge.wipeStorage()`
// for the stores no renderer API can reach - the contract the Electron
// preload and the native mobile shell already fulfil. The extension keeps
// every one of its stores in `chrome.storage`, so without this hook the six
// wipe escapes cleared two stores the extension does not use, reported
// success, and reloaded into the unlock screen for the vault they had just
// promised to erase, with the master key and the plaintext password still
// in `chrome.storage.session`.
//
// Argument-free by contract, matching desktop's un-aimable `wipeStorage()`
// (pinned by test/integration/shells/desktop-preload-contract.test.js): the
// page says "wipe", the service worker decides what that means.

import { sendMessage } from '../shared/chromeMessaging.js';
import { WIPE_STORAGE_MESSAGE_TYPE } from '../background/wipeExtensionStorage.js';

/**
 * Install the wipe hook on the extension bridge. Idempotent, and it never
 * displaces a hook another shell installed.
 *
 * Called from every extension page entry that can render core's `Locked`,
 * `VaultUnavailable` or demo-exit surfaces.
 *
 * @param {{ send?: (type: string, request?: unknown) => Promise<unknown> }} [deps]
 *   inject for tests; defaults to the shared chrome.runtime wrapper
 * @returns {boolean} true once a hook is published
 */
export function installExtensionWipeHook(deps = {}) {
    const g = /** @type {any} */ (globalThis);
    if (g.xchainWalletBridge?.wipeStorage) return true;
    const send = deps.send ?? sendMessage;
    g.xchainWalletBridge = {
        ...(g.xchainWalletBridge || {}),
        wipeStorage: async () => {
            try {
                const result = await send(WIPE_STORAGE_MESSAGE_TYPE);
                if (!result || result.ok !== true) {
                    return { ok: false, error: result?.error || 'the extension did not say why' };
                }
                return { ok: true };
            } catch (err) {
                return { ok: false, error: err?.message || String(err) };
            }
        },
    };
    return true;
}
