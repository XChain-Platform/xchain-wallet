// Thin wrapper around `chrome.runtime.sendMessage` — the popup's only
// channel to the background service worker.
//
// Envelope matches the MessageHost contract:
//   request  = { type, request? }
//   response = { ok: true, result } | { ok: false, error: { name, message } }
//
// All popup routes call `sendMessage(type, request)` and get a Promise
// that resolves to the `result` payload or rejects with an Error whose
// `name` mirrors the background-side error class name.

/**
 * @param {string} type
 * @param {unknown} [request]
 * @returns {Promise<unknown>}
 */
export function sendMessage(type, request) {
    return new Promise((resolve, reject) => {
        const runtime = globalThis.chrome?.runtime;
        if (!runtime?.sendMessage) {
            reject(new Error('chrome.runtime.sendMessage unavailable'));
            return;
        }
        runtime.sendMessage({ type, request }, (response) => {
            const lastErr = runtime.lastError;
            if (lastErr) {
                reject(new Error(lastErr.message || 'runtime error'));
                return;
            }
            if (!response || typeof response !== 'object') {
                reject(new Error(`no response for "${type}"`));
                return;
            }
            if (response.ok) {
                resolve(response.result);
                return;
            }
            const err = new Error(response.error?.message || 'unknown error');
            err.name = response.error?.name || 'Error';
            reject(err);
        });
    });
}

/**
 * Read the background's view of the current wallet-session state.
 * Answered by the session-meta listener in background.js — works before
 * the MessageHost's vault-backed handlers come online.
 *
 * @returns {Promise<{ hasWallet: boolean, hasSession: boolean, state: 'no-wallet' | 'locked' | 'unlocked' }>}
 */
export function getSessionStatus() {
    return /** @type {any} */ (sendMessage('session.status'));
}
