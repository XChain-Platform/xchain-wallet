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
import { flows } from '@xchain-wallet/core';
import '@xchain-wallet/core/ui/tokens.css';
import { Router } from './Router.jsx';
import { initPanicModePersistence } from '../background/panicModeStorage.js';

// §26.5 panic-mode freeze. Share the freeze state with the background worker
// via chrome.storage.local so a freeze set here is visible to the enforcement
// gate that runs in the service worker.
void initPanicModePersistence(flows);

const container = document.getElementById('xchain-approval-root');
if (!container) {
    throw new Error('approval: #xchain-approval-root missing; check approval.html');
}
createRoot(container).render(<Router />);
