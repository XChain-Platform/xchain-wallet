// Smoke for Phase 4 — Step 2 of 23 — Contracts nav item + browse
// landing (§42.2).
//
// Asserts:
//   1. ContractsList.jsx exists and is a single-component named export.
//   2. Three sections render: "My contracts (deployed by me)",
//      "My interactions (deposits / withdrawals)", "Browse all contracts".
//   3. Wiring uses messaging.getContractsForSource per BTC address,
//      getDepositsForAddress + getWithdrawalsForAddress for the
//      interactions union, getContractsBrowseAll for the browse section.
//      Deduplicates by CONTRACT_ACTION_INDEX; sorts newest-block-first.
//   4. BTC-only gating: no-BTC-address state surfaces a clear message.
//   5. Core flows guard inputs + call the right SDK methods per lane,
//      re-exported from the flows barrel.
//   6. Background host registers five explorer passthroughs; three
//      shell messaging files expose matching getters.
//   7. App.jsx (popup + web + desktop) imports ContractsList, tracks
//      'contracts-list' sub-route, and wires Home's onContracts prop
//      through a BTC-address gate (useBtcAddressesPresent).

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
const sharedHooks = join(core, 'src', 'shared', 'hooks');

const listPath = join(sharedRoutes, 'ContractsList.jsx');
const hookPath = join(sharedHooks, 'useBtcAddressesPresent.js');
assert.ok(existsSync(listPath), 'ContractsList.jsx exists');
assert.ok(existsSync(hookPath), 'useBtcAddressesPresent.js exists');

const listSrc = readFileSync(listPath, 'utf8');
const hookSrc = readFileSync(hookPath, 'utf8');

// --- 1. Single-component export --------------------------------------

assert.ok(/export function ContractsList\b/.test(listSrc), 'ContractsList is a named export');
assert.equal(
    (listSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'ContractsList.jsx only exports the component',
);

// --- 2. Three sections ------------------------------------------------

assert.ok(/My contracts \(deployed by me\)/.test(listSrc), 'My contracts section title');
assert.ok(/My interactions \(deposits \/ withdrawals\)/.test(listSrc), 'My interactions section title');
assert.ok(/Browse all contracts/.test(listSrc), 'Browse all section title');

// --- 3. Messaging wiring + row merging --------------------------------

assert.ok(
    /messaging\.getContractsForSource/.test(listSrc),
    'ContractsList calls messaging.getContractsForSource for the My contracts section',
);
assert.ok(
    /messaging\.getDepositsForAddress/.test(listSrc)
        && /messaging\.getWithdrawalsForAddress/.test(listSrc),
    'ContractsList calls both deposits + withdrawals for the interactions union',
);
assert.ok(
    /messaging\.getContractsBrowseAll/.test(listSrc),
    'ContractsList calls messaging.getContractsBrowseAll for the Browse all section',
);
assert.ok(
    /messaging\.getAddressesByChain/.test(listSrc),
    'ContractsList loads wallet addresses before querying per chain',
);
assert.ok(
    /contract_action_index/.test(listSrc),
    'ContractsList dedupes interactions by CONTRACT_ACTION_INDEX',
);
assert.ok(
    /b\.latestBlock\s*-\s*a\.latestBlock|newestFirst/.test(listSrc),
    'ContractsList sorts rows newest-block-first',
);
assert.ok(
    /Filter by name or #action_index/.test(listSrc),
    'ContractsList renders a client-side search input',
);

// --- 4. BTC-only gating + empty states --------------------------------

assert.ok(
    /VM_COIN\s*=\s*['"]bitcoin['"]/.test(listSrc),
    'ContractsList pins VM_COIN to bitcoin (VM is BTC-only at launch)',
);
assert.ok(
    /BITCOIN_ACTIONS|VM actions are BTC-only|Contracts are available on Bitcoin only/.test(listSrc),
    'ContractsList explains the BTC-only constraint in the no-BTC-address state',
);
assert.ok(
    /No contracts deployed from this chain/.test(listSrc),
    'ContractsList surfaces the empty "My contracts" state per chain',
);
assert.ok(
    /No DEPOSIT or WITHDRAW/.test(listSrc),
    'ContractsList surfaces the empty "My interactions" state per chain',
);
assert.ok(
    /No contracts indexed on this chain/.test(listSrc),
    'ContractsList surfaces the empty "Browse all" state per chain',
);
assert.ok(
    /Couldn't load contracts/.test(listSrc),
    'ContractsList surfaces per-chain load errors without blocking other chains',
);

// --- 4b. useBtcAddressesPresent hook ----------------------------------

assert.ok(/export function useBtcAddressesPresent/.test(hookSrc),
    'useBtcAddressesPresent is a named export');
assert.ok(/byCoin\(['"]bitcoin['"]\)/.test(hookSrc),
    'hook resolves BTC chain IDs from the registry');
assert.ok(/messaging\.getAddressesByChain/.test(hookSrc),
    'hook loads addresses via messaging.getAddressesByChain');
assert.ok(/return present|setPresent/.test(hookSrc),
    'hook exposes a boolean/null gate');

// --- 5. Core flows ----------------------------------------------------

for (const name of [
    'contractsForSource',
    'contractsForAddress',
    'contractsBrowseAll',
    'depositsForAddress',
    'withdrawalsForAddress',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} is re-exported from core`);
}

await assert.rejects(
    async () => flows.contractsForSource({ chainId: 'bitcoin-mainnet' }),
    /contractsForSource: sdkRegistry is required/,
    'contractsForSource guards sdkRegistry',
);
await assert.rejects(
    async () => flows.contractsForSource({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /contractsForSource: address is required/,
    'contractsForSource guards address',
);
await assert.rejects(
    async () => flows.contractsBrowseAll({ sdkRegistry: {} }),
    /contractsBrowseAll: chainId is required/,
    'contractsBrowseAll guards chainId',
);
await assert.rejects(
    async () => flows.depositsForAddress({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /depositsForAddress: address is required/,
    'depositsForAddress guards address',
);
await assert.rejects(
    async () => flows.withdrawalsForAddress({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /withdrawalsForAddress: address is required/,
    'withdrawalsForAddress guards address',
);

// Positive path — contractsForSource calls sdk.getContracts(addr, 'source', opts).
{
    let called = null;
    const fakeSdk = { getContracts: (...args) => { called = args; return { data: [] }; } };
    const sdkRegistry = { get: () => fakeSdk };
    await flows.contractsForSource({
        sdkRegistry, chainId: 'bitcoin-mainnet', address: 'bc1qfake', opts: { limit: 5 },
    });
    assert.deepEqual(called, ['bc1qfake', 'source', { limit: 5 }]);
}
// contractsBrowseAll calls sdk.getContracts(null, null, opts).
{
    let called = null;
    const fakeSdk = { getContracts: (...args) => { called = args; return { data: [] }; } };
    const sdkRegistry = { get: () => fakeSdk };
    await flows.contractsBrowseAll({
        sdkRegistry, chainId: 'bitcoin-mainnet', opts: { page: 2 },
    });
    assert.deepEqual(called, [null, null, { page: 2 }]);
}
// deposits/withdrawals route through their SDK methods with 'address' type.
{
    let dep = null; let wth = null;
    const fakeSdk = {
        getDeposits: (...a) => { dep = a; return { data: [] }; },
        getWithdrawals: (...a) => { wth = a; return { data: [] }; },
    };
    const sdkRegistry = { get: () => fakeSdk };
    await flows.depositsForAddress({ sdkRegistry, chainId: 'bitcoin-mainnet', address: 'bc1q' });
    await flows.withdrawalsForAddress({ sdkRegistry, chainId: 'bitcoin-mainnet', address: 'bc1q' });
    assert.equal(dep[1], 'address');
    assert.equal(wth[1], 'address');
}

// --- 6. Background host + shell messaging helpers ---------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    "'contracts.forSource'",
    "'contracts.forAddress'",
    "'contracts.browseAll'",
    "'deposits.forAddress'",
    "'withdrawals.forAddress'",
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
        'getContractsForSource',
        'getContractsForAddress',
        'getContractsBrowseAll',
        'getDepositsForAddress',
        'getWithdrawalsForAddress',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('contracts\.forSource'/.test(m),
        `${shell} messaging routes forSource via contracts.forSource`);
    assert.ok(/sendMessage\('contracts\.browseAll'/.test(m),
        `${shell} messaging routes browse via contracts.browseAll`);
}

// --- 7. App.jsx wiring + BTC gate -------------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('ContractsList'), `${shell} App.jsx imports ContractsList`);
    assert.ok(app.includes('useBtcAddressesPresent'),
        `${shell} App.jsx uses the BTC-address gate hook`);
    assert.ok(app.includes("'contracts-list'"),
        `${shell} tracks the contracts-list sub-route`);
    assert.ok(
        /onContracts=\{activeWalletId\s*&&\s*hasBtcAddress\s*\?\s*\(\)\s*=>\s*setUnlockedView\('contracts-list'\)\s*:\s*undefined\}/.test(app),
        `${shell} passes onContracts to Home only when activeWalletId && hasBtcAddress`,
    );
}

// --- 8. Home.jsx Contracts button gated by onContracts prop -----------

const homeSrc = readFileSync(join(sharedRoutes, 'Home.jsx'), 'utf8');
assert.ok(/\bonContracts\b/.test(homeSrc), 'Home exposes onContracts prop');
assert.ok(/\{onContracts \?/.test(homeSrc),
    'Home renders the Contracts button only when onContracts is passed');

console.log(
    'OK — contracts list smoke (ContractsList shared route + five explorer passthroughs + messaging helpers in popup/web/desktop + BTC-address gate via useBtcAddressesPresent + Home onContracts wiring)',
);
