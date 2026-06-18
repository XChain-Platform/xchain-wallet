// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 6 of 23: DEPOSIT + WITHDRAW forms (§42.5).

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

const formPath = join(sharedRoutes, 'ContractFundsForm.jsx');
assert.ok(existsSync(formPath), 'ContractFundsForm.jsx exists');

const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function ContractFundsForm\b/.test(formSrc),
    'ContractFundsForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'ContractFundsForm.jsx only exports the component',
);

// Mode prop + branching verbs.
assert.ok(/mode\s*===\s*['"]deposit['"]/.test(formSrc),
    'ContractFundsForm branches on mode === deposit');
assert.ok(/Deposit|Withdraw/.test(formSrc),
    'ContractFundsForm renders both verbs');

// 4-stage state machine.
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `ContractFundsForm tracks '${stage}' stage`);
}

// Wiring of all four messaging helpers + shared chassis.
for (const call of [
    'messaging.depositAction',
    'messaging.depositActionHw',
    'messaging.withdrawAction',
    'messaging.withdrawActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `ContractFundsForm calls ${call}`);
}

// Wrong-password handling + HW branch.
assert.ok(/InvalidPasswordError/.test(formSrc),
    'ContractFundsForm distinguishes wrong-password');
assert.ok(/isHwSource\s*\?\s*messaging\.depositActionHw\s*:\s*messaging\.depositAction/.test(formSrc)
    || /isDeposit[\s\S]*?isHwSource/.test(formSrc),
    'ContractFundsForm branches HW vs software + mode on submit');

// --- Core flows + guards ---

assert.equal(typeof flows.depositAction, 'function', 'flows.depositAction re-exported');
assert.equal(typeof flows.withdrawAction, 'function', 'flows.withdrawAction re-exported');

await assert.rejects(
    async () => flows.depositAction({}),
    /depositAction: params is required/,
    'depositAction guards params',
);
await assert.rejects(
    async () => flows.depositAction({ params: { TICK: 'X', QUANTITY: '1' } }),
    /depositAction: params\.CONTRACT_ACTION_INDEX is required/,
    'depositAction guards CONTRACT_ACTION_INDEX',
);
await assert.rejects(
    async () => flows.depositAction({ params: { CONTRACT_ACTION_INDEX: '1', QUANTITY: '1' } }),
    /depositAction: params\.TICK is required/,
    'depositAction guards TICK',
);
await assert.rejects(
    async () => flows.depositAction({ params: { CONTRACT_ACTION_INDEX: '1', TICK: 'X' } }),
    /depositAction: params\.QUANTITY is required/,
    'depositAction guards QUANTITY',
);
await assert.rejects(
    async () => flows.withdrawAction({ params: {} }),
    /withdrawAction: params\.CONTRACT_ACTION_INDEX is required/,
    'withdrawAction guards CONTRACT_ACTION_INDEX',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const h of ["'action.deposit'", "'action.withdraw'"]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.deposit\.hw', depositAction\)/.test(bg),
    'background host registers action.deposit.hw');
assert.ok(/registerHwHandler\('action\.withdraw\.hw', withdrawAction\)/.test(bg),
    'background host registers action.withdraw.hw');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['depositAction', 'depositActionHw', 'withdrawAction', 'withdrawActionHw']) {
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
    assert.ok(app.includes('ContractFundsForm'),
        `${shell} App.jsx imports ContractFundsForm`);
    assert.ok(app.includes("'contract-deposit'"),
        `${shell} tracks contract-deposit sub-route`);
    assert.ok(app.includes("'contract-withdraw'"),
        `${shell} tracks contract-withdraw sub-route`);
    assert.ok(/onDeposit=\{\(\)\s*=>\s*setUnlockedView\('contract-deposit'\)\}/.test(app),
        `${shell} wires ContractDetail.onDeposit → contract-deposit`);
    assert.ok(/onWithdraw=\{\(\)\s*=>\s*setUnlockedView\('contract-withdraw'\)\}/.test(app),
        `${shell} wires ContractDetail.onWithdraw → contract-withdraw`);
    assert.ok(/mode="deposit"/.test(app),
        `${shell} App.jsx passes mode="deposit" to ContractFundsForm for the deposit route`);
    assert.ok(/mode="withdraw"/.test(app),
        `${shell} App.jsx passes mode="withdraw" to ContractFundsForm for the withdraw route`);
}

console.log(
    'OK: contract funds form smoke (ContractFundsForm shared route with mode=deposit|withdraw + depositAction/withdrawAction flows + bg handlers + 3-shell messaging + three App.jsx sub-routes wired from ContractDetail)',
);
