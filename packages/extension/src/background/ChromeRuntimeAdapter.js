// ChromeRuntimeAdapter — bridges a MessageHost to `chrome.runtime`.
// Runs in the MV3 service worker; popup, content script, and inject
// script send messages via `chrome.runtime.sendMessage`.
//
// Protocol: a request shaped `{ type, request }` goes in; the handler
// returns a Promise; the host's response envelope
// (`{ ok, result } | { ok, error }`) comes back.
//
// `chrome.runtime.onMessage` listeners indicate async response by
// returning `true` from the listener and invoking `sendResponse` after
// the Promise settles. Newer Chrome also supports returning a Promise
// from the listener; we use the sendResponse pattern for broadest MV3
// compatibility.

/**
 * Attach a MessageHost to a chrome.runtime surface. Returns a function
 * that detaches the listener (useful for hot reload and tests).
 *
 * @param {import('./MessageHost.js').MessageHost} host
 * @param {{ onMessage: { addListener: Function, removeListener: Function } }} [chromeRuntime]
 * @returns {() => void}                                                       detach fn
 */
export function attachChromeRuntime(host, chromeRuntime) {
    const runtime =
        chromeRuntime ?? /** @type {any} */ (globalThis.chrome?.runtime);
    if (!runtime || !runtime.onMessage) {
        throw new Error(
            'attachChromeRuntime: chrome.runtime.onMessage is not available; pass a runtime object for tests',
        );
    }

    const listener = (message, _sender, sendResponse) => {
        // Reserve `session.*` for the session-meta listener (see
        // sessionMeta.js). That listener runs before the MessageHost is
        // wired up and answers questions that don't need a vault; skipping
        // them here avoids a double-sendResponse when both listeners fire
        // for the same message.
        if (
            message &&
            typeof message === 'object' &&
            typeof message.type === 'string' &&
            message.type.startsWith('session.')
        ) {
            return false;
        }
        // Fire-and-forget the async work, then reply via sendResponse.
        Promise.resolve()
            .then(() => host.handle(message))
            .then((response) => sendResponse(response))
            .catch((err) => {
                // host.handle already serializes errors; this catch guards
                // against truly unexpected failures.
                sendResponse({
                    ok: false,
                    error: {
                        name: (err && err.name) || 'Error',
                        message: (err && err.message) || String(err),
                    },
                });
            });
        return true; // signals async response per MV3 contract
    };

    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
}
