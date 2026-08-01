// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop renderer entry. Mounts the React app into the BrowserWindow.
// The preload (`../preload.js`) has already exposed
// `window.xchainWalletBridge.sendMessage` by the time this runs;
// `bridgeMessaging.sendMessage` throws a clear error if the bridge
// isn't there, so an accidental misconfigured BrowserWindow surfaces
// as a startup error rather than silent hang.

import { createRoot } from 'react-dom/client';
import { registry } from '@xchain-wallet/core';
import { setShellCapabilities } from '@xchain-wallet/core/shared/shellCapabilities.js';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

// §9.7 / G007: hot-swap the renderer realm's chain registry with the
// hub batch main verified at boot. The renderer CSP pins connect-src
// 'self', so the fetch + pinned-key Ed25519 verification live in main
// (see main/index.js); this realm re-validates inside
// applyRemoteDescriptors. Fire-and-forget soft enhancement: any failure
// leaves the bundled descriptors serving. Never blocks boot.
try {
    window.xchainWalletRegistry?.getRemoteDescriptors()
        .then((r) => {
            if (r?.ok && Array.isArray(r.descriptors)) {
                registry.defaultRegistry().applyRemoteDescriptors(r.descriptors);
            } else if (r && !r.ok) {
                console.info('desktop: chain-registry sync skipped:', r.reason);
            }
        })
        .catch(() => { /* soft enhancement; bundled descriptors keep serving */ });
} catch { /* never block app boot */ }

const container = document.getElementById('xchain-desktop-root');
if (!container) {
    throw new Error('desktop: #xchain-desktop-root missing; check renderer/index.html');
}
// : declare what this shell can actually do before the UI
// renders. Desktop runs the SDK in the Electron main process, so its
// sockets are ours to open and a SOCKS5 proxy is reachable. The web and
// extension shells declare nothing and the Tor toggle stays hidden
// there, because neither can proxy its own traffic.
setShellCapabilities({ socksProxy: true });

createRoot(container).render(<App />);
