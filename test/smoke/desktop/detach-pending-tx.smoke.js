// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §24.6 / Cluster Y FOLLOWUP 4 — desktop detach-pending-tx
// into a new window. Pins:
//   - main process registers `xchain:open-window` IPC handler
//   - createWindow accepts an opts arg + builds a search-string prefill
//   - preload exposes xchainWalletWindow.openDetached
//   - History.jsx renders an "Open in new window" button on pending
//     entries when `globalThis.xchainWalletWindow.openDetached` is
//     available and the shell is desktop
//   - History accepts an `initialFocus` prop
//   - useLastView accepts a `skip` flag
//   - desktop App.jsx wires parseInitialRoute → setHistoryInitialFocus
//   - desktop App.jsx threads historyInitialFocus into the History route

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const mainPath = join(wsRoot, 'packages', 'desktop', 'main', 'index.js');
const preloadPath = join(wsRoot, 'packages', 'desktop', 'preload.js');
const appPath = join(wsRoot, 'packages', 'desktop', 'renderer', 'App.jsx');
const historyPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'History.jsx');
const lastViewPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'hooks', 'useLastView.js');

for (const p of [mainPath, preloadPath, appPath, historyPath, lastViewPath]) {
    assert.ok(existsSync(p), `${p} exists`);
}

// --- 1. main process IPC + createWindow opts ----------------------------

const main = readFileSync(mainPath, 'utf8');
assert.ok(/ipcMain\.handle\('xchain:open-window'/.test(main),
    'main registers xchain:open-window IPC handler');
assert.ok(/createWindow\(\{\s*initialView,\s*initialContext\s*\}\)/.test(main),
    'main forwards initialView + initialContext into createWindow');
assert.ok(/function createWindow\(opts = \{\}\)/.test(main),
    'createWindow accepts opts');
assert.ok(/function buildLoadOptions/.test(main),
    'main exports a buildLoadOptions helper');
assert.ok(/xc-init-route=/.test(main),
    'buildLoadOptions encodes a xc-init-route search entry');
assert.ok(/Buffer\.from\(.+\)\.toString\('base64'\)/.test(main),
    'main base64-encodes the prefill payload');

// --- 2. Preload exposes xchainWalletWindow.openDetached -----------------

const preload = readFileSync(preloadPath, 'utf8');
assert.ok(/xchainWalletWindow/.test(preload),
    'preload registers the xchainWalletWindow contextBridge namespace');
assert.ok(/openDetached/.test(preload),
    'preload exposes openDetached');
assert.ok(/'xchain:open-window'/.test(preload),
    'preload references the xchain:open-window channel');

// --- 3. History.jsx detach button + initialFocus prop -------------------

const hist = readFileSync(historyPath, 'utf8');
assert.ok(/initialFocus = null/.test(hist),
    'History accepts an initialFocus prop with null default');
assert.ok(/initialFocusFiredRef/.test(hist),
    'History tracks a fired-once ref for the initial-focus effect');
assert.ok(/data-history-key=\{entry\.key\}/.test(hist),
    'EntryRow renders a data-history-key attribute');
assert.ok(/Open in new window/.test(hist),
    'DetailCard surfaces an "Open in new window" button');
assert.ok(/xchainWalletWindow\?\.openDetached/.test(hist),
    'DetailCard checks for the xchainWalletWindow.openDetached preload API');
assert.ok(/initialView:\s*'history'/.test(hist),
    'DetailCard passes initialView=history to openDetached');
assert.ok(/shell === 'desktop'/.test(hist),
    'detachAvailable gated on desktop shell');
assert.ok(/!entry\.blockIndex/.test(hist),
    'detachAvailable gated on pending (no blockIndex) entries');

// --- 4. useLastView skip flag -------------------------------------------

const lv = readFileSync(lastViewPath, 'utf8');
assert.ok(/skip = false/.test(lv),
    'useLastView accepts a skip flag with false default');
assert.ok(/if \(skip\) return/.test(lv),
    'skip short-circuits the resume effect');

// --- 5. desktop App.jsx wires parseInitialRoute + threads focus ---------

const app = readFileSync(appPath, 'utf8');
assert.ok(/function parseInitialRoute/.test(app),
    'desktop App ships parseInitialRoute helper');
assert.ok(/xc-init-route/.test(app),
    'parseInitialRoute references the xc-init-route search key');
assert.ok(/atob\(decodeURIComponent/.test(app),
    'parseInitialRoute base64-decodes the payload');
assert.ok(/window\.history\.replaceState/.test(app),
    'parseInitialRoute strips the search after read');
assert.ok(/historyInitialFocus/.test(app),
    'desktop App tracks historyInitialFocus state');
assert.ok(/initialFocus=\{historyInitialFocus\}/.test(app),
    'desktop App threads historyInitialFocus into the History route');
assert.ok(/isDetachedWindow\.current/.test(app),
    'desktop App pins isDetachedWindow ref at mount');
assert.ok(/skip:\s*isDetachedWindow\.current/.test(app),
    'detached window passes skip=true to useLastView');

// --- 6. Round-trip parseInitialRoute via base64 + URLSearchParams -------

// Build a payload, encode, simulate window.location.search, parse.
const payload = {
    initialView: 'history',
    initialContext: { walletId: 'w-1', chainId: 'bitcoin-mainnet', actionIndex: '42' },
};
const json = JSON.stringify(payload);
const encoded = encodeURIComponent(Buffer.from(json, 'utf8').toString('base64'));
const search = `?xc-init-route=${encoded}`;

// Reproduce the parse logic locally to verify the encoder produces what
// the parser expects (we can't import App.jsx in node-script smokes
// because it pulls react / electron transitive deps).
const params = new URLSearchParams(search);
const raw = params.get('xc-init-route');
assert.equal(typeof raw, 'string');
const decoded = JSON.parse(Buffer.from(decodeURIComponent(raw), 'base64').toString('utf8'));
assert.deepEqual(decoded, payload,
    'main → renderer round-trip preserves initialView + initialContext shape');

console.log('detach-pending-tx smoke OK');
