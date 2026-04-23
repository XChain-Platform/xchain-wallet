// Pre-host message dispatcher — answers a small set of types that
// must work BEFORE the MessageHost's vault-backed handlers come online:
//
//   - `session.status`  What state is the wallet in? (no-wallet / locked / unlocked)
//   - `wallet.unlock`   Derive master key from password, open vault, seed session.
//
// Anything outside `PRE_HOST_MESSAGE_TYPES` falls through to the host
// listener. `ChromeRuntimeAdapter` imports that set to know which types
// it should not handle, keeping the two listeners disjoint (no double
// `sendResponse` on the same message).

import {
    ChromeMetaBackend,
    ChromeSessionBackend,
    ChromeStorageBackend,
} from '../storage/index.js';
import { handleWalletUnlock } from './walletUnlock.js';
import { handleWalletLock } from './walletLock.js';

/**
 * @typedef {Object} PreHostDeps
 * @property {() => Promise<void> | void} [onUnlocked]
 * @property {() => Promise<void> | void} [onLocked]
 */

/** Types the pre-host listener owns. `ChromeRuntimeAdapter` ignores these. */
export const PRE_HOST_MESSAGE_TYPES = new Set([
    'session.status',
    'wallet.unlock',
    'wallet.lock',
]);

/**
 * @param {PreHostDeps} [deps]
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void} detach fn
 */
export function attachSessionMetaListener(deps = {}, chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        return () => {};
    }

    const listener = (message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        const type = message.type;
        if (typeof type !== 'string' || !PRE_HOST_MESSAGE_TYPES.has(type)) {
            return false;
        }
        (async () => {
            try {
                const result = await dispatch(type, message.request, deps);
                sendResponse({ ok: true, result });
            } catch (err) {
                sendResponse({
                    ok: false,
                    error: {
                        name: (err && err.name) || 'Error',
                        message: (err && err.message) || String(err),
                    },
                });
            }
        })();
        return true; // async response
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}

async function dispatch(type, request, deps) {
    switch (type) {
        case 'session.status':
            return handleSessionStatus();
        case 'wallet.unlock':
            return handleWalletUnlock(request, {
                storageBackend: new ChromeStorageBackend(),
                sessionBackend: new ChromeSessionBackend(),
                metaBackend: new ChromeMetaBackend(),
                onUnlocked: deps.onUnlocked,
            });
        case 'wallet.lock':
            return handleWalletLock(request, {
                sessionBackend: new ChromeSessionBackend(),
                onLocked: deps.onLocked,
            });
        default:
            throw new Error(`pre-host: no dispatcher for "${type}"`);
    }
}

async function handleSessionStatus() {
    const storage = new ChromeStorageBackend();
    const session = new ChromeSessionBackend();
    const blob = await storage.load();
    const sessionBytes = await session.load();
    const hasWallet = blob !== null;
    const hasSession = sessionBytes !== null;
    return {
        hasWallet,
        hasSession,
        state: !hasWallet
            ? 'no-wallet'
            : hasSession
                ? 'unlocked'
                : 'locked',
    };
}
