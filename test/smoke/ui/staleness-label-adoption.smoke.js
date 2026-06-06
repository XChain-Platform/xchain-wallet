// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §49.3 / G155 / Cluster G FOLLOWUP 5 — StalenessLabel adoption
// across BalanceList (via Home → HomeTabs), History, and TokenDetail.
//
// Verifies that each surface tracks its own lastFetchedAt timestamp and
// renders <StalenessLabel> only after a successful fetch (never before
// — §49.3: never fabricate data).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const components = join(core, 'src', 'shared', 'components');
const routes = join(core, 'src', 'shared', 'routes');

// --- 1. Home.jsx tracks balancesFetchedAt --------------------------------

const homeSrc = readFileSync(join(routes, 'Home.jsx'), 'utf8');
assert.ok(
    /balancesFetchedAt/.test(homeSrc),
    'Home tracks balancesFetchedAt state',
);
assert.ok(
    /setBalances\(b\);\s*\n\s*setBalancesFetchedAt\(Date\.now\(\)\);/.test(homeSrc)
        || /setBalances\(b\);[\s\S]{0,80}setBalancesFetchedAt\(Date\.now\(\)\)/.test(homeSrc),
    'Home stamps balancesFetchedAt right after setBalances on success',
);
assert.ok(
    /setBalancesFetchedAt\(null\)/.test(homeSrc),
    'Home resets balancesFetchedAt to null when wiping balances on wallet/account switch',
);
assert.ok(
    /<HomeTabs[\s\S]+?balancesFetchedAt=\{balancesFetchedAt\}/.test(homeSrc),
    'Home threads balancesFetchedAt into <HomeTabs>',
);

// --- 2. HomeTabs renders <StalenessLabel> -------------------------------

const homeTabsSrc = readFileSync(join(components, 'HomeTabs.jsx'), 'utf8');
assert.ok(
    /from\s*['"]\.\/StalenessLabel\.jsx['"]/.test(homeTabsSrc),
    'HomeTabs imports StalenessLabel',
);
assert.ok(
    /\bbalancesFetchedAt\b/.test(homeTabsSrc),
    'HomeTabs accepts balancesFetchedAt prop',
);
assert.ok(
    /<StalenessLabel\s+lastSyncedAt=\{balancesFetchedAt\}/.test(homeTabsSrc),
    'HomeTabs renders <StalenessLabel> bound to balancesFetchedAt',
);
assert.ok(
    /active === 'coins' \|\| active === 'tokens' \|\| active === 'nfts'/.test(homeTabsSrc),
    'HomeTabs gates the staleness label to balance-driven tabs only (skips Activity / DeFi placeholders)',
);

// --- 3. History.jsx tracks historyFetchedAt -----------------------------

const historySrc = readFileSync(join(routes, 'History.jsx'), 'utf8');
assert.ok(
    /from\s*['"]\.\.\/components\/StalenessLabel\.jsx['"]/.test(historySrc),
    'History imports StalenessLabel',
);
assert.ok(
    /historyFetchedAt/.test(historySrc),
    'History tracks historyFetchedAt state',
);
assert.ok(
    /setEntries\(all\);\s*\n\s*setLoadingChains\(new Set\(\)\);\s*\n\s*setHistoryFetchedAt\(Date\.now\(\)\);/.test(historySrc),
    'History stamps historyFetchedAt after the per-chain fan-out completes',
);
assert.ok(
    /setHistoryFetchedAt\(null\)/.test(historySrc),
    'History resets historyFetchedAt when no chains are selected',
);
assert.ok(
    /<StalenessLabel\s+lastSyncedAt=\{historyFetchedAt\}/.test(historySrc),
    'History renders <StalenessLabel> bound to historyFetchedAt',
);
assert.ok(
    /historyFetchedAt && loadingChains\.size === 0/.test(historySrc),
    'History only renders the staleness row once a fetch has settled and no chain is loading',
);

// --- 4. TokenDetail tracks holdersFetchedAt ------------------------------

const tdPath = join(routes, 'TokenDetail.jsx');
assert.ok(existsSync(tdPath), 'TokenDetail.jsx exists');
const tdSrc = readFileSync(tdPath, 'utf8');
assert.ok(
    /from\s*['"]\.\.\/components\/StalenessLabel\.jsx['"]/.test(tdSrc),
    'TokenDetail imports StalenessLabel',
);
assert.ok(
    /holdersFetchedAt/.test(tdSrc),
    'TokenDetail tracks holdersFetchedAt',
);
assert.ok(
    /setHolders\(list\);\s*\n\s*setHoldersFetchedAt\(Date\.now\(\)\);/.test(tdSrc),
    'TokenDetail stamps holdersFetchedAt right after a successful holders load',
);
assert.ok(
    /<StalenessLabel\s+lastSyncedAt=\{holdersFetchedAt\}/.test(tdSrc),
    'TokenDetail renders <StalenessLabel> bound to holdersFetchedAt',
);
assert.ok(
    /holdersFetchedAt && !holdersLoading && !holdersError/.test(tdSrc),
    'TokenDetail only renders the staleness label after a successful holders load',
);

console.log('staleness-label-adoption smoke OK');
