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
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const list = read('packages', 'core', 'src', 'shared', 'routes', 'MySwapsView.jsx');
// Edit Swap and Cancel Swap: the swap's own checks (SwapActionPanel, in
// MySwapsView) in the Form Standard frame Order shares (TradeOwnerActionForm).
const form = read('packages', 'core', 'src', 'shared', 'routes', 'TradeOwnerActionForm.jsx');
const view = list + form;
assert.match(view, /getAddressesByChain/, 'scans wallet addresses across chains');
assert.match(view, /getSwapsForAddress/, 'lists swaps by address (cross-pair)');
assert.match(view, /getSwapCancelsForAddress/, 'cancelled derived from swap_cancels, not the laggy state.status');
assert.match(view, /String\(s\.source\) !== r\.p\.owner\.address/, 'keeps only swaps this wallet is the SOURCE of');
assert.match(list, /indexParam: 'SWAP_ACTION_INDEX'/, 'cancel and edit name the swap by SWAP_ACTION_INDEX');
assert.match(form, /VERSION: '1', \[kind\.indexParam\]/, 'cancel composes v1');
assert.match(form, /VERSION: '2', \[kind\.indexParam\]/, 'edit composes v2');
assert.match(list, /software: \{ cancel: 'swapAction', edit: 'swapAction' \}/, 'cancel/edit route through swapAction');
assert.match(list, /hardware: \{ cancel: 'swapActionHw', edit: 'swapActionHw' \}/, 'cancel/edit route through swapActionHw');
assert.match(form, /<ActionConfirmScreen/, 'cancel/edit sign on the shared confirm page');
assert.match(form, /<FromSection/, 'the forms carry the From section with its Network field');
assert.match(form, /<FeeSection/, 'the forms carry Speed and Fees');
assert.ok(!/autopay/i.test(view), 'no auto-pay toggle (SWAP settles atomically)');
// One list (ruling 2026-11-13): no Open/Closed split, and each row opens its swap.
assert.ok(!/aria-label="(Open|Closed) swaps"/.test(view), 'one list, never Open and Closed sections');
assert.match(view, /aria-label="Swaps"/, 'the one swap list');
assert.match(view, /onOpenSwap/, 'a row opens the swap details');

// ---- Swap Details: Cancel and Edit, offered only while the swap is open ----
const detail = read('packages', 'core', 'src', 'shared', 'routes', 'SwapDetail.jsx');
assert.match(detail, /getSwapDetail/, 'reads the swap by its action index');
assert.match(detail, /canAct = status === 'open'/, 'cancel/edit gated on open');
assert.match(detail, /<SwapActionPanel/, 'cancel/edit through the My Swaps action panel');

// ---- 3-shell App wiring ----
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
    assert.ok(src.includes('MySwapsView'), `${shell.join('/')} imports MySwapsView`);
    assert.ok(src.includes("unlockedView === 'my-swaps'"), `${shell.join('/')} routes my-swaps`);
    assert.ok(src.includes("unlockedView === 'swap-detail'"), `${shell.join('/')} routes swap-detail`);
    assert.ok(src.includes("setUnlockedView('swap-detail')"), `${shell.join('/')} opens swap-detail from a My Swaps row`);
    assert.ok(surfacesEntry(src, 'my-swaps', 'My swaps'), `${shell.join('/')} lists a My swaps action`);
    // Edit Swap and Cancel Swap are their own routes, opened from Swap Details.
    for (const [route, component] of [['edit-swap', 'EditSwapForm'], ['cancel-swap', 'CancelSwapForm']]) {
        assert.ok(src.includes(component), `${shell.join('/')} imports ${component}`);
        assert.ok(src.includes(`unlockedView === '${route}'`), `${shell.join('/')} routes ${route}`);
        assert.ok(src.includes(`setUnlockedView('${route}')`), `${shell.join('/')} opens ${route} from Swap Details`);
    }
}

// ---- Command palette ----
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'nav-my-swaps'.*go\('my-swaps'\)/, 'palette has a My swaps entry');

console.log('my-swaps-view smoke: all assertions passed');
