// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-47 (claimable / cooldown dashboards).
//
// Asserts:
//   1. The unclaimed total is accrued minus VALID claims - the same sum the
//      indexer computes - and the claim ledger is wired end to end (flow +
//      host route + all three shells), since without it the figure cannot be
//      computed at all.
//   2. StakeDetail's "pending rewards" no longer keys on a per-row status.
//      That column does not exist on validator_rewards, which left the Claim
//      button permanently disabled; this pins the regression.
//   3. StakingList surfaces the claimable banner with a Claim deep-link and a
//      reward-pool solvency note.
//   4. Cooldown maturity is read from the chain-stamped cooldown_end_block
//      rather than re-derived wallet-side from a cooldown constant.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const routes = join(core, 'src', 'shared', 'routes');
const read = (p) => readFileSync(p, 'utf8');

// 1: the sum, and the claim ledger behind it.
const flowPath = join(core, 'src', 'flows', 'stakingDashboard.js');
assert.ok(existsSync(flowPath), 'stakingDashboard.js exists');
for (const fn of ['unclaimedRewards', 'cooldownStatus', 'cooldownText']) {
    assert.equal(typeof flows[fn], 'function', `${fn} is exported from the flows barrel`);
}
assert.equal(typeof flows.rewardClaimsForAddress, 'function', 'rewardClaimsForAddress is exported from the flows barrel');

// Only valid claims subtract. This is the behavioural core, so assert it.
const refused = flows.unclaimedRewards({
    rewards: [{ amount: '10' }],
    claims: [{ amount: '10', status: 'invalid: insufficient reward pool' }],
});
assert.equal(refused.unclaimed, '10', 'a refused claim leaves the rewards claimable');
assert.equal(refused.hasRejectedClaim, true, 'a refused claim is surfaced to the caller');
assert.equal(
    flows.unclaimedRewards({ rewards: [{ amount: '10' }], claims: [{ amount: '4', status: 'valid' }] }).unclaimed,
    '6',
    'a valid claim subtracts',
);

assert.ok(
    /host\.register\('rewardClaims\.forAddress'/.test(
        read(join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js')),
    ),
    'background host registers rewardClaims.forAddress',
);
for (const shell of [
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
]) {
    assert.ok(
        /export function getRewardClaimsForAddress\(/.test(read(shell)),
        `${shell.split('/packages/')[1]}: exposes getRewardClaimsForAddress`,
    );
}

// 2: the StakeDetail Claim-button regression.
const detailSrc = read(join(routes, 'StakeDetail.jsx'));
assert.ok(
    !/status === 'pending' \|\| status === 'unclaimed'/.test(detailSrc),
    'pending rewards no longer key on a per-row status (validator_rewards has no status column)',
);
assert.ok(
    /unclaimedRewards\(\{ rewards: rows, claims: claimRows \}\)/.test(detailSrc),
    'pending rewards come from the canonical accrued-minus-valid-claims sum',
);
assert.ok(
    /getRewardClaimsForAddress/.test(detailSrc),
    'StakeDetail fetches the claim ledger it needs for that sum',
);

// 3: the StakingList banner.
const listSrc = read(join(routes, 'StakingList.jsx'));
assert.ok(/ready to claim/.test(listSrc), 'the claimable banner states what the figure is');
assert.ok(
    /firstValidatorRef \? \([\s\S]{0,200}Claim<\/Button>/.test(listSrc),
    'the banner offers a Claim control that deep-links to the validator detail page',
);
assert.ok(
    /reward pool is short/.test(listSrc),
    'the reward-pool solvency note explains why a claim can be refused',
);
assert.ok(
    /An earlier claim was refused by the network/.test(listSrc),
    'a previously-refused claim is called out rather than silently folded in',
);

// 4: cooldown comes from the chain, not a wallet-side constant.
const flowSrc = read(flowPath);
assert.ok(
    /cooldown_end_block/.test(flowSrc) && /cooldown_end_block/.test(listSrc),
    'maturity is read from the chain-stamped end block',
);
// Strip comments first: the module DOCUMENTS why it doesn't re-derive the
// cooldown, so the prose legitimately names these while the code must not.
const flowCode = flowSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const wrong of ['COOLDOWN_BLOCKS', 'cooldownBlocks', 'DEFAULT_COOLDOWN']) {
    assert.ok(
        !new RegExp(wrong).test(flowCode),
        `no wallet-side cooldown constant in code (${wrong}): the indexer already resolved the per-lane value`,
    );
}
assert.ok(
    /endBlock <= 0/.test(flowSrc),
    'a zero end block reads as unknown, not as matured long ago',
);
assert.ok(
    /getIndexerWatermark/.test(listSrc),
    'the countdown is driven by the chain tip',
);

console.log(
    'OK: claimable/cooldown dashboard smoke (PC-47: valid-claims-only sum + claim ledger wiring + StakeDetail Claim regression + banner with solvency note + chain-stamped cooldown)',
);
