// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-18 MySwapsView: the cross-pair "My swaps" surface (the
// swap twin of MyOrdersView). Lists swaps the wallet placed across all
// chains/addresses, cancel (SWAP v1) + edit (SWAP v2) through swapAction,
// cancelled derived from the authoritative swap_cancels table, no
// auto-pay (SWAP settles atomically).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const view = read('packages', 'core', 'src', 'shared', 'routes', 'MySwapsView.jsx');
assert.match(view, /getAddressesByChain/, 'scans wallet addresses across chains');
assert.match(view, /getSwapsForAddress/, 'lists swaps by address (cross-pair)');
assert.match(view, /getSwapCancelsForAddress/, 'cancelled derived from swap_cancels, not the laggy state.status');
assert.match(view, /String\(s\.source\) !== r\.p\.owner\.address/, 'keeps only swaps this wallet is the SOURCE of');
assert.match(view, /VERSION: '1', SWAP_ACTION_INDEX/, 'cancel composes SWAP v1');
assert.match(view, /VERSION: '2', SWAP_ACTION_INDEX/, 'edit composes SWAP v2');
assert.match(view, /messaging\.swapActionHw|messaging\.swapAction\b/, 'cancel/edit route through swapAction');
assert.match(view, /status === 'open' \?/, 'cancel/edit gated on open');
assert.ok(!/autopay/i.test(view), 'no auto-pay toggle (SWAP settles atomically)');

// ---- 3-shell App wiring ----
// The web shell keeps its DEX routing in `packages/web/src/surfaces/dex.jsx`
// rather than inline in App.jsx : a store-profile build swaps that
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
    assert.ok(src.includes('MySwapsView'), `${shell.join('/')} imports MySwapsView`);
    assert.ok(src.includes("unlockedView === 'my-swaps'"), `${shell.join('/')} routes my-swaps`);
    assert.ok(src.includes("id: 'my-swaps'"), `${shell.join('/')} lists a My swaps action`);
}

// ---- Command palette ----
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'nav-my-swaps'.*go\('my-swaps'\)/, 'palette has a My swaps entry');

console.log('my-swaps-view smoke: all assertions passed');
