// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 7 of 23: Staking dashboard (§42.7.4).

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

const dashPath = join(sharedRoutes, 'StakingDashboard.jsx');
assert.ok(existsSync(dashPath), 'StakingDashboard.jsx exists');
const dashSrc = readFileSync(dashPath, 'utf8');

// 1. Single-component export
assert.ok(/export function StakingDashboard\b/.test(dashSrc),
    'StakingDashboard is a named export');
assert.equal(
    (dashSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'StakingDashboard.jsx only exports the component',
);

// 2. BTC-only gate
assert.ok(/STAKING_COIN\s*=\s*['"]bitcoin['"]/.test(dashSrc),
    'StakingDashboard pins STAKING_COIN=bitcoin');
assert.ok(/byCoin\(STAKING_COIN\)/.test(dashSrc),
    'StakingDashboard resolves BTC chain IDs via the registry');
assert.ok(/Staking is available on Bitcoin only/.test(dashSrc),
    'StakingDashboard surfaces the BTC-only message when no BTC address exists');

// 3. Wiring
for (const call of [
    'messaging.getAddressesByChain',
    'messaging.getStakesForAddress',
    'messaging.getDelegationsForAddress',
    'messaging.getRewardsForAddress',
]) {
    assert.ok(dashSrc.includes(call), `StakingDashboard calls ${call}`);
}

// 4. Spec sections
for (const label of [
    'Your stake:',
    'Delegated pubkey:',
    'Pending rewards:',
    'Lifetime rewards:',
    'Recent reward events',
]) {
    assert.ok(dashSrc.includes(label), `StakingDashboard renders "${label}"`);
}
for (const action of ['Unstake', 'Delegate new key', 'Revoke delegation', 'Claim']) {
    assert.ok(dashSrc.includes(action), `StakingDashboard renders "${action}" button`);
}

// 5. Action buttons disabled when their on* props are absent
for (const prop of ['onUnstake', 'onDelegate', 'onRevokeDelegation', 'onClaimRewards']) {
    assert.ok(new RegExp(`disabled=\\{!${prop}`).test(dashSrc),
        `StakingDashboard disables action button when ${prop} is absent`);
}
assert.ok(/STAKE \/ UNSTAKE \/ DELEGATE \/ REVOKE \/ CLAIM forms land/.test(dashSrc),
    'StakingDashboard surfaces the "forms land in upcoming steps" note when no write props passed');

// 6. Core flows + guards
for (const name of [
    'stakesForAddress',
    'delegationsForAddress',
    'rewardsForAddress',
    'validatorsForChain',
]) {
    assert.equal(typeof flows[name], 'function',
        `flows.${name} is re-exported`);
}
await assert.rejects(
    async () => flows.stakesForAddress({ chainId: 'bitcoin-mainnet' }),
    /stakesForAddress: sdkRegistry is required/,
    'stakesForAddress guards sdkRegistry',
);
await assert.rejects(
    async () => flows.rewardsForAddress({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /rewardsForAddress: address is required/,
    'rewardsForAddress guards address',
);
await assert.rejects(
    async () => flows.validatorsForChain({ sdkRegistry: {} }),
    /validatorsForChain: chainId is required/,
    'validatorsForChain guards chainId',
);
{
    let called = null;
    const fakeSdk = { getStakes: (...a) => { called = a; return { data: [] }; } };
    await flows.stakesForAddress({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet',
        address: 'bc1q',
    });
    assert.deepEqual(called, ['bc1q', 'address', undefined]);
}

// 7. Background host + 3-shell messaging helpers
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
        'getValidatorsForChain',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// 8. Home + App.jsx wiring + BTC gate
const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/\bonStaking\b/.test(homeSrc), 'Home exposes onStaking prop');
assert.ok(/\{onStaking \?/.test(homeSrc),
    'Home renders the Staking button only when onStaking is passed');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('StakingDashboard'),
        `${shell} App.jsx imports StakingDashboard`);
    assert.ok(app.includes("'staking-dashboard'"),
        `${shell} tracks the staking-dashboard sub-route`);
    assert.ok(/onStaking=\{activeWalletId\s*&&\s*hasBtcAddress\s*\?\s*\(\)\s*=>\s*setUnlockedView\('staking-dashboard'\)\s*:\s*undefined\}/.test(app),
        `${shell} passes onStaking to Home only when activeWalletId && hasBtcAddress`);
}

console.log(
    'OK: staking dashboard smoke (StakingDashboard shared route + four staking flows + bg handlers + 3-shell messaging + Home onStaking + BTC gate via useBtcAddressesPresent)',
);
