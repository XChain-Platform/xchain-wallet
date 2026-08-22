// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the redesigned staking root (§42.7.4): StakingList, the
// unified validator + contract positions list that replaced the old
// StakingDashboard under the same 'staking-dashboard' view id.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const listPath = join(sharedRoutes, 'StakingList.jsx');
assert.ok(existsSync(listPath), 'StakingList.jsx exists');
const listSrc = readFileSync(listPath, 'utf8');

// The old dashboard is gone; the list fully replaced it.
assert.ok(!existsSync(join(sharedRoutes, 'StakingDashboard.jsx')),
    'StakingDashboard.jsx is retired');
assert.ok(!existsSync(join(sharedRoutes, 'ContractStakedPositions.jsx')),
    'ContractStakedPositions.jsx is retired (absorbed by StakingList/StakeDetail)');

// 1. Component export
assert.ok(/export function StakingList\b/.test(listSrc),
    'StakingList is a named export');

// 2. two-lane chain reach. Contract staking (STAKE v3 / UNSTAKE v1 /
// DELEGATE v1) runs on every chain the registry advertises STAKE on, because
// the indexer dispatches those versions ahead of its `COIN !== 'BTC'` gate.
// Validator (capability) staking, its delegations, and the rewards COLLECT
// pays out stay Bitcoin-only, so that lane is SKIPPED off Bitcoin rather than
// fired at explorers that can only answer empty.
assert.ok(/VALIDATOR_COIN\s*=\s*['"]bitcoin['"]/.test(listSrc),
    'StakingList pins the validator lane to bitcoin');
// The list is read from the LIVE registry (useSupportedChains re-renders on a
// descriptor mutation), never memoised once at mount, so a synced descriptor
// that adds STAKE reaches the dashboard without a restart.
assert.ok(/useSupportedChains\(chainRegistry\)[\s\S]{0,400}includes\('STAKE'\)/.test(listSrc),
    'StakingList derives its staking chains from the live registry, not a hardcoded coin');
assert.ok(/validatorChainIds\s*=\s*useMemo/.test(listSrc)
    && /coin === VALIDATOR_COIN/.test(listSrc),
    'StakingList resolves the validator-lane chain IDs via the registry');
assert.ok(/const isValidatorChain = validatorChainIds\.has\(cid\)/.test(listSrc)
    && /\.\.\.\(isValidatorChain \? \[/.test(listSrc),
    'validator-lane queries are gated on the chain, not issued everywhere');
assert.ok(/getContractStakesForAddress/.test(listSrc)
    && !/isValidatorChain \? \[[\s\S]*getContractStakesForAddress[\s\S]*\] : \[\]/.test(listSrc),
    'the contract lane runs on every staking chain (outside the validator gate)');
assert.ok(!/Staking is available on Bitcoin only/.test(listSrc),
    'the stale BTC-only empty state is gone');

// 3. Data wiring: validator lane + contract lane (contract queries are
// best-effort until the Phase 7 explorer/SDK endpoints land, so they
// must degrade silently instead of erroring the page).
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getStakesForAddress',
    'messaging.getDelegationsForAddress',
    'messaging.getRewardsForAddress',
    'messaging.getContractStakesForAddress',
    'messaging.getContractUnstakesForAddress',
]) {
    assert.ok(listSrc.includes(call), `StakingList calls ${call}`);
}
assert.ok(/getContractStakesForAddress[\s\S]{0,220}?\.catch\(\(\)\s*=>\s*\{\}\)/.test(listSrc),
    'StakingList silently degrades the contract-stakes lane on error');
assert.ok(/getContractUnstakesForAddress[\s\S]{0,220}?\.catch\(\(\)\s*=>\s*\{\}\)/.test(listSrc),
    'StakingList silently degrades the contract-unstakes lane on error');

// 4. Demo-wallet path renders synthesized validator + contract rows.
for (const call of ['isDemoWallet', 'synthesizeDemoStaking', 'synthesizeDemoContractStakes']) {
    assert.ok(listSrc.includes(call), `StakingList uses ${call}`);
}

// 5. List-pattern chrome: header "+", search, network filter, rows
// that hand a { kind, chainId, address, contractActionIndex? } ref up.
assert.ok(/NetworkFilterDropdown/.test(listSrc),
    'StakingList renders the network filter dropdown');
assert.ok(/aria-label="Search staking positions"/.test(listSrc),
    'StakingList renders the free-text search input');
assert.ok(/local\.addBtn/.test(listSrc) && /Icon\.PlusIcon/.test(listSrc),
    'StakingList renders the header "+" (new stake) button');
assert.ok(/aria-label="New stake"/.test(listSrc),
    'StakingList labels the "+" button');
assert.ok(/onNewStake/.test(listSrc), 'StakingList exposes onNewStake');
assert.ok(/onOpenStake\(row\.ref\)/.test(listSrc),
    'StakingList rows hand their position ref to onOpenStake');
assert.ok(/kind:\s*'validator'/.test(listSrc) && /kind:\s*'contract'/.test(listSrc),
    'StakingList builds both validator and contract row refs');
assert.ok(/coinFromChainId/.test(listSrc),
    'StakingList filters rows by coin family');

// 6. §42.7.4 at-a-glance rewards stay on the root, as a per-row chip
// on the validator rows (the root is kind-neutral: no page-level
// pending/lifetime strip, that detail lives on StakeDetail).
assert.ok(/rewardChip/.test(listSrc) && /XCHAIN reward/.test(listSrc),
    'StakingList surfaces unclaimed rewards as a per-row chip');
assert.ok(!/Pending rewards/.test(listSrc),
    'StakingList has no page-level pending/lifetime rewards strip');

// 6b. Display numbers are comma-grouped.
assert.ok(/formatWithThousands/.test(listSrc),
    'StakingList comma-groups displayed amounts');

// 7. Core flows + guards (unchanged data layer).
for (const name of [
    'stakesForAddress',
    'delegationsForAddress',
    'rewardsForAddress',
    'validatorsForChain',
    'contractStakesForAddress',
    'contractUnstakesForAddress',
]) {
    assert.equal(typeof flows[name], 'function',
        `flows.${name} is re-exported`);
}
await assert.rejects(
    async () => flows.stakesForAddress({ chainId: 'bitcoin-mainnet' }),
    /stakesForAddress: sdkRegistry is required/,
    'stakesForAddress guards sdkRegistry',
);

// 8. Background host + 3-shell messaging helpers.
const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of [
    "'stakes.forAddress'",
    "'delegations.forAddress'",
    "'rewards.forAddress'",
    "'validators.forChain'",
]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'getStakesForAddress',
        'getDelegationsForAddress',
        'getRewardsForAddress',
        'getContractStakesForAddress',
        'getContractUnstakesForAddress',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// 9. Home + App.jsx wiring + BTC gate. The view id stays
// 'staking-dashboard' so nav groups, the command palette, and view
// resume all keep working.
const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/\bonStaking\b/.test(homeSrc), 'Home exposes onStaking prop');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('StakingList'),
        `${shell} App.jsx imports StakingList`);
    assert.ok(!app.includes('StakingDashboard'),
        `${shell} App.jsx no longer references StakingDashboard`);
    assert.ok(!app.includes('ContractStakedPositions'),
        `${shell} App.jsx no longer references ContractStakedPositions`);
    assert.ok(app.includes("'staking-dashboard'"),
        `${shell} tracks the staking-dashboard root view`);
    assert.ok(/onOpenStake=\{\(ref\)\s*=>\s*\{\s*setStakingRef\(ref\);\s*setUnlockedView\('stake-detail'\)/.test(app),
        `${shell} wires StakingList.onOpenStake → stake-detail with ref`);
    assert.ok(/onNewStake=\{\(\)\s*=>\s*setUnlockedView\('stake-new'\)\}/.test(app),
        `${shell} wires StakingList.onNewStake → stake-new`);
    assert.ok(/onStaking=\{activeWalletId\s*&&\s*hasBtcAddress\s*\?\s*\(\)\s*=>\s*setUnlockedView\('staking-dashboard'\)\s*:\s*undefined\}/.test(app),
        `${shell} passes onStaking to Home only when activeWalletId && hasBtcAddress`);
}

// 10. View-resume safety: only the root is resumable; the ref-dependent
// sub-views must stay out of RESUMABLE_VIEWS (resuming them with a null
// stakingRef would dead-end).
const lastView = readFileSync(
    join(core, 'src', 'shared', 'utils', 'lastViewMemory.js'), 'utf8');
assert.ok(/'staking-dashboard'/.test(lastView),
    'staking-dashboard stays in RESUMABLE_VIEWS');
assert.ok(!/'stake-detail'/.test(lastView) && !/'stake-new'/.test(lastView),
    'stake-detail / stake-new are not resumable (they need stakingRef)');

console.log(
    'OK: staking list smoke (StakingList unified validator+contract rows + search/network filter + header "+" + silent contract-lane degrade + flows + bg handlers + 3-shell messaging + Home onStaking + resume safety)',
);
