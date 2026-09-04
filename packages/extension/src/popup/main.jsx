// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Popup React root. Loaded by popup.html (at the extension package
// root); Vite bundles this entry and rewrites the HTML's script tag
// to point at the hashed output.
//
// Loading tokens.css here (once, at the shell entry) installs the
// design-token custom properties on :root.

import { createRoot } from 'react-dom/client';
import { flows, registry } from '@xchain-wallet/core';
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';
import { initPanicModePersistence } from '../background/panicModeStorage.js';
import { installExtensionWipeHook } from '../storage/wipeHook.js';

// Publish the shell wipe hook before any surface can offer a wipe. This
// entry also backs the side panel, and it renders core's Locked ("Forgot
// password"), VaultUnavailable and demo-exit escapes, every one of which
// calls core's wipeWalletStorage().
installExtensionWipeHook();

// §26.5 panic-mode freeze. Share the freeze state with the background worker
// and the approval window via chrome.storage.local: activating panic here must
// be visible to the enforcement gate that runs in the service worker.
void initPanicModePersistence(flows);

// §9.7 / G007: refresh chain descriptors from the hub's signed public
// registry snapshot, the same fire-and-forget sync web/src/main.jsx runs.
// The MV3 popup (and the side panel, which reuses this entry) is a separate
// JS realm from the service worker with its own defaultRegistry() singleton,
// so background.js's sync never reaches the pickers, forms and per-coin
// gating rendered here; without this the popup kept showing bundled
// descriptors while the dApp bridge already advertised the synced ones. The
// signature must verify against the pinned federation key or nothing
// changes; any failure leaves the bundled descriptors serving. Never blocks
// boot; surfaces re-render when the batch lands (useSupportedChains).
try {
    registry.syncChainRegistryFromHub({ registry: registry.defaultRegistry() })
        .then((r) => {
            if (!r.ok) console.info('[xchain] popup chain-registry sync skipped:', r.reason);
        })
        .catch(() => { /* soft enhancement; bundled descriptors keep serving */ });
} catch { /* never block popup boot */ }

const container = document.getElementById('xchain-popup-root');
if (!container) {
    throw new Error('popup: #xchain-popup-root missing; check popup.html');
}

createRoot(container).render(<App />);
