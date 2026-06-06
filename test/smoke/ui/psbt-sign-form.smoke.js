// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §30.4 / G088 (closes paired G042) — PSBT paste-in form.
// Verifies the new PsbtSignForm component, its messaging endpoints
// (parsePsbtRequest + signPsbtUserInitiated), the background handlers
// (psbt.parse + auth.signPsbt), and the wiring into both shells'
// App.jsx + action menu.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. PsbtSignForm component exists + named export ----------------------

const formPath = join(routes, 'PsbtSignForm.jsx');
assert.ok(existsSync(formPath), 'PsbtSignForm.jsx exists');
const form = readFileSync(formPath, 'utf8');
assert.ok(/export function PsbtSignForm\b/.test(form),
    'PsbtSignForm is a named export');

// Helper export for normalizing pasted PSBTs is callable.
assert.ok(/export function normalizePsbtInput\b/.test(form),
    'normalizePsbtInput is a named export');

// --- 2. Form imports + uses both new messaging methods --------------------

assert.ok(/messaging\.parsePsbtRequest\(/.test(form),
    'PsbtSignForm calls messaging.parsePsbtRequest for the preview');
assert.ok(/messaging\.signPsbtUserInitiated\(/.test(form),
    'PsbtSignForm calls messaging.signPsbtUserInitiated to sign');

// Format detection covers hex + base64 PSBT prefix `cHNid`.
assert.ok(/cHNid/.test(form),
    'normalizePsbtInput recognises base64 PSBT prefix `cHNid`');

// --- 3. Extension popup messaging exports -------------------------------

const extMsg = readFileSync(join(ext, 'src', 'popup', 'messaging.js'), 'utf8');
assert.ok(/export function parsePsbtRequest\b/.test(extMsg),
    'extension popup messaging exports parsePsbtRequest');
assert.ok(/export function signPsbtUserInitiated\b/.test(extMsg),
    'extension popup messaging exports signPsbtUserInitiated');
assert.ok(/sendMessage\(\s*['"]psbt\.parse['"]/.test(extMsg),
    'parsePsbtRequest routes to background "psbt.parse"');
assert.ok(/sendMessage\(\s*['"]auth\.signPsbt['"]/.test(extMsg),
    'signPsbtUserInitiated routes to background "auth.signPsbt"');

// --- 4. Web shell messaging exports --------------------------------------

const webMsg = readFileSync(join(web, 'src', 'messaging.js'), 'utf8');
assert.ok(/export function parsePsbtRequest\b/.test(webMsg),
    'web messaging exports parsePsbtRequest');
assert.ok(/export function signPsbtUserInitiated\b/.test(webMsg),
    'web messaging exports signPsbtUserInitiated');

// --- 5. Background host handlers ----------------------------------------

const bgPath = join(ext, 'src', 'background', 'createBackgroundHost.js');
const bg = readFileSync(bgPath, 'utf8');
assert.ok(/host\.register\(\s*['"]psbt\.parse['"]/.test(bg),
    'background registers psbt.parse handler');
assert.ok(/host\.register\(\s*['"]auth\.signPsbt['"]/.test(bg),
    'background registers auth.signPsbt handler');
// auth.signPsbt must build signingPaths from decomposePsbt + chosen address.
assert.ok(/signingPaths/.test(bg) && /decomposePsbt/.test(bg),
    'auth.signPsbt builds signingPaths via decomposePsbt');
// Imports signPsbtFlow from flows.
assert.ok(/signPsbtFlow,/.test(bg),
    'background pulls signPsbtFlow off the flows namespace');

// --- 6. Both shells render PsbtSignForm at unlockedView === "sign-psbt" --

const extApp = readFileSync(join(ext, 'src', 'popup', 'App.jsx'), 'utf8');
assert.ok(/from ['"]@xchain-wallet\/core\/shared\/routes\/PsbtSignForm\.jsx['"]/.test(extApp),
    'extension App imports PsbtSignForm');
assert.ok(/unlockedView === ['"]sign-psbt['"]/.test(extApp),
    'extension App routes unlockedView "sign-psbt" to PsbtSignForm');
assert.ok(/onSignPsbt:\s*\(\)\s*=>\s*setUnlockedView\(\s*['"]sign-psbt['"]\s*\)/.test(extApp),
    'extension App wires onSignPsbt → setUnlockedView("sign-psbt")');
assert.ok(/id:\s*['"]sign-psbt['"]/.test(extApp),
    'extension action menu has a sign-psbt entry');

const webApp = readFileSync(join(web, 'src', 'App.jsx'), 'utf8');
assert.ok(/from ['"]@xchain-wallet\/core\/shared\/routes\/PsbtSignForm\.jsx['"]/.test(webApp),
    'web App imports PsbtSignForm');
assert.ok(/unlockedView === ['"]sign-psbt['"]/.test(webApp),
    'web App routes unlockedView "sign-psbt" to PsbtSignForm');
assert.ok(/onSignPsbt:\s*\(\)\s*=>\s*setUnlockedView\(\s*['"]sign-psbt['"]\s*\)/.test(webApp),
    'web App wires onSignPsbt → setUnlockedView("sign-psbt")');
assert.ok(/id:\s*['"]sign-psbt['"]/.test(webApp),
    'web action menu has a sign-psbt entry');

console.log('psbt-sign-form smoke OK');
