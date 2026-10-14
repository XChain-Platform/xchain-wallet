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

assert.match(
    app,
    /useEffect\(\(\) => \{\s*setGlobalScannerOpen\(false\);\s*\}, \[unlockedView\]\);/,
    'a view change closes the global scanner',
);

const navSelects = app.match(/onSelect=\{\(view\) => [^\n]*\}/g) || [];
assert.ok(navSelects.length >= 2, 'located the navigation onSelect handlers');
for (const handler of navSelects) {
    assert.match(handler, /setGlobalScannerOpen\(false\)/, `navigation closes the scanner: ${handler}`);
}

console.log('global-scanner-closes-on-navigation smoke OK');
