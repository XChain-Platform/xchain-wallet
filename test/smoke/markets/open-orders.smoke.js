// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Phase 3 Step 7 smoke: Open orders + cancel (§41.3.5).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

const panelPath = join(core, 'src', 'shared', 'components', 'OpenOrdersPanel.jsx');
assert.ok(existsSync(panelPath), 'OpenOrdersPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function OpenOrdersPanel\b/.test(src),
    'OpenOrdersPanel is a named export');
assert.ok(/messaging\.getMarketOrders\(/.test(src),
    'OpenOrdersPanel fetches via messaging.getMarketOrders per-address');
assert.ok(/useOwnerActionLane/.test(src)
    && /software:\s*'cancelOrder'/.test(src)
    && /hardware:\s*'cancelOrderHw'/.test(src),
    'OpenOrdersPanel routes cancellation through the shared owner-action lane');
assert.ok(/<ActionConfirmScreen/.test(src) && /if \(cancelLane\.open\)/.test(src),
    'OpenOrdersPanel replaces its content with the shared confirmation screen');
assert.ok(/action:\s*'ORDER'/.test(src)
    && /ORDER_ACTION_INDEX:\s*orderActionIndex/.test(src),
    'OpenOrdersPanel composes the ORDER cancel before signing');
assert.ok(/POLL_INTERVAL_MS\s*=\s*5000/.test(src),
    'OpenOrdersPanel polls every 5s');
assert.ok(/document\.visibilityState === 'hidden'/.test(src),
    'OpenOrdersPanel pauses polling when the tab is hidden');
assert.ok(/variant="danger"/.test(src),
    'Cancel button renders as danger variant');

console.log(
    'OK: open-orders smoke (OpenOrdersPanel §41.3.5 fetches getMarketOrders per wallet address; polls every 5s with visibilitychange pause; cancel composes through useOwnerActionLane and replaces the panel with ActionConfirmScreen; danger-variant Cancel button)',
);
