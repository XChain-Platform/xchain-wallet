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

const formPath = join(sharedRoutes, 'StakingActionForm.jsx');
assert.ok(existsSync(formPath), 'StakingActionForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakingActionForm\b/.test(formSrc),
    'StakingActionForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'StakingActionForm.jsx only exports the component',
);

// Mode prop + branching.
assert.ok(/mode\s*===\s*['"]unstake['"]/.test(formSrc),
    'StakingActionForm branches on mode === unstake');
assert.ok(/Unstake|Claim rewards/.test(formSrc),
    'StakingActionForm renders both verbs');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `StakingActionForm tracks '${stage}' stage`);
}

// Capability-staking model: UNSTAKE addresses a signing pubkey, not a tier.
assert.ok(!/Tier 1/.test(formSrc) && !/Tier 2/.test(formSrc),
    'StakingActionForm does not surface tier labels (capability-staking model dropped tiers)');
assert.ok(/label="Signing public key"/.test(formSrc),
    'StakingActionForm renders a Signing public key input for unstake');
assert.ok(/SIGNING_PUBKEY:\s*signingPubkey\.trim/.test(formSrc),
    'StakingActionForm passes SIGNING_PUBKEY in action params');

//  partial claim/unstake: the Amount field is editable (real
// change handler, not a pinned no-op) and a strict partial threads
// AMOUNT into the action params; a full-balance submit keeps the
// legacy absent-AMOUNT bytes.
assert.ok(!formSrc.includes('onAmountFieldChange={() => {}}'),
    'StakingActionForm Amount field is no longer a pinned no-op');
assert.ok(/onAmountFieldChange=\{onAmountFieldChange\}/.test(formSrc),
    'StakingActionForm wires a real onAmountFieldChange handler');
assert.ok(/AMOUNT:\s*String\(amount\)/.test(formSrc),
    'StakingActionForm threads AMOUNT into actionParams for a partial');
assert.ok(/isPartial/.test(formSrc),
    'StakingActionForm distinguishes partial vs full (legacy bytes) submits');
assert.ok(/Amount must be greater than zero/.test(formSrc),
    'StakingActionForm validates amount > 0');
assert.ok(/Amount exceeds the/.test(formSrc),
    'StakingActionForm validates amount <= available');
assert.ok(!/coming soon/.test(formSrc),
    'StakingActionForm no longer shows the pinned-amount banner');

// Wiring of all four messaging helpers + shared chassis.
for (const call of [
    'messaging.unstakeAction',
    'messaging.unstakeActionHw',
    'messaging.collectAction',
    'messaging.collectActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `StakingActionForm calls ${call}`);
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

//  optional AMOUNT guards: present => positive decimal.
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

// ContractStakeForm v1 lane: unstake mode renders the amount field and
// threads the optional partial AMOUNT.
const csfSrc = readFileSync(join(sharedRoutes, 'ContractStakeForm.jsx'), 'utf8');
assert.ok(/mode === 'stake' \|\| mode === 'unstake' \?/.test(csfSrc),
    'ContractStakeForm renders the Amount field for unstake mode too');
assert.ok(/mode === 'unstake' && amount\.trim\(\) !== ''/.test(csfSrc),
    'ContractStakeForm threads an optional partial AMOUNT for unstake');
assert.ok(/stakedAvailable/.test(csfSrc),
    'ContractStakeForm bounds the unstake amount by the staked balance');

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
    assert.ok(app.includes('StakingActionForm'),
        `${shell} App.jsx imports StakingActionForm`);
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
    assert.ok(/mode="unstake"/.test(app),
        `${shell} App.jsx passes mode="unstake" to StakingActionForm for the unstake route`);
    assert.ok(/mode="claim-rewards"/.test(app),
        `${shell} App.jsx passes mode="claim-rewards" to StakingActionForm for the claim route`);
}

console.log(
    'OK: staking action form smoke (StakingActionForm mode=unstake|claim-rewards + capability-model pubkey-based unstake +  partial amount editing/threading + bg handlers + 3-shell messaging + two App.jsx sub-routes wired from StakeDetail)',
);
