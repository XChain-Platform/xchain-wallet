// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 15 of 23: Cross-chain swap form
// (§42.8.3).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'CrossChainSwapForm.jsx');
assert.ok(existsSync(formPath), 'CrossChainSwapForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

assert.ok(/export function CrossChainSwapForm\b/.test(src),
    'CrossChainSwapForm is a named export');

// Two chain pickers (give-chain + get-chain) with auto-filled
// receiver on the get-chain.
assert.ok(/giveChainId/.test(src), 'CrossChainSwapForm tracks giveChainId');
assert.ok(/getChainId/.test(src), 'CrossChainSwapForm tracks getChainId');
assert.ok(/getNewestAddress/.test(src),
    'CrossChainSwapForm auto-fills the receiver via getNewestAddress');
assert.ok(/getAddressTouched/.test(src),
    'CrossChainSwapForm preserves the user-entered receiver address when touched');

// Cross-chain SWAP requires GIVE_COIN ≠ GET_COIN.
assert.ok(/Give and get chains must differ/.test(src),
    'CrossChainSwapForm rejects same-chain swaps and points to §41.5');

// Native-coin rule still enforced (DISPENSER lane).
assert.ok(/SWAP cannot give/.test(src),
    'CrossChainSwapForm preserves the native-coin DISPENSER rule on the give side');
assert.ok(/SWAP cannot get/.test(src),
    'CrossChainSwapForm preserves the native-coin DISPENSER rule on the get side');

// Reuses the existing swapAction handler; no new core flow needed.
for (const call of [
    'messaging.swapAction',
    'messaging.swapActionHw',
    'messaging.getAddressesByChain',
    'messaging.getNewestAddress',
]) {
    assert.ok(src.includes(call), `CrossChainSwapForm calls ${call}`);
}

// HW vs software signing branches.
assert.ok(/SignCredentials/.test(src), 'CrossChainSwapForm uses SignCredentials');
assert.ok(/isHwSource/.test(src), 'CrossChainSwapForm branches on isHwSource');

// EXPIRATION + GET_ADDRESS appear in the SWAP params.
assert.ok(/GET_ADDRESS/.test(src),
    'CrossChainSwapForm sets GET_ADDRESS on the SWAP params');
assert.ok(/EXPIRATION/.test(src),
    'CrossChainSwapForm sets EXPIRATION on the SWAP params');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('CrossChainSwapForm'),
        `${shell} App.jsx imports CrossChainSwapForm`);
    assert.ok(app.includes("'cross-chain-swap'"),
        `${shell} tracks 'cross-chain-swap' sub-route`);
    assert.ok(/onCrossChainSwap: \(\) => setUnlockedView\('cross-chain-swap'\)/.test(app),
        `${shell} ActionsMenu wires onCrossChainSwap → 'cross-chain-swap'`);
    assert.ok(/<CrossChainSwapForm\b[\s\S]*?walletId=\{activeWalletId\}/.test(app),
        `${shell} App.jsx mounts <CrossChainSwapForm> with the active walletId`);
    assert.ok(/Cross-chain swap/.test(app),
        `${shell} ActionsMenu surfaces the "Cross-chain swap" entry`);
}

console.log(
    'OK: cross-chain swap smoke (CrossChainSwapForm §42.8.3 give-chain + get-chain pickers + auto-filled receiver via getNewestAddress + GIVE_COIN/GET_COIN asymmetry validation + native-coin DISPENSER rule retained + reuses swapAction core flow + HW vs software signing + 3-shell App.jsx + ActionsMenu entry)',
);
