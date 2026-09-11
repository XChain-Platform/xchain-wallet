// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Content script: runs in the extension's isolated world for every
// matching page. Two responsibilities:
//
//   1. Inject the `xchainProvider.js` bundle into the page's main
//      world by appending a <script> tag sourced from the extension's
//      web_accessible_resources. The injected script then defines
//      `window.xchain` in the page's JS context.
//
//   2. Bridge between page (window.postMessage) and background
//      (chrome.runtime.sendMessage). Annotates every request with the
//      page's origin so the background can resolve `ConnectedSite`
//      permissions.
//
// The content script does NOT implement any permission logic itself.
// It is a pure message relay. All policy lives in the background
// bridge handlers (§43.3 + Approvals).

(function installBridge() {
    const SOURCE = 'xchain-inject';
    const RESPONSE_SOURCE = 'xchain-inject-response';
    const EVENT_SOURCE = 'xchain-inject-event';
    const INJECT_PATH = 'inject/xchainProvider.js';

    try {
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL(INJECT_PATH);
        script.type = 'text/javascript';
        script.async = false;
        (document.head || document.documentElement).appendChild(script);
        script.addEventListener('load', () => script.remove());
    } catch (e) {
        // If injection fails the page simply won't see window.xchain.
        // Logging here for dev debugging only. Production should not
        // reach this path since web_accessible_resources is configured
        // in the manifest.
        console.warn('[xchain] inject failed:', e);
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.source !== SOURCE) return;
        if (typeof data.id !== 'string' || typeof data.type !== 'string') return;

        // Trust boundary: a web page may reach ONLY the origin-gated
        // `bridge.*` surface. Refuse to relay privileged extension-internal
        // types (wallet.*, action.*, settings.*, sites.*, ...) so a hostile
        // page can't drive the popup-only handler set (which signs with the
        // pre-unlocked pool and no password). Mirrors publicSurface.isPublicBridgeType;
        // the background re-checks the sender so this is defence-in-depth, not
        // the sole gate.
        if (!data.type.startsWith('bridge.')) {
            window.postMessage({
                source: RESPONSE_SOURCE,
                id: data.id,
                ok: false,
                // `code` is a published BridgeErrorCode, like every other
                // failure the page can see. The relay's own refusals used to
                // invent their own names (FORBIDDEN / RUNTIME_UNAVAILABLE /
                // NO_RESPONSE), which a dApp branching on bridge-spec's union
                // could not match. The precise reason stays in
                // `message`, which is where the spec puts human detail.
                error: {
                    name: 'BridgeError',
                    message: 'FORBIDDEN: message type is not available to web pages',
                    code: 'INVALID_PARAMS',
                },
            }, window.location.origin);
            return;
        }

        const request = {
            ...(data.request ?? {}),
            origin: window.location.origin,
        };

        // Post exactly one envelope on every path out of this listener: the
        // injected provider parks a promise per request with no deadline, so
        // a silent path hangs the dApp call and leaks its pending entry.
        const refuse = (message) => {
            window.postMessage({
                source: RESPONSE_SOURCE,
                id: data.id,
                ok: false,
                error: {
                    name: 'BridgeError',
                    message,
                    code: 'INTERNAL_ERROR',
                },
            }, window.location.origin);
        };

        try {
            chrome.runtime.sendMessage({ type: data.type, request }, (response) => {
                // Chrome surfaces chrome.runtime.lastError when the
                // extension context is invalidated mid-request (updates,
                // reloads). Serialize it into the same envelope so the
                // page always gets a response.
                const err = chrome.runtime.lastError;
                if (err) {
                    refuse(`RUNTIME_UNAVAILABLE: ${err.message}`);
                    return;
                }
                if (!response || typeof response !== 'object') {
                    refuse('NO_RESPONSE: no response from background');
                    return;
                }
                window.postMessage({
                    source: RESPONSE_SOURCE,
                    id: data.id,
                    ok: response.ok === true,
                    result: response.result,
                    error: response.error,
                }, window.location.origin);
            });
        } catch (e) {
            // Answer the invalidation the callback above cannot see: an
            // update, reload or disable makes sendMessage throw out of the
            // call itself, so no callback runs and lastError is never read.
            refuse(`RUNTIME_UNAVAILABLE: ${(e && e.message) || String(e)}`);
        }
    });

    // Step 3 (future): forward background-initiated events (accountsChanged
    // etc.) to the page via `window.postMessage({ source: EVENT_SOURCE, … })`.
    // Left wired for the UI layer to surface events when wallet state
    // changes; no sender in Phase 1 emits them yet.
    if (chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener((message) => {
            if (!message || message.type !== 'bridge.event') return;
            // The broadcaster picked this tab from a URL snapshot and addressed
            // the send by tab id, so a navigation since then means the event
            // belongs to the previous origin, not this document. This listener
            // is the only check that runs against the page actually loaded, so
            // it is the authoritative gate: drop anything not stamped for us
            if (message.origin !== window.location.origin) return;
            window.postMessage({
                source: EVENT_SOURCE,
                event: message.event,
                payload: message.payload,
            }, window.location.origin);
        });
    }
})();
