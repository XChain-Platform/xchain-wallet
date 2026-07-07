// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4, Step 5 of 23: EXECUTE method form (§42.4).

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

const formPath = join(sharedRoutes, 'ExecuteContractForm.jsx');
assert.ok(existsSync(formPath), 'ExecuteContractForm.jsx exists');

const formSrc = readFileSync(formPath, 'utf8');

assert.ok(/export function ExecuteContractForm\b/.test(formSrc),
    'ExecuteContractForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'ExecuteContractForm.jsx only exports the component',
);

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `ExecuteContractForm tracks '${stage}' stage`);
}

for (const call of [
    'messaging.executeAction',
    'messaging.executeActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `ExecuteContractForm calls ${call}`);
}

// Pipe-delimited param splitting on submit (SDK validator requires array).
assert.ok(/paramsText\.split\('\|'\)/.test(formSrc),
    'ExecuteContractForm splits pipe-delimited params into an array');
assert.ok(/PARAMS\b/.test(formSrc), 'ExecuteContractForm composes a PARAMS field');

// HW branch + wrong-password distinguished.
// §20 Cluster X Step 20: ternary refactored into if/else cascade.
assert.ok(
    /isHwSource\s*\n?\s*\?\s*await messaging\.executeActionHw/.test(formSrc)
        || /else if \(isHwSource\) \{[\s\S]+?messaging\.executeActionHw/.test(formSrc),
    'ExecuteContractForm branches HW vs software signing',
);
assert.ok(/InvalidPasswordError/.test(formSrc),
    'ExecuteContractForm distinguishes wrong-password');

// --- Core flow guards + positive path ---

assert.equal(typeof flows.executeAction, 'function', 'flows.executeAction is re-exported');

await assert.rejects(
    async () => flows.executeAction({}),
    /executeAction: params is required/,
    'executeAction guards params',
);
await assert.rejects(
    async () => flows.executeAction({ params: { METHOD: 'x' } }),
    /executeAction: params\.CONTRACT_ACTION_INDEX is required/,
    'executeAction guards CONTRACT_ACTION_INDEX',
);
await assert.rejects(
    async () => flows.executeAction({ params: { CONTRACT_ACTION_INDEX: '1' } }),
    /executeAction: params\.METHOD is required/,
    'executeAction guards METHOD',
);

// --- Background host + shell messaging helpers ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'action.execute'"), 'background host registers action.execute');
assert.ok(/registerHwHandler\('action\.execute\.hw', executeAction\)/.test(bg),
    'background host registers action.execute.hw via registerHwHandler');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['executeAction', 'executeActionHw']) {
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
    assert.ok(app.includes('ExecuteContractForm'),
        `${shell} App.jsx imports ExecuteContractForm`);
    assert.ok(app.includes("'contract-execute'"),
        `${shell} tracks the contract-execute sub-route`);
    assert.ok(/onExecute=\{\(\)\s*=>\s*setUnlockedView\('contract-execute'\)\}/.test(app),
        `${shell} wires ContractDetail.onExecute → contract-execute`);
    assert.ok(/onBack=\{\(\)\s*=>\s*setUnlockedView\('contract-detail'\)\}/.test(app),
        `${shell} ExecuteContractForm back returns to contract-detail`);
}

// --- Deep-link prefill props + ABI lane (Contract_ABI.md FOLLOWUP 2) ----

assert.ok(
    /initialMethod, initialParamsText, initialGasLimit/.test(formSrc),
    'ExecuteContractForm accepts the three deep-link prefill props',
);
assert.ok(
    /useState\(initialMethod \|\| ''\)[\s\S]*?useState\(initialParamsText \|\| ''\)[\s\S]*?useState\(initialGasLimit \|\| ''\)/.test(formSrc),
    'prefill props seed the method/paramsText/gasLimit state initializers',
);
assert.ok(
    /messaging\.getContractByActionIndex\(\{ chainId, contractActionIndex \}\)/.test(formSrc),
    'ABI lane fetches the explorer contract row through the existing bridge call',
);
assert.ok(
    /const \[contractAbi, setContractAbi\] = useState/.test(formSrc)
        && /const \[manualMode, setManualMode\] = useState/.test(formSrc),
    'ABI lane state: contractAbi + explicit manualMode escape hatch',
);
assert.ok(
    /<Select[\s\S]*?selectAbiMethod\(e\.target\.value\)/.test(formSrc),
    'ABI lane renders a method Select wired to selectAbiMethod',
);
assert.ok(
    /abiActive && abiIncomplete/.test(formSrc),
    'Preview is gated on all declared params being filled (positional wire format)',
);
assert.ok(
    /Enter method manually/.test(formSrc) && /Use declared methods/.test(formSrc),
    'both lane-toggle affordances exist (abi is self-declared; manual stays available)',
);
assert.ok(
    !/2026-04-24_phase4-monaco-editor\.md/.test(formSrc),
    'stale FOLLOWUP-2 spec pointer replaced (convention now lives in Contract_ABI.md)',
);

console.log(
    'OK: execute contract form smoke (ExecuteContractForm shared route + executeAction + bg handlers + 3-shell messaging + ContractDetail onExecute wire-through + deep-link prefill props + ABI lane with manual fallback)',
);
