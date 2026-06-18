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

    // Step 1: inject the provider script into the page's main world.
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

    // Step 2: relay page postMessages → background; background replies
    // → page postMessages.
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;
        if (data.source !== SOURCE) return;
        if (typeof data.id !== 'string' || typeof data.type !== 'string') return;

        const request = {
            ...(data.request ?? {}),
            origin: window.location.origin,
        };

        chrome.runtime.sendMessage({ type: data.type, request }, (response) => {
            // Chrome surfaces chrome.runtime.lastError when the
            // extension context is invalidated mid-request (updates,
            // reloads). Serialize it into the same envelope so the
            // page always gets a response.
            const err = chrome.runtime.lastError;
            if (err) {
                window.postMessage({
                    source: RESPONSE_SOURCE,
                    id: data.id,
                    ok: false,
                    error: { name: 'BridgeError', message: err.message, code: 'RUNTIME_UNAVAILABLE' },
                }, window.location.origin);
                return;
            }
            if (!response || typeof response !== 'object') {
                window.postMessage({
                    source: RESPONSE_SOURCE,
                    id: data.id,
                    ok: false,
                    error: { name: 'BridgeError', message: 'no response from background', code: 'NO_RESPONSE' },
                }, window.location.origin);
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
    });

    // Step 3 (future): forward background-initiated events (accountsChanged
    // etc.) to the page via `window.postMessage({ source: EVENT_SOURCE, … })`.
    // Left wired for the UI layer to surface events when wallet state
    // changes; no sender in Phase 1 emits them yet.
    if (chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener((message) => {
            if (!message || message.type !== 'bridge.event') return;
            window.postMessage({
                source: EVENT_SOURCE,
                event: message.event,
                payload: message.payload,
            }, window.location.origin);
        });
    }
})();
