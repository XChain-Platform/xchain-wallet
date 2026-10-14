// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §56.3 Pre-launch, user-initiated track, Step 1: Chrome
// Web Store manifest hardening gate. Catches drift in the extension
// manifest (stale version after a wallet bump, missing homepage_url,
// broken icon tile, broad host_permissions snuck in) before it reaches
// CI or the CWS submission queue.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runExtensionManifestAudit } from '../../../packages/core/scripts/extension-manifest-audit.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(readFileSync(
    resolve(repo, 'packages/extension/manifest.json'),
    'utf8',
));
const popupCss = readFileSync(
    resolve(repo, 'packages/extension/src/popup/popup.css'),
    'utf8',
);

const results = runExtensionManifestAudit();
const failed = results.filter((r) => !r.ok);
assert.equal(failed.length, 0,
    `extension-manifest audit: ${failed.length} rule(s) failed:\n${
        failed.map((r) => `  ✗ ${r.rule}: ${r.detail}`).join('\n')
    }`);

assert.equal(manifest.action?.default_title, 'XChain Wallet');
assert.equal(manifest.action?.default_popup, 'popup.html');
assert.deepEqual(manifest.options_ui, { page: 'popup.html', open_in_tab: true });
assert.equal(manifest.side_panel?.default_path, 'sidepanel.html');

const expectedIcons = Object.fromEntries(
    [16, 32, 48, 128].map((size) => [String(size), `icons/icon-${size}.png`]),
);
assert.deepEqual(manifest.icons, expectedIcons);
assert.deepEqual(manifest.action.default_icon, expectedIcons);
// The toolbar popup sizes itself from its content, so develop pins it to
// fixed lengths; viewport-relative sizes collapse it to Chrome's 25px minimum.
assert.match(
    popupCss,
    /html\.xchain-toolbar-popup\s*\{[^}]*width:\s*360px;[^}]*height:\s*600px;[^}]*overflow:\s*hidden;/,
);
assert.doesNotMatch(popupCss, /html\.xchain-toolbar-popup\s*\{[^}]*(?:100vw|100vh)/);
assert.match(popupCss, /@media \(min-width:\s*601px\)[^]*width:\s*100%/);

console.log(
    `OK: extension-manifest audit smoke (${results.length} rules pass plus popup, full-tab, side-panel, action-title, and icon entry contracts)`,
);
