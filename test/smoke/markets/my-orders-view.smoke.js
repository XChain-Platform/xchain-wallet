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
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// The list, the order's detail page (2026-11-13: rows open it, and it holds
// Cancel, Edit and auto-pay), the form behind those actions, and the status
// helpers they share, read as one surface.
const list = read('packages', 'core', 'src', 'shared', 'routes', 'MyOrdersView.jsx');
const detail = read('packages', 'core', 'src', 'shared', 'routes', 'OrderDetail.jsx');
// Edit Order and Cancel Order: the order's own checks (OrderActionPanel) in
// the shared Form Standard frame (TradeOwnerActionForm), each on its own route.
const form = read('packages', 'core', 'src', 'shared', 'routes', 'TradeOwnerActionForm.jsx');
const view = list
    + detail
    + read('packages', 'core', 'src', 'shared', 'routes', 'OrderActionPanel.jsx')
    + form
    + read('packages', 'core', 'src', 'shared', 'utils', 'orderView.js');
// One plain list, newest first, with no Open / Closed split; each row opens its detail.
assert.match(list, /aria-label="Orders"/, 'one order list');
assert.doesNotMatch(list, /Open orders|Closed orders|SectionHeader/, 'no Open / Closed sections');
assert.match(list, /onOpenOrder/, 'a row opens the order detail');
// Cross-pair, multi-chain enumeration.
assert.match(view, /getAddressesByChain/, 'scans the wallet addresses across chains');
assert.match(view, /getOrdersForAddress/, 'lists orders by address (cross-pair, native included)');
// Authoritative status derivation.
assert.match(view, /getOrderCancelsForAddress/, 'cancelled derived from order_cancels, not the laggy state.status');
assert.match(view, /String\(o\.source\) !== r\.p\.owner\.address/, 'keeps only orders this wallet is the SOURCE of');
assert.match(view, /function deriveStatus/, 'status derivation helper');
assert.match(view, /exp <= nowSec/, 'expiry derived from EXPIRATION vs wall clock');
// Cancel + edit only for open orders.
assert.match(detail, /openAction\('cancel'\)/, 'offers cancel');
assert.match(detail, /openAction\('edit'\)/, 'offers edit');
assert.match(detail, /onEditOrder/, 'Edit opens the edit-order route');
assert.match(detail, /onCancelOrder/, 'Cancel opens the cancel-order route');
assert.match(detail, /canAct = status === 'open'/, 'cancel/edit gated on open');
assert.match(view, /software: \{ cancel: 'cancelOrder', edit: 'editOrder' \}/, 'cancel/edit route through cancelOrder / editOrder');
assert.match(view, /hardware: \{ cancel: 'cancelOrderHw', edit: 'editOrderHw' \}/, 'cancel/edit route through the device lanes');
assert.match(view, /<ActionConfirmScreen/, 'cancel/edit sign on the shared confirm page');
assert.match(view, /VERSION|EXPIRATION|ALLOW_LIST/, 'edit builds v2 params');
// The Form Standard frame: From (Network), Speed and Fees, one green action.
assert.match(form, /<FormFrame/, 'the forms use the Form Standard frame');
assert.match(form, /<FromSection/, 'the forms carry the From section with its Network field');
assert.match(form, /<FeeSection/, 'the forms carry Speed and Fees');
assert.match(form, /<FormAction/, 'the forms end on the one green action');
// PC-16 autopay toggle absorbed.
assert.match(view, /listAutopayOrders/, 'reads autopay consents');
assert.match(view, /setAutopayEnabled/, 'per-order autopay toggle');
assert.match(detail, /isNativeGive\(item\.row\)/, 'autopay toggle only on native-coin GIVE orders');

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
    assert.ok(surfacesEntry(src, 'my-orders', 'My orders'), `${shell.join('/')} lists a My orders action`);
    assert.ok(src.includes('OrderDetail'), `${shell.join('/')} imports OrderDetail`);
    assert.ok(src.includes("unlockedView === 'order-detail'"), `${shell.join('/')} routes order-detail`);
    assert.ok(src.includes("setUnlockedView('order-detail')"), `${shell.join('/')} opens order-detail from a row`);
    // Edit Order and Cancel Order are their own routes, opened from Order detail.
    for (const [route, component] of [['edit-order', 'EditOrderForm'], ['cancel-order', 'CancelOrderForm']]) {
        assert.ok(src.includes(component), `${shell.join('/')} imports ${component}`);
        assert.ok(src.includes(`unlockedView === '${route}'`), `${shell.join('/')} routes ${route}`);
        assert.ok(src.includes(`setUnlockedView('${route}')`), `${shell.join('/')} opens ${route} from Order detail`);
    }
}

// ---- Command palette ----
const palette = read('packages', 'core', 'src', 'shared', 'commandPalette', 'commandRegistry.js');
assert.match(palette, /id: 'nav-my-orders'.*go\('my-orders'\)/, 'palette has a My orders entry');

console.log('my-orders-view smoke: all assertions passed');
