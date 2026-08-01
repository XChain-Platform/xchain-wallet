// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Web SPA entry. Vite serves this from `/src/main.jsx`, referenced by
// the root `index.html`. Imports tokens.css once at the entry so the
// design-token custom properties install on `:root` for every route.

import { createRoot } from 'react-dom/client';
import { registry } from '@xchain-wallet/core';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';
import {
    checkWebViewFloor,
    floorFailureMessage,
    floorStaleMessage,
} from './platform/webviewFloor.js';
import { BROKEN_SHELL_MESSAGE, nativeShellIsBroken } from './storage/nativeVault.js';

// §9.7 / G007: refresh chain descriptors from the hub's signed public
// registry snapshot. Fire-and-forget soft enhancement: the signature must
// verify against the pinned federation key or nothing changes, and any
// failure (offline, tampered, unsigned) leaves the bundled descriptors
// serving. Never blocks boot.
try {
    registry.syncChainRegistryFromHub({ registry: registry.defaultRegistry() })
        .then((r) => {
            if (!r.ok) console.info('web: chain-registry sync skipped:', r.reason);
        })
        .catch(() => { /* soft enhancement; bundled descriptors keep serving */ });
} catch { /* never block app boot */ }

// §47.1 / G143: register this origin as a handler for `xchain:` URIs so
// the OS / browser can open the web wallet when the user clicks an
// `xchain:` link. Browsers expose this via `navigator.registerProtocolHandler`.
// The user is prompted once on first call. Only effective on https:
// origins (and localhost during dev); browsers silently ignore the call
// otherwise. We swallow exceptions so a stricter browser policy doesn't
// crash the SPA at boot.
try {
    if (typeof navigator?.registerProtocolHandler === 'function') {
        const target = `${location.origin}/?uri=%s`;
        // `web+xchain` is always safelisted by browsers per the
        // registerProtocolHandler spec.
        navigator.registerProtocolHandler('web+xchain', target);
        // Some browsers also accept the bare `xchain` scheme; others reject
        // it as not in the safelist. Try and ignore the resulting throw.
        try {
            navigator.registerProtocolHandler('xchain', target);
        } catch { /* not safelisted in this browser; web+xchain still works */ }
    }
} catch { /* registration is a soft enhancement; never block app boot */ }

const container = document.getElementById('xchain-web-root');
if (!container) {
    throw new Error('web: #xchain-web-root missing. Check index.html.');
}

//  §3: the capability floor, checked BEFORE React mounts.
//
// Before, not after, and not inside a component: everything the app does
// from its first render - reading the vault, deriving a key, drawing an
// unlock screen - assumes crypto.subtle and IndexedDB are there. An engine
// missing one of them does not fail cleanly at the point of use; it gets far
// enough to ask for a password and then breaks somewhere the user reads as
// "my wallet is gone". This is the only screen such a device should see, and
// it is deliberately plain HTML: the failure might be in the very primitives
// the app needs to render anything richer.
/** The one screen a device that must not open the wallet ever sees. */
function renderBlockingPanel(heading, message) {
    container.textContent = '';
    const panel = document.createElement('div');
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'max-width:42rem;margin:3rem auto;padding:1.5rem;'
        + 'font:16px/1.6 system-ui,sans-serif';
    const title = document.createElement('h1');
    title.textContent = heading;
    title.style.cssText = 'font-size:1.25rem;margin:0 0 1rem';
    const body = document.createElement('p');
    body.textContent = message;
    panel.append(title, body);
    container.append(panel);
}

// : a NATIVE shell whose vault plugin never registered.
//
// Checked beside the capability floor and for the same reason, but it is a
// different failure: the engine is fine, the BUILD is broken. Without this the
// app boots happily and stores the only copy of the vault in WebView storage,
// which the OS may reclaim and the user may clear from Settings - on a build
// whose backup posture (`allowBackup=false`, the iOS backup exclusion)
// guarantees there is no second copy anywhere. It works perfectly right up to
// the moment the wallet is gone, so it must not be allowed to work at all.
// In a browser this is false and nothing changes.
const floor = checkWebViewFloor();
if (nativeShellIsBroken()) {
    renderBlockingPanel('XChain Wallet cannot open on this device', BROKEN_SHELL_MESSAGE);
} else if (!floor.usable) {
    renderBlockingPanel(
        'This device cannot run XChain Wallet safely',
        floorFailureMessage(floor),
    );
} else {
    if (floor.stale) {
        // Advice, not a gate. Logged rather than modal: the wallet works, and
        // the direct-APK audience includes de-Googled ROMs where the engine
        // ships with the OS and "just update it" is not one tap.
        console.warn(floorStaleMessage(floor));
    }
    createRoot(container).render(<App />);
}
