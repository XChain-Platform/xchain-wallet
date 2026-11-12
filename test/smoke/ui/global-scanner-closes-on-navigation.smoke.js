// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The global QR scanner is a modal overlay over the content area. Keyboard
// focus stays inside it while open, and navigation closes it on every view
// change or on a tap of the view already shown.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, '..', '..', '..', 'packages', 'web', 'src', 'App.jsx'), 'utf8');

assert.match(
    app,
    /useFocusTrap\(globalScannerRef, \{\s*active: globalScannerOpen,\s*initialFocusRef: globalScannerRef,\s*\}\);/,
    'the global scanner traps focus from its container while open',
);
assert.match(
    app,
    /ref=\{globalScannerRef\}[\s\S]{0,160}?aria-modal="true"[\s\S]{0,160}?tabIndex=\{-1\}/,
    'the scanner dialog is a programmatic initial focus target',
);

// The scanner is modal and inerts everything outside it, so it covers the
// header and navigation too instead of leaving them on show but dead, and
// Escape or system Back closes it like any other modal.
assert.match(
    app,
    /ref=\{globalScannerRef\}[\s\S]{0,600}?position: 'fixed',\s*inset: 0,/,
    'the global scanner covers the whole viewport',
);
assert.match(
    app,
    /useBackHandler\(globalScannerOpen \? \(\) => setGlobalScannerOpen\(false\) : undefined\);/,
    'Escape and system Back close the global scanner',
);

// ScanRoute is lazy; opened before its chunk loaded, the scanner suspended
// with no boundary and the shell fell to the route error screen.
assert.match(
    app,
    /ref=\{globalScannerRef\}[\s\S]{0,2000}?<Suspense fallback=\{<Loading \/>\}>\s*<ScanRoute\b/,
    'the lazy global scanner has its own Suspense boundary',
);

assert.match(
    app,
    /useEffect\(\(\) => \{\s*setGlobalScannerOpen\(false\);\s*\}, \[unlockedView\]\);/,
    'a view change closes the global scanner',
);

assert.match(
    app,
    /const handleMenuSelect = \(view\) => \{\s*setGlobalScannerOpen\(false\);/,
    'the shared menu selection handler closes the scanner before navigating',
);
assert.match(
    app,
    /<LeftNav[\s\S]{0,300}?onSelect=\{handleMenuSelect\}/,
    'the sidebar closes the scanner through the shared menu handler',
);
assert.match(
    app,
    /<BottomTabBar[\s\S]{0,300}?onSelect=\{handleMenuSelect\}/,
    'the tab bar closes the scanner through the shared menu handler',
);
assert.match(
    app,
    /menu=\{\{[\s\S]{0,500}?onSelect: handleMenuSelect,/,
    'wallet menu rows close the scanner through the shared menu handler',
);

console.log('global-scanner-closes-on-navigation smoke OK');
