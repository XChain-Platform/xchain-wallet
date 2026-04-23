// Smoke for Phase 2 — Step 22a (piece 7b part 1) — "My dispensers"
// list view + dispenser detail page + cancel action (§40.7.1 /
// §40.7.2).
//
// Asserts:
//   1. DispensersList.jsx + DispenserDetail.jsx exist as single-component
//      exports.
//   2. DispensersList wires through messaging.getDispensersForSource per
//      chain and dedupes + sorts rows. Handles zero-address + per-chain
//      error cases.
//   3. DispenserDetail loads via messaging.getDispenserByActionIndex +
//      getAddressesByChain in parallel. Owner detection compares the
//      dispenser's source against wallet addresses on the chain.
//   4. Cancel flow composes { VERSION: '1', DISPENSER_ACTION_INDEX }
//      and submits via messaging.dispenserAction. Danger-variant sign
//      button; password re-prompt on wrong-password.
//   5. Core flows (dispenserQueries.js) guard required inputs and call
//      the right SDK method per lane. Re-exported from the flows
//      barrel.
//   6. Background host registers five explorer-passthrough handlers
//      (dispensers.forSource / forAddress / forToken / byActionIndex,
//      dispenses.query). All three shell messaging files expose the
//      matching helpers.
//   7. ActionsMenu + App.jsx track 'dispensers-list' + 'dispenser-detail'
//      sub-routes in popup + web + desktop; dispenserRef state carries
//      chainId + actionIndex through the nav transition.

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

const listPath = join(sharedRoutes, 'DispensersList.jsx');
const detailPath = join(sharedRoutes, 'DispenserDetail.jsx');
assert.ok(existsSync(listPath), 'DispensersList.jsx exists');
assert.ok(existsSync(detailPath), 'DispenserDetail.jsx exists');

const listSrc = readFileSync(listPath, 'utf8');
const detailSrc = readFileSync(detailPath, 'utf8');

// --- 1. Single-component exports --------------------------------------

assert.ok(/export function DispensersList\b/.test(listSrc), 'DispensersList is a named export');
assert.equal(
    (listSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DispensersList.jsx only exports the component',
);
assert.ok(/export function DispenserDetail\b/.test(detailSrc), 'DispenserDetail is a named export');
assert.equal(
    (detailSrc.match(/^export\s+(function|const|class)\b/gm) || []).length,
    1,
    'DispenserDetail.jsx only exports the component',
);

// --- 2. DispensersList wiring + edge-case handling --------------------

assert.ok(
    /messaging\.getDispensersForSource/.test(listSrc),
    'DispensersList calls messaging.getDispensersForSource per address',
);
assert.ok(
    /messaging\.getAddressesByChain/.test(listSrc),
    'DispensersList loads wallet addresses before querying dispensers',
);
assert.ok(
    /seen\.has|action_index/.test(listSrc),
    'DispensersList dedupes rows by action_index',
);
assert.ok(
    /sort\(\(a, b\)\s*=>\s*Number\(b\.block_index/.test(listSrc),
    'DispensersList sorts rows newest-block-first',
);
assert.ok(
    /No addresses on any chain/.test(listSrc) || /No addresses/.test(listSrc),
    'DispensersList surfaces the no-addresses case',
);
assert.ok(
    /No dispensers opened/.test(listSrc),
    'DispensersList surfaces the empty per-chain case',
);
assert.ok(
    /Couldn't load dispensers/.test(listSrc),
    'DispensersList surfaces per-chain load errors without blocking other chains',
);

// --- 3. DispenserDetail load path -------------------------------------

assert.ok(
    /messaging\.getDispenserByActionIndex/.test(detailSrc),
    'DispenserDetail fetches dispenser metadata by action index',
);
assert.ok(
    /messaging\.getAddressesByChain/.test(detailSrc),
    'DispenserDetail loads wallet addresses to detect ownership',
);
assert.ok(
    /setOwnerAddress/.test(detailSrc),
    'DispenserDetail tracks owner-address state',
);
assert.ok(
    /messaging\.getDispenses/.test(detailSrc),
    'DispenserDetail fetches recent dispense events',
);
assert.ok(
    /Remaining escrow and dispense count aren't published/.test(detailSrc),
    'DispenserDetail calls out the indexer TODO (live escrow / dispense count)',
);

// --- 4. Cancel flow ---------------------------------------------------

assert.ok(
    /VERSION:\s*['"]1['"]/.test(detailSrc),
    'DispenserDetail cancel params pin VERSION="1"',
);
assert.ok(
    /DISPENSER_ACTION_INDEX:\s*String\(actionIndex\)/.test(detailSrc),
    'DispenserDetail cancel params carry DISPENSER_ACTION_INDEX from props',
);
assert.ok(
    /messaging\.dispenserAction/.test(detailSrc),
    'DispenserDetail dispatches cancel via messaging.dispenserAction',
);
assert.ok(
    /variant="danger"/.test(detailSrc),
    'DispenserDetail sign-cancel button uses danger variant',
);
assert.ok(
    /'InvalidPasswordError'/.test(detailSrc),
    'DispenserDetail distinguishes wrong-password on cancel',
);
assert.ok(
    /1-hour close window/.test(detailSrc),
    'DispenserDetail tells the user about the close delay',
);

// --- 5. Core flows -----------------------------------------------------

for (const name of [
    'dispensersForSource',
    'dispensersForAddress',
    'dispensersForToken',
    'dispenserByActionIndex',
    'dispensesFor',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} is re-exported from core`);
}

await assert.rejects(
    async () => flows.dispensersForSource({ chainId: 'bitcoin-mainnet' }),
    /dispensersForSource: sdkRegistry is required/,
    'dispensersForSource guards sdkRegistry',
);
await assert.rejects(
    async () => flows.dispensersForSource({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /dispensersForSource: address is required/,
    'dispensersForSource guards address',
);
await assert.rejects(
    async () => flows.dispenserByActionIndex({ sdkRegistry: {}, chainId: 'bitcoin-mainnet' }),
    /dispenserByActionIndex: actionIndex is required/,
    'dispenserByActionIndex guards actionIndex',
);
await assert.rejects(
    async () => flows.dispensesFor({ sdkRegistry: {}, chainId: 'x', query: 'q' }),
    /dispensesFor: type is required/,
    'dispensesFor guards type',
);

// Positive path: dispensersForSource calls the mock sdk's getDispensers
// with (address, 'source', opts).
{
    let called = null;
    const fakeSdk = {
        getDispensers: (...args) => { called = args; return { data: [] }; },
    };
    const sdkRegistry = { get: () => fakeSdk };
    await flows.dispensersForSource({
        sdkRegistry, chainId: 'bitcoin-mainnet', address: 'bc1qfake', opts: { limit: 10 },
    });
    assert.deepEqual(called, ['bc1qfake', 'source', { limit: 10 }]);
}

// --- 6. Background host + shell messaging helpers ---------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const h of [
    "'dispensers.forSource'",
    "'dispensers.forAddress'",
    "'dispensers.forToken'",
    "'dispensers.byActionIndex'",
    "'dispenses.query'",
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
        'getDispensersForSource',
        'getDispensersForAddress',
        'getDispensersForToken',
        'getDispenserByActionIndex',
        'getDispenses',
    ]) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('dispensers\.forSource'/.test(m),
        `${shell} messaging routes forSource via dispensers.forSource`);
    assert.ok(/sendMessage\('dispenses\.query'/.test(m),
        `${shell} messaging routes dispenses via dispenses.query`);
}

// --- 7. ActionsMenu + App.jsx wiring ----------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DispensersList'), `${shell} App.jsx imports DispensersList`);
    assert.ok(app.includes('DispenserDetail'), `${shell} App.jsx imports DispenserDetail`);
    assert.ok(app.includes("'dispensers-list'"), `${shell} tracks the dispensers-list sub-route`);
    assert.ok(app.includes("'dispenser-detail'"), `${shell} tracks the dispenser-detail sub-route`);
    assert.ok(
        /id:\s*['"]dispensers-list['"]/.test(app),
        `${shell} registers the My dispensers entry`,
    );
    assert.ok(
        /onMyDispensers:\s*\(\)\s*=>\s*setUnlockedView\('dispensers-list'\)/.test(app),
        `${shell} wires onMyDispensers to the list sub-route`,
    );
    assert.ok(
        /setDispenserRef\(\{\s*chainId,\s*actionIndex\s*\}\)/.test(app),
        `${shell} threads chainId + actionIndex through setDispenserRef`,
    );
}

console.log(
    'OK — dispensers list smoke (DispensersList + DispenserDetail shared routes + five explorer passthroughs + messaging helpers in popup/web/desktop + ActionsMenu "My dispensers" entry + list→detail nav state + v1 cancel lane reused from Step 21)',
);
