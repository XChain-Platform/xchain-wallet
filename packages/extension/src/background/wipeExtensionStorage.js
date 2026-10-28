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

import { BROADCAST_QUEUE_PRUNED_PREFIX } from '@xchain-wallet/core/shared/utils/wipeWalletStorage.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import { isTrustedExtensionSender } from '../bridge/publicSurface.js';
import { serializeError } from './MessageHost.js';

/** Message type the extension pages send to ask for a wipe. */
export const WIPE_STORAGE_MESSAGE_TYPE = 'wallet.wipeStorage';

/** Key the worker mirrors its diagnostic log to (background/logConsoleStorage.js). */
const LOG_CONSOLE_KEY = 'xchain.logConsole';

/** Upper bound on the pre-wipe step, so a hung seal cannot stall the erase. */
export const BEFORE_WIPE_TIMEOUT_MS = 2000;

/**
 * Run the caller's pre-wipe step, bounded and never throwing.
 *
 * @param {(() => void | Promise<void>) | undefined} beforeWipe
 * @returns {Promise<void>}
 */
async function runBeforeWipe(beforeWipe) {
    if (typeof beforeWipe !== 'function') return;
    let timer;
    try {
        await Promise.race([
            Promise.resolve().then(() => beforeWipe()),
            new Promise((resolve) => { timer = setTimeout(resolve, BEFORE_WIPE_TIMEOUT_MS); }),
        ]);
    } catch (err) {
        console.error('[xchain] pre-wipe step failed:', err);
    } finally {
        clearTimeout(timer);
    }
}

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
    'xchain.governancePolls.seen',  // background.js governance watcher
    'xchain.deadlines.seen',        // background.js deadline watcher
    'xchain.dispenserEscrow.seen',  // background.js dispenser watcher
]);

/**
 * Wallet-owned `chrome.storage.local` key families, one key per walletId, so
 * they cannot be enumerated above and are swept by prefix instead.
 */
export const WALLET_LOCAL_KEY_PREFIXES = Object.freeze([
    BROADCAST_QUEUE_PRUNED_PREFIX,  // background/broadcastQueueStore.js (pruned-wallet ledger)
]);

/**
 * Names of every key in a local area, values unread where the area can list
 * names alone (getKeys, Chrome 130+), falling back to a full read when getKeys
 * is missing or fails. An area that can list neither way has nothing to sweep.
 *
 * @param {{ get?: (keys: null) => Promise<object>, getKeys?: () => Promise<string[]> }} local
 * @returns {Promise<string[]>}
 */
async function localKeyNames(local) {
    if (typeof local.getKeys === 'function') {
        try {
            const keys = await local.getKeys();
            if (Array.isArray(keys)) return keys;
        } catch (_e) {
            // Fall through to the full read below.
        }
    }
    if (typeof local.get !== 'function') return [];
    return Object.keys((await local.get(null)) || {});
}

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
 * @param {{ local?: { remove: (keys: string[]) => Promise<void>, get?: (keys: null) => Promise<object>, getKeys?: () => Promise<string[]> },
 *           session?: { clear: () => Promise<void> } }} [stores]
 *   inject for tests; defaults to the real chrome.storage areas
 * @returns {Promise<{ ok: true, cleared: string[] } | { ok: false, error: string }>}
 */
export async function wipeExtensionStorage(stores = {}) {
    const local = stores.local ?? globalThis.chrome?.storage?.local;
    const session = stores.session ?? globalThis.chrome?.storage?.session;
    const cleared = [];
    const errors = [];

    // The session area goes FIRST. It holds the master key and the cached
    // signing secret, which outlive the vault for the rest of the browser
    // session if they survive it. A refused session clear therefore stops
    // here with the vault intact: a whole wallet behind a plain error, rather
    // than an install that reads as empty while its keys stay readable and
    // nothing prompts a retry.
    //
    // Best-effort by contract but NOT silent: an engine without
    // chrome.storage.session (pre-Chrome-102) never held the key in the first
    // place, while a present-but-failing store is a secret that survived and
    // has to reach the user.
    if (session && typeof session.clear === 'function') {
        try {
            await session.clear();
            cleared.push('chrome.storage.session (all)');
        } catch (err) {
            return { ok: false, cleared, error: err?.message || String(err) };
        }
    }

    // The worker mirrors its in-memory log to `xchain.logConsole` on the
    // next entry, so removing the key alone lets that flush write every
    // pre-wipe line, wallet ids included, straight back. Empty the buffer first.
    try {
        logConsole.clear();
    } catch (_err) {
        // The key removal below still runs.
    }

    // A local-store failure past this point leaves a vault no session can
    // open, which the lock screen meets and offers to reset again.
    try {
        if (!local || typeof local.remove !== 'function') {
            throw new Error('chrome.storage.local is unavailable');
        }
        await local.remove([...WALLET_LOCAL_KEYS]);
        cleared.push(...WALLET_LOCAL_KEYS);
    } catch (err) {
        errors.push(err?.message || String(err));
    }

    // Sweep the per-wallet key families on their own, so a failed listing is
    // reported but never skips the enumerated clear above or the session below.
    if (local && typeof local.remove === 'function') {
        try {
            const names = await localKeyNames(local);
            const swept = names.filter((k) => WALLET_LOCAL_KEY_PREFIXES.some((p) => k.startsWith(p)));
            if (swept.length) await local.remove(swept);
            cleared.push(...swept);
        } catch (err) {
            errors.push(err?.message || String(err));
        }
    }

    if (errors.length) return { ok: false, cleared, error: errors.join('; ') };
    return { ok: true, cleared };
}

/**
 * Empty the in-memory log and remove its persisted copy, best-effort.
 *
 * @param {{ remove?: (keys: string[]) => Promise<void> } | undefined} local
 * @returns {Promise<void>}
 */
async function dropWipedLog(local) {
    try {
        logConsole.clear();
    } catch (_err) {
        // The key removal below still runs.
    }
    try {
        if (local && typeof local.remove === 'function') await local.remove([LOG_CONSOLE_KEY]);
    } catch (_err) {
        // The wipe itself succeeded; a log line left behind is not worth failing it.
    }
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
 * @param {{ beforeWipe?: () => void | Promise<void>,
 *           onWiped?: () => void | Promise<void>,
 *           wipe?: typeof wipeExtensionStorage,
 *           local?: { remove: (keys: string[]) => Promise<void> } }} [deps]
 *   `local` (tests) defaults to chrome.storage.local; after a successful wipe
 *   the log lines the teardown wrote are removed from it.
 *   `beforeWipe` runs BEFORE the clear, bounded by BEFORE_WIPE_TIMEOUT_MS, and
 *   a failure there never stops the wipe; it is where the caller seals writers
 *   that could put wiped data back, since a write already inside set() cannot be
 *   recalled after the key removal. `onWiped` runs AFTER the clear and is where
 *   the caller drops the in-memory host (vault, signer pool, watchers).
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
        // A caller can close its page while the wipe is in flight. Keep a
        // dead response port from turning the listener itself into a rejection.
        const respond = (response) => {
            try { sendResponse(response); } catch (_err) { /* caller is gone */ }
        };
        if (!isTrustedExtensionSender(sender, runtime.id)) {
            respond({
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
            await runBeforeWipe(deps.beforeWipe);
            const result = await wipe();
            // Tear down even on a partial clear: the keys that DID go are
            // gone, so a host still serving the wiped wallet is the worse
            // of the two states.
            try {
                await deps.onWiped?.();
            } catch (err) {
                console.error('[xchain] wipe teardown failed:', err);
            }
            // The teardown logs the signers it locks by wallet id, after the
            // clear. Drop those lines too, so the erased wallet leaves no id behind.
            if (result?.ok === true) await dropWipedLog(deps.local ?? globalThis.chrome?.storage?.local);
            // Report the WIPE's own verdict, not the fact that the handler
            // ran. A hardcoded true made a failed clear read as a successful
            // wipe: core's wipeShellStorage gates on response.ok !== true, so
            // it never threw and the user was told a surviving vault was gone.
            respond({ ok: result?.ok === true, result });
        })().catch((err) => {
            // Preserve the request-response contract if a replacement wipe
            // implementation violates the normal never-throw boundary.
            respond(serializeError(err));
        });
        return true; // async response
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
