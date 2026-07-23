// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the staking position detail page (§42.7.4 drill-in):
// StakeDetail, the standard hero / quick-actions / tabs layout with a
// validator variant (Claim / Unstake / Delegate / Revoke / Operator
// view) and a contract variant (Add stake / Unstake / Delegate key /
// View contract, slash events tab).

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

const detailPath = join(sharedRoutes, 'StakeDetail.jsx');
assert.ok(existsSync(detailPath), 'StakeDetail.jsx exists');
const src = readFileSync(detailPath, 'utf8');

// 1. Component export + kind switch
assert.ok(/export function StakeDetail\b/.test(src),
    'StakeDetail is a named export');
assert.ok(/'validator' \| 'contract'/.test(src),
    'StakeDetail documents the validator|contract kind prop');

// 2. Standard detail layout: hero details list, squared quick-action
// grid, tab strip (the DispenserDetail / TokenDetail rhythm).
assert.ok(/styles\.detailsList/.test(src), 'StakeDetail renders the hero details list');
assert.ok(/local\.quickActions/.test(src), 'StakeDetail renders the quick-action grid');
assert.ok(/local\.tabBar/.test(src), 'StakeDetail renders the tab strip');
assert.ok(/role="tablist"/.test(src), 'StakeDetail marks the tab strip as a tablist');

// 3. Validator variant: §42.7.4 data points + actions.
for (const label of [
    'Delegated key',
    'Pending rewards',
    'Lifetime rewards',
]) {
    assert.ok(src.includes(label), `StakeDetail renders "${label}"`);
}
for (const action of ['Claim', 'Unstake', 'Delegate', 'Revoke delegation', 'Operator view']) {
    assert.ok(src.includes(action), `StakeDetail offers "${action}"`);
}
for (const tab of ["id: 'rewards'", "id: 'delegation'", "id: 'details'"]) {
    assert.ok(src.includes(tab), `StakeDetail has validator tab ${tab}`);
}

// 4. Contract variant: positions/slashes tabs + slash destination
// surfaced prominently + contract actions.
for (const action of ['Add stake', 'View contract']) {
    assert.ok(src.includes(action), `StakeDetail offers "${action}"`);
}
for (const tab of ["id: 'positions'", "id: 'slashes'"]) {
    assert.ok(src.includes(tab), `StakeDetail has contract tab ${tab}`);
}
assert.ok(/Slash destination/.test(src),
    'StakeDetail surfaces the slash destination');
assert.ok(/cooldown_end_block/.test(src),
    'StakeDetail shows cooldown release blocks');

// 5. Handlers-absent buttons render disabled (house pattern).
for (const prop of ['onClaimRewards', 'onUnstake', 'onDelegate', 'onStakeMore']) {
    assert.ok(new RegExp(`disabled=\\{!${prop}`).test(src),
        `StakeDetail disables its button when ${prop} is absent`);
}

// 6. Data wiring: narrow per-position queries, silent contract-lane
// degrade, demo path.
for (const call of [
    'messaging.getStakesForAddress',
    'messaging.getDelegationsForAddress',
    'messaging.getRewardsForAddress',
    'messaging.getContractByActionIndex',
    'messaging.getContractStakesForAddress',
    'messaging.getContractUnstakesForAddress',
    'messaging.getSlashEventsForAddress',
]) {
    assert.ok(src.includes(call), `StakeDetail calls ${call}`);
}
assert.ok(/getContractStakesForAddress\([\s\S]{0,80}?\)\.catch\(\(\)\s*=>\s*\[\]\)/.test(src),
    'StakeDetail silently degrades contract-stake queries');
for (const call of ['isDemoWallet', 'synthesizeDemoStaking', 'synthesizeDemoContractStakes']) {
    assert.ok(src.includes(call), `StakeDetail uses ${call}`);
}

// 7. 3-shell App.jsx wiring: stake-detail view fed by stakingRef,
// validator actions to the existing forms, contract actions through
// contractRef with origin + initialMode, forms' onBack returning to
// the detail page.
for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('StakeDetail'), `${shell} App.jsx imports StakeDetail`);
    assert.ok(app.includes("'stake-detail'"), `${shell} tracks the stake-detail view`);
    assert.ok(/unlockedView === 'stake-detail' && activeWalletId && stakingRef/.test(app),
        `${shell} guards stake-detail on stakingRef`);
    assert.ok(/kind=\{stakingRef\.kind\}/.test(app),
        `${shell} passes stakingRef.kind through`);
    assert.ok(/onRevokeDelegation=\{\(\)\s*=>\s*setUnlockedView\('staking-revoke'\)\}/.test(app),
        `${shell} wires StakeDetail.onRevokeDelegation → staking-revoke`);
    assert.ok(/onClaimRewards=\{\(\)\s*=>\s*setUnlockedView\('staking-claim'\)\}/.test(app),
        `${shell} wires StakeDetail.onClaimRewards → staking-claim`);
    assert.ok(/onOpenOperatorDashboard=\{\(\)\s*=>\s*setUnlockedView\('operator-dashboard'\)\}/.test(app),
        `${shell} wires StakeDetail.onOpenOperatorDashboard → operator-dashboard`);
    assert.ok(/initialMode:\s*'unstake'/.test(app),
        `${shell} preselects unstake mode for contract-position Unstake`);
    // The write forms launched from the detail page return to it.
    for (const view of ['staking-unstake', 'staking-claim', 'staking-delegate', 'staking-revoke']) {
        const block = app.split(`unlockedView === '${view}'`)[1]?.split('unlockedView ===')[0] || '';
        assert.ok(block.includes("setUnlockedView('stake-detail')"),
            `${shell} returns from ${view} to stake-detail`);
    }
}

console.log(
    'OK: stake detail smoke (StakeDetail hero/quick-actions/tabs + validator & contract variants + disabled-when-absent + silent contract-lane degrade + 3-shell wiring with detail-returning back-nav)',
);
