// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 10 of 23: DELEGATE (rotate + revoke)
// forms (§42.7.2 delegation-lane).

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

// Validator Delegate and Revoke are actions of the one Staking form
// (StakingForm.jsx); the old DelegationActionForm.jsx is gone.
const formPath = join(sharedRoutes, 'StakingForm.jsx');
assert.ok(existsSync(formPath), 'StakingForm.jsx exists');
assert.ok(!existsSync(join(sharedRoutes, 'DelegationActionForm.jsx')),
    'DelegationActionForm.jsx is merged into StakingForm.jsx');
const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function StakingForm\b/.test(formSrc),
    'StakingForm is a named export');
const actionRow = (key) => formSrc.split(`'${key}': {`)[1]?.split(/\n    '[a-z]+:[a-z-]+': \{/)[0] || '';
const delegateRow = actionRow('network:delegate');
const revokeRow = actionRow('network:revoke');

// Action rows + branching.
assert.ok(delegateRow && revokeRow, 'StakingForm has network delegate and revoke action rows');
assert.ok(/currentAction\s*===\s*['"]delegate['"]/.test(formSrc),
    'StakingForm branches on the delegate action');
assert.ok(/verb:\s*'Delegate Signing Key'/.test(delegateRow) && /verb:\s*'Revoke Delegation'/.test(revokeRow),
    'StakingForm names both verbs');
assert.ok(/wire:\s*'DELEGATE'/.test(delegateRow) && /wire:\s*'DELEGATE'/.test(revokeRow),
    'Delegate and Revoke share the DELEGATE wire action');
assert.ok(/VERSION: '0', NEW_SIGNING_PUBKEY: pk/.test(formSrc) && /VERSION: '2', SIGNING_PUBKEY: pk/.test(formSrc),
    'Delegate rotates with DELEGATE v0 and Revoke removes with DELEGATE v2');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `DelegationActionForm tracks '${stage}' stage`);
}

// Pubkey validation: 64 hex chars.
assert.ok(/\[0-9a-fA-F\]\{64\}/.test(formSrc),
    'DelegationActionForm validates signing pubkey as 64 hex chars');

// Revoke mode pre-populates from getDelegationsForAddress.
assert.ok(/messaging\.getDelegationsForAddress/.test(formSrc),
    'DelegationActionForm queries getDelegationsForAddress in revoke mode for pre-fill');

// Wiring of all four messaging helpers + shared chassis.
assert.ok(/software:\s*'delegateAction'/.test(delegateRow) && /hardware:\s*'delegateActionHw'/.test(delegateRow),
    'Delegate signs through delegateAction and delegateActionHw');
assert.ok(/software:\s*'revokeDelegationAction'/.test(revokeRow) && /hardware:\s*'revokeDelegationActionHw'/.test(revokeRow),
    'Revoke signs through revokeDelegationAction and revokeDelegationActionHw');
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
    'DelegationActionForm distinguishes wrong-password');

// --- Core flow guards ---

assert.equal(typeof flows.delegateAction, 'function', 'flows.delegateAction re-exported');
assert.equal(typeof flows.revokeDelegationAction, 'function',
    'flows.revokeDelegationAction re-exported');

await assert.rejects(
    async () => flows.delegateAction({}),
    /delegateAction: params is required/,
    'delegateAction guards params',
);
await assert.rejects(
    async () => flows.delegateAction({ params: {} }),
    /delegateAction: params\.NEW_SIGNING_PUBKEY is required/,
    'delegateAction guards NEW_SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.delegateAction({ params: { NEW_SIGNING_PUBKEY: 'not-hex' } }),
    /NEW_SIGNING_PUBKEY must be 64 hex chars/,
    'delegateAction validates NEW_SIGNING_PUBKEY format',
);

await assert.rejects(
    async () => flows.revokeDelegationAction({}),
    /revokeDelegationAction: params is required/,
    'revokeDelegationAction guards params',
);
await assert.rejects(
    async () => flows.revokeDelegationAction({ params: {} }),
    /revokeDelegationAction: params\.SIGNING_PUBKEY is required/,
    'revokeDelegationAction guards SIGNING_PUBKEY',
);
await assert.rejects(
    async () => flows.revokeDelegationAction({ params: { SIGNING_PUBKEY: 'not-hex' } }),
    /SIGNING_PUBKEY must be 64 hex chars/,
    'revokeDelegationAction validates SIGNING_PUBKEY format',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of ["'action.delegate'", "'action.revokeDelegation'"]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.delegate\.hw', delegateAction\)/.test(bg),
    'background host registers action.delegate.hw');
assert.ok(/registerHwHandler\('action\.revokeDelegation\.hw', revokeDelegationAction\)/.test(bg),
    'background host registers action.revokeDelegation.hw');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['delegateAction', 'delegateActionHw', 'revokeDelegationAction', 'revokeDelegationActionHw']) {
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
    assert.ok(app.includes("'staking-delegate'"),
        `${shell} tracks staking-delegate sub-route`);
    assert.ok(app.includes("'staking-revoke'"),
        `${shell} tracks staking-revoke sub-route`);
    // Validator-kind quick actions on StakeDetail open the two form
    // views; both forms return to the detail page they came from.
    assert.ok(/:\s*\(\)\s*=>\s*setUnlockedView\('staking-delegate'\)\}/.test(app),
        `${shell} wires StakeDetail.onDelegate (validator arm) → staking-delegate`);
    assert.ok(/onRevokeDelegation=\{\(\)\s*=>\s*setUnlockedView\('staking-revoke'\)\}/.test(app),
        `${shell} wires StakeDetail.onRevokeDelegation → staking-revoke`);
    for (const [view, action] of [['staking-delegate', 'delegate'], ['staking-revoke', 'revoke']]) {
        const block = app.split(`unlockedView === '${view}'`)[1]?.split('unlockedView ===')[0] || '';
        assert.ok(new RegExp(`<StakingForm\\b[\\s\\S]*kind: 'network'[\\s\\S]*action="${action}"`).test(block),
            `${shell} ${view} opens the Staking form on action="${action}"`);
    }
}

console.log(
    'OK: delegation action form smoke (StakingForm delegate|revoke + delegateAction/revokeDelegationAction flows with 64-hex Ed25519 validation + revoke auto-prefill via getDelegationsForAddress + bg handlers + 3-shell messaging + two App.jsx sub-routes wired from StakeDetail)',
);
