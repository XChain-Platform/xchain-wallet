// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Approval-window React root. The Router dispatches by the parked
// request's `kind` to either ConnectApproval (no password needed) or
// SignApproval (password-gated; handles signMessage / signPsbt /
// signAction / signIn).

import { createRoot } from 'react-dom/client';
import { flows, registry } from '@xchain-wallet/core';
import '@xchain-wallet/core/ui/tokens.css';
import { Router } from './Router.jsx';
import { initPanicModePersistence } from '../background/panicModeStorage.js';
import { installExtensionWipeHook } from '../storage/wipeHook.js';

// Publish the shell wipe hook on every extension page entry, not only the
// ones that render a wipe today: a page that gains a wipe escape later must
// not be the one that silently fails open again.
installExtensionWipeHook();

// §26.5 panic-mode freeze. Share the freeze state with the background worker
// via chrome.storage.local so a freeze set here is visible to the enforcement
// gate that runs in the service worker.
void initPanicModePersistence(flows);

// §9.7 / G007: refresh chain descriptors from the hub's signed public
// registry snapshot, mirroring web/src/main.jsx and popup/main.jsx. The
// approval window is its own MV3 realm with its own defaultRegistry(), so
// the service worker's sync never reaches ConnectApproval / SignApproval;
// without this the approval UI rendered bundled descriptors for chains the
// bridge had already advertised from the synced set. Fail-closed: the
// signature must verify against the pinned federation key or nothing
// changes. Never blocks boot.
try {
    registry.syncChainRegistryFromHub({ registry: registry.defaultRegistry() })
        .then((r) => {
            if (!r.ok) console.info('[xchain] approval chain-registry sync skipped:', r.reason);
        })
        .catch(() => { /* soft enhancement; bundled descriptors keep serving */ });
} catch { /* never block approval boot */ }

const container = document.getElementById('xchain-approval-root');
if (!container) {
    throw new Error('approval: #xchain-approval-root missing; check approval.html');
}
createRoot(container).render(<Router />);
