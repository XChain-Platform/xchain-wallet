// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-17 CreateOrderForm: the standalone ORDER v0 authoring
// surface (full field set incl. native-coin lane + PC-16 auto-pay,
// GET_ADDRESS, Unix EXPIRATION, allow/block lists, ownership flags),
// its signer dispatch, and the 3-shell App / ActionsMenu / palette wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- The form ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'CreateOrderForm.jsx');
assert.match(form, /submitMethods: \{ hw: 'orderActionHw', software: 'orderAction' \}/, 'signer dispatch via useActionForm');
assert.match(form, /VERSION: '0', GIVE_COIN: coinTicker, GET_COIN: coinTicker/, 'composes ORDER v0 with coin networks');
assert.match(form, /GIVE_OWNERSHIP = '1'/, 'give-ownership flag');
assert.match(form, /GET_OWNERSHIP = '1'/, 'get-ownership flag');
assert.match(form, /At least one side must be a token/, 'blocks coin-for-coin');
assert.match(form, /localInputToUnix/, 'EXPIRATION is converted to a Unix timestamp (not blocks)');
assert.match(form, /p\.GET_ADDRESS = getAddress\.trim\(\)/, 'GET_ADDRESS override');
assert.match(form, /p\.ALLOW_LIST = allowListIdx/, 'allow-list field');
assert.match(form, /p\.BLOCK_LIST = blockListIdx/, 'block-list field');
assert.match(form, /ListPickerScreen/, 'allow/block via the shared list picker');
assert.match(form, /Enable CoinPay auto-pay/, 'PC-16 auto-pay checkbox');
assert.match(form, /autopayEligible = giveIsNative && !isWatcherMode && !isHwSource/, 'auto-pay only for native GIVE software signers');
assert.match(form, /autopay: \{ enabled: true \}/, 'auto-pay flag threads into orderAction');
assert.match(form, /composeForConfirm/, 'single-encode confirm path');
// Native side is encoded as an EMPTY tick, never a coin-named tick.
assert.match(form, /p\.GIVE_TICK = '';/, 'native GIVE = empty tick');
assert.match(form, /p\.GET_TICK = '';/, 'native GET = empty tick');

// ---- Host + messaging (order + editOrder) ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('action\.order'/, 'ORDER host route');
assert.match(host, /host\.register\('action\.editOrder'/, 'edit-order host route');
assert.match(host, /registerHwHandler\('action\.editOrder\.hw', editOrder\)/, 'HW edit-order route');
assert.match(host, /host\.register\('orders\.forAddress'/, 'cross-pair orders host route');
assert.match(host, /host\.register\('orders\.cancelsForAddress'/, 'order-cancels host route');
assert.match(host, /host\.register\('orders\.detail'/, 'order-detail host route');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'action.editOrder'", "'action.editOrder.hw'", "'orders.forAddress'", "'orders.cancelsForAddress'", "'orders.detail'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

// ---- 3-shell App + ActionsMenu wiring ----
// The web shell keeps its DEX routing in `packages/web/src/surfaces/dex.jsx`
// rather than inline in App.jsx: a store-profile build swaps that
// module for a twin that imports nothing, which is how the surface is
// compiled out. The two files together are that shell's wiring, so read them
// as one - asserting on App.jsx alone would go green on a shell that has no
// DEX at all.
const WEB_DEX_SURFACE = ['packages', 'web', 'src', 'surfaces', 'dex.jsx'];

for (const shell of [
    ['packages', 'web', 'src', 'App.jsx'],
    ['packages', 'desktop', 'renderer', 'App.jsx'],
    ['packages', 'extension', 'src', 'popup', 'App.jsx'],
]) {
    const src = read(...shell)
        + (shell[1] === 'web' ? read(...WEB_DEX_SURFACE) : '');
    assert.ok(src.includes('CreateOrderForm'), `${shell.join('/')} imports CreateOrderForm`);
    assert.ok(src.includes("unlockedView === 'create-order'"), `${shell.join('/')} routes create-order`);
    assert.ok(
        /onCreateOrder: (?:DEX_SURFACE_ENABLED \? )?\(\) => setUnlockedView\('create-order'\)/.test(src),
        `${shell.join('/')} wires the ActionsMenu entry`,
    );
    assert.ok(surfacesEntry(src, 'create-order', 'Create order'), `${shell.join('/')} lists a Create order action`);
}

// ---- Command palette ----
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'trade-order'.*go\('create-order'\)/, 'palette has a Create order entry');

console.log('create-order-form smoke: all assertions passed');
