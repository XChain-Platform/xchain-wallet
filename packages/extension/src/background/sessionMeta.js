// Session-meta listener — answers `session.status` queries before the
// MessageHost's vault-backed handlers come online.
//
// The popup runs first-thing-on-open; its state machine needs to know
// which of `no-wallet` / `locked` / `unlocked` to render without
// demanding an unlocked vault. That question is answered from the two
// storage backends directly:
//
//   - `ChromeStorageBackend` (chrome.storage.local): holds the encrypted
//     wallet blob. Non-null ⇒ a wallet exists.
//   - `ChromeSessionBackend` (chrome.storage.session): holds the derived
//     master key for the current browser session. Non-null ⇒ unlocked.
//
// Registered at background startup, before the MessageHost attaches its
// own listener. Returns `false` for any non-`session.*` message, letting
// the host listener handle everything else.

import {
    ChromeSessionBackend,
    ChromeStorageBackend,
} from '../storage/index.js';

/**
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void} detach fn
 */
export function attachSessionMetaListener(chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        return () => {};
    }

    const listener = (message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        if (message.type !== 'session.status') return false;
        (async () => {
            try {
                const storage = new ChromeStorageBackend();
                const session = new ChromeSessionBackend();
                const blob = await storage.load();
                const sessionBytes = await session.load();
                const hasWallet = blob !== null;
                const hasSession = sessionBytes !== null;
                sendResponse({
                    ok: true,
                    result: {
                        hasWallet,
                        hasSession,
                        state: !hasWallet
                            ? 'no-wallet'
                            : hasSession
                                ? 'unlocked'
                                : 'locked',
                    },
                });
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
