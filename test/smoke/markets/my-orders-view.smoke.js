// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-17 MyOrdersView: the unified cross-pair "My orders"
// surface - lists every order the wallet placed across all chains and
// addresses (native-coin pairs included), derives cancelled/expired from
// the authoritative order_cancels table + wall-clock expiry (NOT the laggy
// state.status), offers cancel (ORDER v1) and edit (ORDER v2) on open
// orders, and carries the PC-16 per-order auto-pay toggle.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

const view = read('packages', 'core', 'src', 'shared', 'routes', 'MyOrdersView.jsx');
// Cross-pair, multi-chain enumeration.
assert.match(view, /getAddressesByChain/, 'scans the wallet addresses across chains');
assert.match(view, /getOrdersForAddress/, 'lists orders by address (cross-pair, native included)');
// Authoritative status derivation.
assert.match(view, /getOrderCancelsForAddress/, 'cancelled derived from order_cancels, not the laggy state.status');
assert.match(view, /String\(o\.source\) !== r\.p\.owner\.address/, 'keeps only orders this wallet is the SOURCE of');
assert.match(view, /function deriveStatus/, 'status derivation helper');
assert.match(view, /exp <= nowSec/, 'expiry derived from EXPIRATION vs wall clock');
// Cancel + edit only for open orders.
assert.match(view, /type: 'cancel'/, 'offers cancel');
assert.match(view, /type: 'edit'/, 'offers edit');
assert.match(view, /status === 'open' \?/, 'cancel/edit gated on open');
assert.match(view, /messaging\.cancelOrderHw|messaging\.cancelOrder\b/, 'cancel routes through cancelOrder');
assert.match(view, /messaging\.editOrderHw|messaging\.editOrder\b/, 'edit routes through editOrder');
assert.match(view, /VERSION|EXPIRATION|ALLOW_LIST/, 'edit builds v2 params');
// PC-16 autopay toggle absorbed.
assert.match(view, /listAutopayOrders/, 'reads autopay consents');
assert.match(view, /setAutopayEnabled/, 'per-order autopay toggle');
assert.match(view, /isNativeGive\(it\.row\)/, 'autopay toggle only on native-coin GIVE rows');

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
    assert.ok(src.includes('MyOrdersView'), `${shell.join('/')} imports MyOrdersView`);
    assert.ok(src.includes("unlockedView === 'my-orders'"), `${shell.join('/')} routes my-orders`);
    assert.ok(src.includes("id: 'my-orders'"), `${shell.join('/')} lists a My orders action`);
}

// ---- Command palette ----
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'nav-my-orders'.*go\('my-orders'\)/, 'palette has a My orders entry');

console.log('my-orders-view smoke: all assertions passed');
