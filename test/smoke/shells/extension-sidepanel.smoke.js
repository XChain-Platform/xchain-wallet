// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §24 / G056 — Extension sidebar mode (Chrome Side Panel).
//
// Verify pass: the implementation already shipped (manifest +
// layoutMode controller + LayoutModeToggle UI). This smoke pins the
// wiring so a future edit cannot drop one of the four pieces:
//
//   1. manifest.json declares `side_panel.default_path` + `sidePanel`
//      permission.
//   2. The two HTML entry points (popup.html, sidepanel.html) exist.
//   3. Background `layoutMode.js` exports the controller surface and
//      detects API support; background.js calls into it on boot.
//   4. Shared `LayoutModeToggle` component renders both modes and
//      writes to chrome.storage.local under the canonical key.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. manifest.json declares the side_panel default + permission.
const manifestPath = 'packages/extension/manifest.json';
const manifest = JSON.parse(read(manifestPath));
assert.ok(manifest.side_panel && typeof manifest.side_panel.default_path === 'string',
    'manifest declares side_panel.default_path');
assert.equal(manifest.side_panel.default_path, 'sidepanel.html',
    'side_panel default_path is sidepanel.html');
assert.ok(Array.isArray(manifest.permissions) && manifest.permissions.includes('sidePanel'),
    'manifest permissions array includes "sidePanel"');
assert.equal(manifest.action.default_popup, 'popup.html',
    'manifest action.default_popup is popup.html (the layout-mode controller toggles this at runtime)');

// 2. The two HTML entry points exist.
for (const html of ['packages/extension/popup.html', 'packages/extension/sidepanel.html']) {
    assert.ok(existsSync(join(root, html)), `${html} exists`);
}

// 3. Background controller exports the canonical surface.
const layoutSrc = read('packages/extension/src/background/layoutMode.js');
for (const fn of ['isSidePanelSupported', 'readLayoutMode', 'writeLayoutMode', 'applyLayoutMode', 'attachLayoutModeListener']) {
    assert.ok(new RegExp(`export (async )?function ${fn}\\(`).test(layoutSrc)
        || new RegExp(`export const ${fn}\\b`).test(layoutSrc),
        `layoutMode.js exports ${fn}`);
}
assert.ok(/LAYOUT_MODES\s*=\s*\/\*\*[^]*?\*\/\s*\(\['popup',\s*'sidepanel'\]\)/.test(layoutSrc),
    'LAYOUT_MODES is exactly [popup, sidepanel]');
assert.ok(/STORAGE_KEY\s*=\s*'xchain\.layoutMode'/.test(layoutSrc),
    'storage key is xchain.layoutMode');
assert.ok(/chrome\.action\.setPopup\(\{ popup: '' \}\)/.test(layoutSrc),
    'sidepanel mode clears action.popup so click falls through to side panel');
assert.ok(/chrome\.sidePanel\.setPanelBehavior\(\{ openPanelOnActionClick: true \}\)/.test(layoutSrc),
    'sidepanel mode flips openPanelOnActionClick: true');

// background.js wires it on boot.
const bgSrc = read('packages/extension/src/background.js');
for (const fn of ['applyLayoutMode', 'attachLayoutModeListener', 'readLayoutMode']) {
    assert.ok(new RegExp(`\\b${fn}\\b`).test(bgSrc),
        `background.js references ${fn}`);
}
assert.ok(/await applyLayoutMode\(mode\)/.test(bgSrc),
    'background.js applies the saved mode at boot');
assert.ok(/attachLayoutModeListener\(\)/.test(bgSrc),
    'background.js attaches the storage-change listener');

// 4. Shared toggle component.
const togglePath = 'packages/core/src/shared/components/LayoutModeToggle.jsx';
assert.ok(existsSync(join(root, togglePath)), `${togglePath} exists`);
const toggleSrc = read(togglePath);
assert.ok(/STORAGE_KEY\s*=\s*'xchain\.layoutMode'/.test(toggleSrc),
    'toggle uses the same canonical storage key as the controller');
assert.ok(/pick\('popup'\)/.test(toggleSrc) && /pick\('sidepanel'\)/.test(toggleSrc),
    'toggle renders both modes');
assert.ok(/aria-checked=/.test(toggleSrc),
    'toggle is accessibly marked with aria-checked');

console.log('OK — extension sidebar mode (Chrome Side Panel) smoke');
