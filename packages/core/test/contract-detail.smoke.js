// Smoke for Phase 4 — Step 3 of 23 — Contract detail page (§42.3).
//
// Asserts:
//   1. ContractDetail.jsx exists and is a single-component named export.
//   2. Loads contract / deploy action / state / balances / executions +
//      addresses for ownership in parallel via messaging helpers.
//   3. Renders the spec-mandated header block (Owner / Deployed /
//      Gas limit / Status / Code hash) + State (expandable) + Balances
//      + Execution history (paginated) + action buttons.
//   4. Action buttons disable when their optional on* props are omitted
//      — Step 3 ships with read-only surface; Steps 5+6 wire signing.
//   5. Core flows guard inputs + call the right SDK method, re-exported
//      from the flows barrel.
//   6. Background host registers five new passthroughs; three shell
//      messaging files expose matching getters.
//   7. App.jsx (popup + web + desktop) tracks 'contract-detail' sub-route;
//      ContractsList.onOpenContract sets contractRef and navigates.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const detailPath = join(sharedRoutes, 'ContractDetail.jsx');
assert.ok(existsSync(detailPath), 'ContractDetail.jsx exists');

const detailSrc = readFileSync(detailPath, 'utf8');

// --- 1. Single-component export --------------------------------------

assert.ok(/export function ContractDetail\b/.test(detailSrc), 'ContractDetail is a named export');
assert.equal(
    (detailSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'ContractDetail.jsx only exports the component',
);

// --- 2. Load path -----------------------------------------------------

for (const fn of [
    'messaging.getContractByActionIndex',
    'messaging.getActionByIndex',
    'messaging.getContractState',
    'messaging.getContractBalance',
    'messaging.getExecutionsForContract',
    'messaging.getAddressesByChain',
]) {
    assert.ok(detailSrc.includes(fn), `ContractDetail calls ${fn}`);
}

// --- 3. Spec-mandated sections ---------------------------------------

for (const label of [
    'Owner:',
    'Deployed:',
    'Gas limit:',
    'Status:',
    'Code hash:',
    'State (expandable)',
    'Balances (tokens held by the contract)',
    'Execution history',
]) {
    assert.ok(detailSrc.includes(label), `ContractDetail renders "${label}"`);
}

// Owner "(you)" flag when address matches.
assert.ok(/\(you\)/.test(detailSrc), 'ContractDetail flags owner-matches-wallet as "(you)"');
// Pagination Prev/Next.
assert.ok(/← Prev/.test(detailSrc) && /Next →/.test(detailSrc),
    'ContractDetail paginates execution history');
// Action buttons.
for (const label of ['Call method', 'Deposit', 'Withdraw']) {
    assert.ok(detailSrc.includes(label), `ContractDetail renders "${label}" button`);
}

// --- 4. Action buttons disable without signing props ------------------

assert.ok(
    /onExecute\s*\?\s*\(\)\s*=>\s*onExecute\(\{\s*chainId,\s*contractActionIndex\s*\}\)\s*:\s*undefined/.test(detailSrc),
    'Call method button only fires onExecute when the prop is passed',
);
assert.ok(
    /disabled=\{!onExecute\}/.test(detailSrc),
    'Call method button disables when onExecute is absent',
);
assert.ok(
    /disabled=\{!onDeposit\}/.test(detailSrc) && /disabled=\{!onWithdraw\}/.test(detailSrc),
    'Deposit / Withdraw buttons disable without their props',
);
assert.ok(
    /EXECUTE \/ DEPOSIT \/ WITHDRAW forms land/.test(detailSrc),
    'ContractDetail surfaces the "forms land in upcoming steps" note when no signing props passed',
);

// --- 5. Core flows + guards -------------------------------------------

for (const name of [
    'contractByActionIndex',
    'actionByIndex',
    'contractState',
    'contractBalance',
    'executionsForContract',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} is re-exported from core`);
}

await assert.rejects(
    async () => flows.contractByActionIndex({ chainId: 'bitcoin-mainnet' }),
    /contractByActionIndex: sdkRegistry is required/,
    'contractByActionIndex guards sdkRegistry',
);
await assert.rejects(
    async () => flows.contractByActionIndex({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /contractByActionIndex: contractActionIndex is required/,
    'contractByActionIndex guards contractActionIndex',
);
await assert.rejects(
    async () => flows.contractState({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /contractState: contractActionIndex is required/,
    'contractState guards contractActionIndex',
);
await assert.rejects(
    async () => flows.contractBalance({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /contractBalance: contractActionIndex is required/,
    'contractBalance guards contractActionIndex',
);
await assert.rejects(
    async () => flows.executionsForContract({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /executionsForContract: contractActionIndex is required/,
    'executionsForContract guards contractActionIndex',
);
await assert.rejects(
    async () => flows.actionByIndex({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /actionByIndex: actionIndex is required/,
    'actionByIndex guards actionIndex',
);

// Positive paths: each flow calls the matching SDK method with the
// right argument shape.
{
    let called = null;
    const fakeSdk = { getContract: (...a) => { called = a; return { data: {} }; } };
    await flows.contractByActionIndex({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet', contractActionIndex: '42',
    });
    assert.deepEqual(called, ['42']);
}
{
    let called = null;
    const fakeSdk = { getContractState: (...a) => { called = a; return { data: [] }; } };
    await flows.contractState({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet', contractActionIndex: '42', key: 'foo',
    });
    assert.deepEqual(called, ['42', 'foo']);
}
{
    let called = null;
    const fakeSdk = { getContractBalance: (...a) => { called = a; return { data: [] }; } };
    await flows.contractBalance({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet', contractActionIndex: '42',
    });
    // tick undefined → forwarded undefined to match SDK's default-arg branch
    assert.equal(called[0], '42');
}
{
    let called = null;
    const fakeSdk = { getExecutions: (...a) => { called = a; return { data: [] }; } };
    await flows.executionsForContract({
        sdkRegistry: { get: () => fakeSdk },
        chainId: 'bitcoin-mainnet', contractActionIndex: '42', opts: { page: 3 },
    });
    assert.deepEqual(called, ['42', { page: 3 }]);
}

// --- 6. Background host + shell messaging helpers ---------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    "'contracts.byActionIndex'",
    "'actions.byIndex'",
    "'contracts.state'",
    "'contracts.balance'",
    "'executions.forContract'",
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
        'getContractByActionIndex',
        'getActionByIndex',
        'getContractState',
        'getContractBalance',
        'getExecutionsForContract',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
}

// --- 7. App.jsx wiring ------------------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ContractDetail'), `${shell} App.jsx imports ContractDetail`);
    assert.ok(app.includes("'contract-detail'"),
        `${shell} tracks the contract-detail sub-route`);
    assert.ok(/setContractRef\(\{\s*chainId:\s*cid,\s*contractActionIndex:/.test(app),
        `${shell} ContractsList.onOpenContract threads chainId + contractActionIndex`);
    assert.ok(/onBack=\{\(\)\s*=>\s*setUnlockedView\('contracts-list'\)\}/.test(app),
        `${shell} ContractDetail back returns to the list`);
}

console.log(
    'OK — contract detail smoke (ContractDetail shared route + five read-only passthroughs + messaging helpers in popup/web/desktop + list→detail nav + Call method / Deposit / Withdraw buttons disabled until Step 5+6)',
);
