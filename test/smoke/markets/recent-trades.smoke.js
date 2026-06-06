// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Phase 3 Step 5 smoke — Recent trades panel (§41.3.3).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

const panelPath = join(core, 'src', 'shared', 'components', 'RecentTradesPanel.jsx');
assert.ok(existsSync(panelPath), 'RecentTradesPanel.jsx exists');
const src = readFileSync(panelPath, 'utf8');
assert.ok(/export function RecentTradesPanel\b/.test(src),
    'RecentTradesPanel is a named export');
assert.ok(/messaging\.getMarketHistory\(/.test(src),
    'RecentTradesPanel fetches via messaging.getMarketHistory');
assert.ok(/MAX_ROWS\s*=\s*\d+/.test(src),
    'RecentTradesPanel caps to a MAX_ROWS window');
assert.ok(/buy|sell/i.test(src) && /side/.test(src),
    'RecentTradesPanel labels buy vs sell sides');
assert.ok(/onOpenTx/.test(src),
    'RecentTradesPanel exposes onOpenTx for future tx-detail nav');

console.log(
    'OK — recent-trades smoke (RecentTradesPanel §41.3.3 exists + fetches messaging.getMarketHistory + caps rows + labels buy/sell + onOpenTx callback reserved for tx detail)',
);
