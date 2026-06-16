// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the shared chain-visibility helper. Single source of truth
// for "should this chain show in user-facing pickers"; filters out
// regtest unless developerMode is on.

import { strict as assert } from 'node:assert';
import { registry as registryLib } from '../../../packages/core/src/index.js';

const r = registryLib.defaultRegistry();
const all = r.supportedChains();
const regtest = all.filter((d) => d.networkKind === 'regtest');
assert.ok(regtest.length > 0, 'fixture: registry includes at least one regtest descriptor');

const visibleDefault = registryLib.filterChainsForUser(all, { developerMode: false });
assert.equal(
    visibleDefault.filter((d) => d.networkKind === 'regtest').length,
    0,
    'regtest hidden by default',
);
assert.equal(
    visibleDefault.length,
    all.length - regtest.length,
    'count drops by exactly the regtest descriptor count',
);

const visibleDev = registryLib.filterChainsForUser(all, { developerMode: true });
assert.equal(visibleDev.length, all.length, 'developer mode reveals all chains');

const visibleNullSettings = registryLib.filterChainsForUser(all, null);
assert.equal(
    visibleNullSettings.filter((d) => d.networkKind === 'regtest').length,
    0,
    'null settings → regtest hidden (cold start fallback)',
);

assert.equal(
    registryLib.isChainVisibleToUser(regtest[0], { developerMode: true }),
    true,
);
assert.equal(
    registryLib.isChainVisibleToUser(regtest[0], { developerMode: false }),
    false,
);
const mainnet = all.find((d) => d.networkKind === 'mainnet');
assert.equal(
    registryLib.isChainVisibleToUser(mainnet, { developerMode: false }),
    true,
);

console.log('chain-visibility smoke OK');
