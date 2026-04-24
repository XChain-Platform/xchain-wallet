// Smoke for Phase 4 — Step 4 of 23 — DEPLOY authoring form (§42.6).
//
// Asserts:
//   1. DeployContractForm.jsx exists; single-component named export.
//   2. 4-stage state machine (form → review → submitting → done).
//   3. Wiring: validateContractCode / checkContractCodeSize /
//      suggestContractGasLimit + deployAction + deployActionHw via
//      messaging; BTC-only chain gate.
//   4. Review-screen branch + sign button; SignCredentials for password
//      + HW; deployActionHw on hw-source, deployAction on software.
//   5. deployAction core flow guards CODE + GAS_LIMIT; re-exported
//      from the flows barrel.
//   6. Background host registers action.deploy + action.deploy.hw +
//      three pure-function passthroughs; three shells expose matching
//      messaging helpers.
//   7. ContractsList.jsx gains optional onDeploy prop + button render;
//      three App.jsx wire 'contract-deploy' sub-route.
//   8. Monaco-deferred note exists in spec follow-ups directory.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const platformRoot = join(wsRoot, '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'DeployContractForm.jsx');
assert.ok(existsSync(formPath), 'DeployContractForm.jsx exists');

const formSrc = readFileSync(formPath, 'utf8');

// --- 1. Single-component export --------------------------------------

assert.ok(/export function DeployContractForm\b/.test(formSrc),
    'DeployContractForm is a named export');
assert.equal(
    (formSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DeployContractForm.jsx only exports the component',
);

// --- 2. 4-stage state machine ----------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(new RegExp(`'${stage}'`).test(formSrc),
        `DeployContractForm tracks '${stage}' stage`);
}

// --- 3. Wiring --------------------------------------------------------

for (const call of [
    'messaging.validateContractCode',
    'messaging.checkContractCodeSize',
    'messaging.suggestContractGasLimit',
    'messaging.deployAction',
    'messaging.deployActionHw',
    'messaging.getAddressesByChain',
    'messaging.getSignerStatus',
]) {
    assert.ok(formSrc.includes(call), `DeployContractForm calls ${call}`);
}

// BTC-only gate
assert.ok(/VM_COIN\s*=\s*['"]bitcoin['"]/.test(formSrc),
    'DeployContractForm pins VM_COIN=bitcoin (VM is BTC-only at launch)');
assert.ok(/byCoin\(VM_COIN\)/.test(formSrc),
    'DeployContractForm resolves BTC chain IDs from the registry');
assert.ok(/Contracts are BTC-only at launch/.test(formSrc),
    'DeployContractForm explains the BTC-only constraint in the no-BTC state');

// Action buttons
for (const label of ['Validate code', 'Estimate size', 'Suggest gas']) {
    assert.ok(formSrc.includes(label), `DeployContractForm renders "${label}" button`);
}

// --- 4. Review + HW branching ----------------------------------------

assert.ok(/SignCredentials\b/.test(formSrc),
    'DeployContractForm uses SignCredentials on the review screen');
assert.ok(
    /isHwSource\s*\n?\s*\?\s*await messaging\.deployActionHw/.test(formSrc),
    'DeployContractForm branches HW vs software signing at submit',
);
assert.ok(
    /InvalidPasswordError/.test(formSrc),
    'DeployContractForm distinguishes wrong-password on submit',
);

// --- 5. Core flow + guards -------------------------------------------

assert.equal(typeof flows.deployAction, 'function', 'flows.deployAction is re-exported');
assert.equal(typeof flows.contractValidate, 'function', 'flows.contractValidate is re-exported');
assert.equal(typeof flows.contractCheckCodeSize, 'function', 'flows.contractCheckCodeSize is re-exported');
assert.equal(typeof flows.contractSuggestGasLimit, 'function', 'flows.contractSuggestGasLimit is re-exported');

await assert.rejects(
    async () => flows.deployAction({ params: { CODE: 'x' } }),
    /deployAction: params\.GAS_LIMIT is required/,
    'deployAction guards GAS_LIMIT',
);
await assert.rejects(
    async () => flows.deployAction({ params: {} }),
    /deployAction: params\.CODE is required/,
    'deployAction guards CODE',
);
await assert.rejects(
    async () => flows.deployAction({}),
    /deployAction: params is required/,
    'deployAction guards params',
);
await assert.rejects(
    async () => flows.contractValidate({ chainId: 'bitcoin-mainnet', code: 'x' }),
    /contractValidate: sdkRegistry is required/,
    'contractValidate guards sdkRegistry',
);
await assert.rejects(
    async () => flows.contractValidate({ sdkRegistry: {}, code: 'x' }),
    /contractValidate: chainId is required/,
    'contractValidate guards chainId',
);

// Positive — contractValidate routes through sdk.contracts.validate
{
    let called = null;
    const fakeSdk = {
        contracts: { validate: (c) => { called = c; return { valid: true }; } },
    };
    const res = await flows.contractValidate({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet',
        code: 'let x = 1;',
    });
    assert.equal(called, 'let x = 1;');
    assert.deepEqual(res, { valid: true });
}

// --- 6. Background host + shell messaging helpers ---------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    "'action.deploy'",
    "'contracts.validate'",
    "'contracts.checkCodeSize'",
    "'contracts.suggestGasLimit'",
]) {
    assert.ok(bg.includes(h), `background host registers ${h}`);
}
assert.ok(/registerHwHandler\('action\.deploy\.hw', deployAction\)/.test(bg),
    'background host registers action.deploy.hw via registerHwHandler');

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of [
        'deployAction',
        'deployActionHw',
        'validateContractCode',
        'checkContractCodeSize',
        'suggestContractGasLimit',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// --- 7. ContractsList onDeploy + App.jsx wiring -----------------------

const listSrc = readFileSync(join(sharedRoutes, 'ContractsList.jsx'), 'utf8');
assert.ok(/\[props\.onDeploy\]/.test(listSrc) || /props\.onDeploy/.test(listSrc),
    'ContractsList documents the onDeploy prop');
assert.ok(/onDeploy\s*\}/.test(listSrc),
    'ContractsList destructures onDeploy');
assert.ok(/onDeploy \?\s*\(?\s*<Button[\s\S]*?onClick=\{onDeploy\}[\s\S]*?\+ Deploy new contract/.test(listSrc),
    'ContractsList renders the + Deploy new contract button only when onDeploy is passed');

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DeployContractForm'),
        `${shell} App.jsx imports DeployContractForm`);
    assert.ok(app.includes("'contract-deploy'"),
        `${shell} tracks the contract-deploy sub-route`);
    assert.ok(/onDeploy=\{\(\)\s*=>\s*setUnlockedView\('contract-deploy'\)\}/.test(app),
        `${shell} wires ContractsList.onDeploy → contract-deploy`);
}

// --- 8. Monaco follow-up note exists ----------------------------------

const monacoPath = join(platformRoot, 'claude', 'reports', 'specs', '2026-04-24_phase4-monaco-editor.md');
assert.ok(existsSync(monacoPath),
    'Monaco deferral captured at claude/reports/specs/2026-04-24_phase4-monaco-editor.md');

console.log(
    'OK — deploy contract form smoke (DeployContractForm shared route + deployAction / contractValidate / checkCodeSize / suggestGasLimit flows + four new background handlers + three-shell messaging helpers + ContractsList onDeploy button + three-shell contract-deploy sub-route + Monaco deferral captured)',
);
