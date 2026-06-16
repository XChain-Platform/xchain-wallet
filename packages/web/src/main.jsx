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
import '@xchain-wallet/core/ui/tokens.css';
import { App } from './App.jsx';

// §47.1 / G143 — register this origin as a handler for `xchain:` URIs so
// the OS / browser can open the web wallet when the user clicks an
// `xchain:` link. Browsers expose this via `navigator.registerProtocolHandler`
// — the user is prompted once on first call. Only effective on https:
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
        } catch { /* not safelisted in this browser — web+xchain still works */ }
    }
} catch { /* registration is a soft enhancement — never block app boot */ }

const container = document.getElementById('xchain-web-root');
if (!container) {
    throw new Error('web: #xchain-web-root missing — check index.html');
}
createRoot(container).render(<App />);
