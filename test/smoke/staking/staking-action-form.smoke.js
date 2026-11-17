// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 9 of 23: UNSTAKE + COLLECT forms
// (§42.7.2 unstake-lane + §42.7.3).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const platformRoot = join(wsRoot, '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// Validator Unstake and Claim are actions of the one Staking form
// (StakingForm.jsx); the old StakingActionForm.jsx is gone.
const formPath = join(sharedRoutes, 'StakingForm.jsx');
assert.ok(existsSync(formPath), 'StakingForm.jsx exists');
assert.ok(!existsSync(join(sharedRoutes, 'StakingActionForm.jsx')),
    'StakingActionForm.jsx is merged into StakingForm.jsx');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakingForm\b/.test(formSrc),
    'StakingForm is a named export');
const actionRow = (key) => formSrc.split(`'${key}': {`)[1]?.split(/\n    '[a-z]+:[a-z-]+': \{/)[0] || '';
const unstakeRow = actionRow('network:unstake');
const claimRow = actionRow('network:claim-rewards');

// Action rows + branching.
assert.ok(unstakeRow && claimRow, 'StakingForm has network unstake and claim action rows');
assert.ok(/currentAction\s*===\s*['"]unstake['"]/.test(formSrc),
    'StakingForm branches on the unstake action');
assert.ok(/verb:\s*'Unstake'/.test(unstakeRow) && /verb:\s*'Claim Rewards'/.test(claimRow),
    'StakingForm names both verbs');
assert.ok(/amount:\s*'position'/.test(unstakeRow) && /amount:\s*'position'/.test(claimRow),
    'Unstake and Claim judge their amount against a known position total');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `StakingActionForm tracks '${stage}' stage`);
}

// Capability-staking model: UNSTAKE addresses a signing pubkey, not a tier.
assert.ok(!/Tier 1/.test(formSrc) && !/Tier 2/.test(formSrc),
    'StakingActionForm does not surface tier labels (capability-staking model dropped tiers)');
assert.ok(/key:\s*\{\s*label:\s*'Signing public key'/.test(unstakeRow) && /label=\{cfg\.key\.label\}/.test(formSrc),
    'StakingForm renders a Signing public key input for unstake');
// The wire params are built by stakingActionParams in the flows module, so
// the route file keeps exporting only the component.
const flowSrc = readFileSync(join(core, 'src', 'flows', 'unstakeClaimActions.js'), 'utf8');
assert.ok(/stakingActionParams\(/.test(formSrc),
    'StakingActionForm builds its params through stakingActionParams');
assert.ok(/SIGNING_PUBKEY:\s*String\(signingPubkey\)\.trim/.test(flowSrc),
    'stakingActionParams passes SIGNING_PUBKEY in action params');

// partial claim/unstake: the Amount field is editable (real
// change handler, not a pinned no-op) and a strict partial threads
// AMOUNT into the action params; a full-balance submit keeps the
// legacy absent-AMOUNT bytes.
assert.ok(!formSrc.includes('onAmountFieldChange={() => {}}'),
    'StakingActionForm Amount field is no longer a pinned no-op');
assert.ok(/onAmountFieldChange=\{onAmountFieldChange\}/.test(formSrc),
    'StakingActionForm wires a real onAmountFieldChange handler');
assert.ok(/AMOUNT:\s*normalizedAmount/.test(flowSrc),
    'stakingActionParams threads AMOUNT into the params for a partial');
assert.ok(/isPartial/.test(formSrc),
    'StakingActionForm distinguishes partial vs full (legacy bytes) submits');
assert.ok(/Enter an amount greater than zero/.test(formSrc),
    'StakingActionForm validates amount > 0');
assert.ok(/disabled=\{[^}]*!totalKnown/.test(formSrc) && /TOTAL_LOADING_MESSAGE/.test(formSrc),
    'StakingActionForm blocks submit until the total it judges the amount against is known');
assert.ok(/Amount exceeds the/.test(formSrc),
    'StakingActionForm validates amount <= available');
assert.ok(!/coming soon/.test(formSrc),
    'StakingActionForm no longer shows the pinned-amount banner');

// Wiring of all four messaging helpers + shared chassis.
assert.ok(/software:\s*'unstakeAction'/.test(unstakeRow) && /hardware:\s*'unstakeActionHw'/.test(unstakeRow),
    'Unstake signs through unstakeAction and unstakeActionHw');
assert.ok(/software:\s*'collectAction'/.test(claimRow) && /hardware:\s*'collectActionHw'/.test(claimRow),
    'Claim signs through collectAction and collectActionHw');
assert.ok(/wire:\s*'UNSTAKE'/.test(unstakeRow) && /wire:\s*'COLLECT'/.test(claimRow),
    'Unstake composes UNSTAKE and Claim composes COLLECT');
assert.ok(/full:\s*true/.test(unstakeRow) && /full:\s*true/.test(claimRow),
    'Unstake and Claim pass the explicit whole-balance request');
for (const call of [
    'messaging[cfg.software]',
    'messaging[cfg.hardware]',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `StakingForm calls ${call}`);
}

// Wrong-password handling.
assert.ok(/InvalidPasswordError/.test(formSrc),
    'StakingActionForm distinguishes wrong-password');

// --- Core flow guards ---

assert.equal(typeof flows.unstakeAction, 'function', 'flows.unstakeAction re-exported');
assert.equal(typeof flows.collectAction, 'function', 'flows.collectAction re-exported');

await assert.rejects(
    async () => flows.unstakeAction({}),
    /unstakeAction: params is required/,
    'unstakeAction guards params',
);
await assert.rejects(
    async () => flows.unstakeAction({ params: {} }),
    /unstakeAction: params\.SIGNING_PUBKEY is required/,
    'unstakeAction guards SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.unstakeAction({ params: { SIGNING_PUBKEY: 'not-hex' } }),
    /SIGNING_PUBKEY must be 64 hex chars/,
    'unstakeAction validates SIGNING_PUBKEY format',
);

await assert.rejects(
    async () => flows.collectAction({}),
    /collectAction: params is required/,
    'collectAction guards params',
);

// optional AMOUNT guards: present => positive decimal.
await assert.rejects(
    async () => flows.unstakeAction({ params: { SIGNING_PUBKEY: 'a'.repeat(64), AMOUNT: '-1' } }),
    /AMOUNT must be a positive decimal/,
    'unstakeAction rejects a non-decimal AMOUNT',
);
await assert.rejects(
    async () => flows.unstakeAction({ params: { SIGNING_PUBKEY: 'a'.repeat(64), AMOUNT: '0' } }),
    /AMOUNT must be a positive decimal/,
    'unstakeAction rejects AMOUNT of zero',
);
await assert.rejects(
    async () => flows.collectAction({ params: { VERSION: '0', AMOUNT: '0' } }),
    /AMOUNT must be a positive decimal/,
    'collectAction rejects AMOUNT of zero',
);
await assert.rejects(
    async () => flows.contractStakeAction({
        mode: 'unstake',
        params: {
            SIGNING_PUBKEY: 'a'.repeat(64),
            TARGET_CONTRACT_INDEX: '7',
            TICK: 'XCHAIN',
            AMOUNT: '0',
        },
    }),
    /AMOUNT must be greater than 0/,
    'contractStakeAction (unstake) rejects AMOUNT of zero',
);

// Contract v1 lane of the same form: a contract unstake shows the amount
// field and threads the optional partial AMOUNT.
const contractUnstakeRow = actionRow('contract:unstake');
assert.ok(/amount:\s*'contract'/.test(contractUnstakeRow),
    'StakingForm renders the Amount field for a contract unstake too');
assert.ok(/currentAction === 'unstake' && amount\.trim\(\) !== ''/.test(formSrc),
    'StakingForm threads an optional partial AMOUNT for a contract unstake');
assert.ok(/stakedAvailable/.test(formSrc),
    'StakingForm bounds the contract unstake amount by the staked balance');

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of ["'action.unstake'", "'action.collect'"]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.unstake\.hw', unstakeAction\)/.test(bg),
    'background host registers action.unstake.hw');
assert.ok(/registerHwHandler\('action\.collect\.hw', collectAction\)/.test(bg),
    'background host registers action.collect.hw');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['unstakeAction', 'unstakeActionHw', 'collectAction', 'collectActionHw']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// --- App.jsx wiring ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes("import('@xchain-wallet/core/shared/routes/StakingForm.jsx')"),
        `${shell} App.jsx loads StakingForm`);
    assert.ok(app.includes("'staking-unstake'"),
        `${shell} tracks staking-unstake sub-route`);
    assert.ok(app.includes("'staking-claim'"),
        `${shell} tracks staking-claim sub-route`);
    // Validator-kind quick actions on StakeDetail open the two form
    // views; both forms return to the detail page they came from.
    assert.ok(/:\s*\(\)\s*=>\s*setUnlockedView\('staking-unstake'\)\}/.test(app),
        `${shell} wires StakeDetail.onUnstake (validator arm) → staking-unstake`);
    assert.ok(/onClaimRewards=\{\(\)\s*=>\s*setUnlockedView\('staking-claim'\)\}/.test(app),
        `${shell} wires StakeDetail.onClaimRewards → staking-claim`);
    for (const [view, action] of [['staking-unstake', 'unstake'], ['staking-claim', 'claim-rewards']]) {
        const block = app.split(`unlockedView === '${view}'`)[1]?.split('unlockedView ===')[0] || '';
        assert.ok(new RegExp(`<StakingForm\\b[\\s\\S]*kind: 'network'[\\s\\S]*action="${action}"`).test(block),
            `${shell} ${view} opens the Staking form on action="${action}"`);
    }
}

console.log(
    'OK: staking action form smoke (StakingForm unstake|claim-rewards + capability-model pubkey-based unstake + partial amount editing/threading + bg handlers + 3-shell messaging + two App.jsx sub-routes wired from StakeDetail)',
);
