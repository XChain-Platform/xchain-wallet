// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Extension-side "wipe wallet data", the store core cannot reach.
//
// Core's `wipeWalletStorage()` clears localStorage + IndexedDB and then
// hands off to `globalThis.xchainWalletBridge.wipeStorage()` for whatever
// only the shell can reach. The extension keeps NONE of its state in those
// two renderer stores: the encrypted vault, the kdfParams meta, the session
// master key, the cached signing secret (the plaintext password) and the
// unlock throttle all live in `chrome.storage`. Without this handler the
// six wipe escapes (Locked "Forgot password", the Locked demo-exit
// fallback, VaultUnavailable's corrupt-vault WIPE, and exitDemoWallet from
// Onboarding / WalletDetails / DemoBanner) all reported success while
// deleting nothing, and the master key plus plaintext password stayed
// readable for the rest of the browser session.
//
// Runs in the SERVICE WORKER, not the popup: the popup can reach
// chrome.storage but not the worker's in-memory vault, signer pool and
// watchers, so a popup-side key delete would leave the unlocked wallet
// alive behind a screen claiming it was erased. Clearing storage without
// teardown is not a wipe.

import { isTrustedExtensionSender } from '../bridge/publicSurface.js';

/** Message type the extension pages send to ask for a wipe. */
export const WIPE_STORAGE_MESSAGE_TYPE = 'wallet.wipeStorage';

/**
 * Wallet-owned `chrome.storage.local` keys. Enumerated from the modules
 * that own them rather than guessed, so a key added later is a one-line
 * edit here and the conformance smoke names the file it lives in.
 *
 * `xchain.layoutMode` is deliberately absent: it is a cosmetic window
 * preference (popup vs side panel), carries nothing about the wallet, and
 * resetting someone's window layout is not part of erasing a wallet.
 */
export const WALLET_LOCAL_KEYS = Object.freeze([
    'xchain-wallet:vault',          // storage/ChromeStorageBackend.js
    'xchain-wallet:vault-meta',     // storage/ChromeMetaBackend.js (kdfParams)
    'xchain:unlockThrottle',        // background/unlockThrottle.js
    'xchain:autolock',              // background/autoLockState.js
    'xchain.panicMode',             // background/panicModeStorage.js
    'xchain.signThrottle',          // background/signThrottleStorage.js
    'xchain.broadcastQueue',        // background/broadcastQueueStorage.js
    'xchain.logConsole',            // background/logConsoleStorage.js
]);

/**
 * Erase every extension-owned store the wallet writes.
 *
 * `chrome.storage.session` is cleared WHOLESALE on purpose: it holds the
 * master key, the cached password, pending confirm-action requests and the
 * connected-tab set, and nothing in it should outlive a wipe. The local
 * store is cleared by key instead, because it is shared with whatever
 * Chrome and other wallet-unrelated preferences put there.
 *
 * Never throws past this boundary: the caller is a message handler, and
 * core renders the returned `error` to the user.
 *
 * @param {{ local?: { remove: (keys: string[]) => Promise<void> },
 *           session?: { clear: () => Promise<void> } }} [stores]
 *   inject for tests; defaults to the real chrome.storage areas
 * @returns {Promise<{ ok: true, cleared: string[] } | { ok: false, error: string }>}
 */
export async function wipeExtensionStorage(stores = {}) {
    const local = stores.local ?? globalThis.chrome?.storage?.local;
    const session = stores.session ?? globalThis.chrome?.storage?.session;
    const cleared = [];
    const errors = [];

    // Each store is attempted independently. They hold DIFFERENT secrets, so
    // a local-store failure must not skip the session clear: doing so left
    // the session key resident while the caller was told the wipe succeeded.
    try {
        if (!local || typeof local.remove !== 'function') {
            throw new Error('chrome.storage.local is unavailable');
        }
        await local.remove([...WALLET_LOCAL_KEYS]);
        cleared.push(...WALLET_LOCAL_KEYS);
    } catch (err) {
        errors.push(err?.message || String(err));
    }

    // Best-effort by contract but NOT silent: an engine without
    // chrome.storage.session (pre-Chrome-102) never held the key in the first
    // place, while a present-but-failing store is a secret that survived and
    // has to reach the user.
    if (session && typeof session.clear === 'function') {
        try {
            await session.clear();
            cleared.push('chrome.storage.session (all)');
        } catch (err) {
            errors.push(err?.message || String(err));
        }
    }

    if (errors.length) return { ok: false, cleared, error: errors.join('; ') };
    return { ok: true, cleared };
}

/**
 * Attach the service-worker listener that answers `wallet.wipeStorage`.
 *
 * Kept off `sessionMeta.PRE_HOST_MESSAGE_TYPES` deliberately: that set and
 * its dispatcher are shared with the desktop shell (main/runtime.js imports
 * both), and desktop already wipes over its own `xchain:wipe-storage` IPC
 * channel. A chrome-only handler does not belong in the shell-agnostic
 * dispatcher.
 *
 * Sender-gated like every other UI-only type: a web page reaching the
 * content-script relay must never be able to erase a wallet.
 *
 * @param {{ onWiped?: () => void | Promise<void>,
 *           wipe?: typeof wipeExtensionStorage }} [deps]
 *   `onWiped` runs AFTER a successful clear and is where the caller drops
 *   the in-memory host (vault, signer pool, watchers).
 * @param {{ id?: string, onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void} detach fn
 */
export function attachWipeStorageListener(deps = {}, chromeRuntime) {
    const runtime = chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) return () => {};
    const wipe = deps.wipe ?? wipeExtensionStorage;

    const listener = (message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        if (message.type !== WIPE_STORAGE_MESSAGE_TYPE) return false;
        if (!isTrustedExtensionSender(sender, runtime.id)) {
            sendResponse({
                ok: false,
                error: {
                    name: 'BridgeError',
                    code: 'FORBIDDEN_SENDER',
                    message: 'this message type is not available to web origins',
                },
            });
            return true;
        }
        (async () => {
            const result = await wipe();
            // Tear down even on a partial clear: the keys that DID go are
            // gone, so a host still serving the wiped wallet is the worse
            // of the two states.
            try {
                await deps.onWiped?.();
            } catch (err) {
                console.error('[xchain] wipe teardown failed:', err);
            }
            // Report the WIPE's own verdict, not the fact that the handler
            // ran. A hardcoded true made a failed clear read as a successful
            // wipe: core's wipeShellStorage gates on response.ok !== true, so
            // it never threw and the user was told a surviving vault was gone.
            sendResponse({ ok: result?.ok === true, result });
        })();
        return true; // async response
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
