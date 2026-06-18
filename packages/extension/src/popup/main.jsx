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
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

const container = document.getElementById('xchain-popup-root');
if (!container) {
    throw new Error('popup: #xchain-popup-root missing; check popup.html');
}

createRoot(container).render(<App />);
