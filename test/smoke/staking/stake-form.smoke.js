// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4: Step 8 of 23: STAKE authoring form (§42.7.1).
//
// Capability-staking model: form takes an amount + signing pubkey;
// no tier picker, no chains selector. Spec:
// claude/reports/specs/2026-05-24_capability-staking-model.md

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

const formPath = join(sharedRoutes, 'StakeForm.jsx');
assert.ok(existsSync(formPath), 'StakeForm.jsx exists');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakeForm\b/.test(formSrc), 'StakeForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'StakeForm.jsx only exports the component',
);

// 4-stage state machine
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `StakeForm tracks '${stage}' stage`);
}

// Capability-model fields: amount input + new/top-up mode radio.
// Tier and chains pickers are gone (the protocol no longer uses tiers).
assert.ok(!/Tier 1/.test(formSrc) && !/Tier 2/.test(formSrc),
    'StakeForm does not surface tier labels (capability-staking model dropped them)');
assert.ok(/label="Amount"/.test(formSrc),
    'StakeForm renders an Amount input');
assert.ok(/New stake/.test(formSrc), 'StakeForm offers "New stake" mode');
assert.ok(/Top up an existing stake/.test(formSrc),
    'StakeForm offers "Top up" mode (VERSION 2)');
assert.ok(/AMOUNT:\s*amount\.trim\(\)/.test(formSrc),
    'StakeForm passes AMOUNT in action params');

// Pubkey validation: 64 hex chars
assert.ok(/\[0-9a-fA-F\]\{64\}/.test(formSrc),
    'StakeForm validates signing pubkey as 64 hex chars');

// Wiring
for (const call of [
    'messaging.stakeAction',
    'messaging.stakeActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
    'messaging.getStakesForAddress',   // auto-detect new-vs-top-up mode
]) {
    assert.ok(formSrc.includes(call), `StakeForm calls ${call}`);
}

// Auto-detect status hint should be wired
assert.ok(/detectStatus/.test(formSrc),
    'StakeForm tracks detection status for new-vs-top-up auto-detect');
for (const status of ['checking', 'new', 'topup', 'error']) {
    assert.ok(new RegExp(`detectStatus === '${status}'`).test(formSrc),
        `StakeForm renders detectStatus '${status}' hint`);
}
// §20 Cluster X Step 13: handler refactored from a ternary into an if/
// else cascade (watcher-mode branch wins first). Pin the HW branch
// against either the legacy ternary OR the new cascade shape.
assert.ok(
    /isHwSource\s*\n?\s*\?\s*await messaging\.stakeActionHw/.test(formSrc)
        || /else if \(isHwSource\) \{[\s\S]+?messaging\.stakeActionHw/.test(formSrc),
    'StakeForm branches HW vs software signing',
);
assert.ok(/InvalidPasswordError/.test(formSrc),
    'StakeForm distinguishes wrong-password');

// 6-block activation delay messaging
assert.ok(/6 BTC blocks/.test(formSrc),
    'StakeForm mentions the 6-BTC-block activation delay per STAKE.md');

// --- Live capability-threshold readout (cross-repo: hub RPC →
//     SDK → wallet flow → host → 3-shell messaging → form) ---
assert.ok(formSrc.includes('messaging.getCapabilityThresholds'),
    'StakeForm fetches live per-capability MIN_STAKE thresholds');
assert.ok(/CAPABILITY_LABELS/.test(formSrc),
    'StakeForm maps capability ids to plain-language labels');
assert.ok(/qualifyReadout/.test(formSrc),
    'StakeForm renders the per-capability qualify readout');
assert.ok(/existingStake/.test(formSrc),
    'StakeForm projects total stake (existing + amount) for top-up qualification');

assert.equal(typeof flows.capabilityThresholds, 'function',
    'flows.capabilityThresholds re-exported');
await assert.rejects(
    async () => flows.capabilityThresholds({ chainId: 'bitcoin-mainnet' }),
    /capabilityThresholds: sdkRegistry is required/,
    'capabilityThresholds guards sdkRegistry',
);

// --- Core flow guards ---

assert.equal(typeof flows.stakeAction, 'function', 'flows.stakeAction re-exported');

await assert.rejects(
    async () => flows.stakeAction({}),
    /stakeAction: params is required/,
    'stakeAction guards params',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { AMOUNT: '100', SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /VERSION must be "1" \(new stake\) or "2" \(top-up\)/,
    'stakeAction guards VERSION',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { VERSION: '1', SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /stakeAction: params\.AMOUNT is required/,
    'stakeAction guards AMOUNT',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { VERSION: '1', AMOUNT: 'NaN', SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /AMOUNT must be a positive decimal/,
    'stakeAction validates AMOUNT format',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { VERSION: '1', AMOUNT: '0', SIGNING_PUBKEY: 'a'.repeat(64) } }),
    /AMOUNT must be greater than 0/,
    'stakeAction rejects zero amount',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { VERSION: '1', AMOUNT: '100' } }),
    /stakeAction: params\.SIGNING_PUBKEY is required/,
    'stakeAction guards SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.stakeAction({ params: { VERSION: '1', AMOUNT: '100', SIGNING_PUBKEY: 'not-hex' } }),
    /SIGNING_PUBKEY must be 64 hex chars/,
    'stakeAction validates SIGNING_PUBKEY format',
);

// --- Background host + 3-shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'action.stake'"), 'background host registers action.stake');
assert.ok(/registerHwHandler\('action\.stake\.hw', stakeAction\)/.test(bg),
    'background host registers action.stake.hw via registerHwHandler');
assert.ok(bg.includes("'capabilities.thresholds'"),
    'background host registers capabilities.thresholds');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['stakeAction', 'stakeActionHw', 'getCapabilityThresholds']) {
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
    assert.ok(app.includes('StakeForm'), `${shell} App.jsx imports StakeForm`);
    assert.ok(app.includes("'stake-form'"), `${shell} tracks stake-form sub-route`);
    assert.ok(/stakingRef,\s*setStakingRef/.test(app),
        `${shell} declares stakingRef state`);
    assert.ok(/onPickValidator=\{\(chainId\)\s*=>\s*\{\s*setStakingRef\(\{ kind: 'validator', chainId, address: '' \}\);\s*setUnlockedView\('stake-form'\)/.test(app),
        `${shell} wires StakeNew.onPickValidator → stake-form with a validator ref`);
}

console.log(
    'OK: stake form smoke (capability-staking model: amount + signing pubkey, new-stake/top-up modes, bg handler + 3-shell messaging + StakeNew onPickValidator wire-through)',
);
