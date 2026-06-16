// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Standalone entry for the canonical component style guide. Served
// from packages/web/style-guide/index.html on the wallet's own dev
// server. Imports tokens.css so the same design-token custom properties
// the app uses are installed on :root for every example.
import { createRoot } from 'react-dom/client';
import '@xchain-wallet/core/ui/tokens.css';
import { StyleGuidePage } from './StyleGuidePage.jsx';
import './style-guide.css';

const container = document.getElementById('xchain-styleguide-root');
if (container) {
    createRoot(container).render(<StyleGuidePage />);
}
