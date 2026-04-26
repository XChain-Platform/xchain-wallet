// Smoke for Phase 2 — Step 21 (piece 7a) — DISPENSER authoring form
// (§40.7.1).
//
// Asserts:
//   1. packages/core/src/shared/routes/DispenserForm.jsx exists and
//      exports a single component. Reuses IssueTokenForm.module.css.
//   2. Two-stage state machine (form → review/submitting → done).
//   3. Review runs the composed DISPENSER params through
//      decoder.decodeAction with action: "DISPENSER".
//   4. Sign wires through messaging.dispenserAction.
//   5. Validation rejects bad shapes (empty ticker, non-positive amount,
//      escrow < give, no trigger / FIAT / oracle, oracle without fiat
//      code, malformed FIAT amount).
//   6. Params composer: VERSION='0', GIVE_COIN + GET_COIN = chain
//      coin ticker, GET_TICK unset (coin-paid §40.7.1 lane), oracle +
//      FIAT fields only populated when the user filled them.
//   7. Core flow dispenserAction is re-exported from
//      @xchain-wallet/core and guards the baseline shape.
//   8. Decoder covers DISPENSER v0 Create (coin-paid + FIAT lanes),
//      v1 Cancel, v2 Edit. Each summary differentiates the lane.
//   9. Background host registers action.dispenser; all three shell
//      messaging.js files export dispenserAction(opts).
//  10. ActionsMenu + App.jsx track the 'dispenser' sub-route in popup
//      + web + desktop.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows, decoder } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'DispenserForm.jsx');
assert.ok(existsSync(formPath), 'DispenserForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Public surface + CSS reuse ------------------------------------

assert.ok(
    /export function DispenserForm\b/.test(src),
    'DispenserForm is a named export',
);
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'DispenserForm.jsx only exports the component');
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'DispenserForm reuses IssueTokenForm CSS module',
);

// --- 2. Two-stage state machine ---------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `DispenserForm tracks stage "${stage}"`);
}

// --- 3. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]DISPENSER['"]/.test(src),
    'DispenserForm calls decoder with action: "DISPENSER"',
);
assert.ok(
    /decoderLib\.decodeAction/.test(src),
    'DispenserForm invokes decoder.decodeAction',
);
assert.ok(src.includes('decoded.warnings'), 'DispenserForm renders decoder warnings');

// --- 4. Sign wires through messaging.dispenserAction ------------------

assert.ok(
    /messaging\.dispenserAction\s*\(/.test(src),
    'DispenserForm calls messaging.dispenserAction from the sign stage',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'DispenserForm distinguishes wrong-password from other errors',
);

// --- 5. Validation ----------------------------------------------------

assert.ok(/Token ticker is required/.test(src), 'DispenserForm rejects empty ticker');
assert.ok(
    /Per-fill give amount must be a positive number/.test(src),
    'DispenserForm rejects zero give amount',
);
assert.ok(
    /Escrow amount must be a positive number/.test(src),
    'DispenserForm rejects zero escrow',
);
assert.ok(
    /Escrow is smaller than a single fill/.test(src),
    'DispenserForm rejects escrow < give',
);
assert.ok(
    /Set a trigger price, or enable FIAT \/ oracle/.test(src),
    'DispenserForm rejects when no pricing lane is filled',
);
assert.ok(
    /Oracle pricing requires a FIAT_CODE/.test(src),
    'DispenserForm requires fiat code when oracle is set',
);
assert.ok(
    /FIAT amount must be in X\.XX format/.test(src),
    'DispenserForm enforces X.XX fiat amount',
);

// --- 6. Params composer -----------------------------------------------

assert.ok(/VERSION:\s*'0'/.test(src), 'DispenserForm pins VERSION=0 (create)');
assert.ok(/GIVE_COIN\b/.test(src), 'DispenserForm sets GIVE_COIN');
assert.ok(/GET_COIN\b/.test(src), 'DispenserForm sets GET_COIN');
assert.ok(/PROTOCOL_COIN_TICKER/.test(src), 'DispenserForm maps descriptor.coin → protocol ticker');
// GET_TICK should NOT be assigned anywhere in the composer — the §40.7.1
// primary lane is coin-paid (empty GET_TICK). The SDK validator from
// 1.8.1 treats that as a valid coin-paid create.
assert.ok(
    !/p\.GET_TICK\s*=/.test(src),
    'DispenserForm leaves GET_TICK unset (coin-paid lane)',
);
assert.ok(/p\.ORACLE_ADDRESS\s*=\s*oracle/.test(src),
    'DispenserForm only sets ORACLE_ADDRESS when user provides one');
assert.ok(/p\.FIAT_CODE\s*=\s*fiatCode/.test(src),
    'DispenserForm only sets FIAT_CODE when user picks one');

// --- 7. Core flow -----------------------------------------------------

assert.equal(
    typeof flows.dispenserAction,
    'function',
    'flows.dispenserAction is re-exported from core',
);
await assert.rejects(
    async () => flows.dispenserAction(),
    /dispenserAction: opts is required/,
    'dispenserAction rejects missing opts',
);
await assert.rejects(
    async () => flows.dispenserAction({}),
    /dispenserAction: params is required/,
    'dispenserAction rejects missing params',
);
await assert.rejects(
    async () => flows.dispenserAction({ params: {} }),
    /params\.GIVE_TICK is required for create/,
    'dispenserAction rejects missing GIVE_TICK on create',
);
await assert.rejects(
    async () => flows.dispenserAction({ params: { GIVE_TICK: 'JDOG' } }),
    /params\.GIVE_AMOUNT is required for create/,
    'dispenserAction rejects missing GIVE_AMOUNT on create',
);
await assert.rejects(
    async () => flows.dispenserAction({ params: { GIVE_TICK: 'JDOG', GIVE_AMOUNT: '1' } }),
    /params\.GET_AMOUNT is required for create/,
    'dispenserAction rejects missing GET_AMOUNT on create',
);
await assert.rejects(
    async () => flows.dispenserAction({ params: { GIVE_TICK: 'JDOG', GIVE_AMOUNT: '1', GET_AMOUNT: '0.01' } }),
    /GET_TICK.*or params\.GET_COIN/,
    'dispenserAction rejects create without GET_TICK or GET_COIN',
);
await assert.rejects(
    async () => flows.dispenserAction({
        params: { VERSION: '0', DISPENSER_ACTION_INDEX: '99' },
    }),
    /DISPENSER_ACTION_INDEX requires VERSION 1 or 2/,
    'dispenserAction rejects DISPENSER_ACTION_INDEX with VERSION 0',
);
await assert.rejects(
    async () => flows.dispenserAction({
        params: { GIVE_TICK: 'JDOG', GIVE_AMOUNT: '1', GET_AMOUNT: '0.01', GET_COIN: 'BTC' },
    }),
    /dispenserAction: from is required/,
    'dispenserAction rejects missing source (coin-paid lane otherwise valid)',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'dispenserAction.js'), 'utf8');
assert.ok(
    /action:\s*'DISPENSER'/.test(flowSrc),
    'dispenserAction flow forwards action: "DISPENSER" to submitAction',
);
assert.ok(
    /normalizeSource/.test(flowSrc),
    'dispenserAction flow reuses normalizeSource from sendAsset',
);

// --- 8. Decoder coverage ----------------------------------------------

{
    // v0 — coin-paid (primary §40.7.1 lane; empty GET_TICK)
    const v0 = decoder.decodeAction({
        action: 'DISPENSER',
        params: {
            VERSION: '0',
            GIVE_COIN: 'BTC', GIVE_TICK: 'JDOG',
            GIVE_AMOUNT: '1', GIVE_ESCROW: '10',
            GET_COIN: 'BTC', GET_AMOUNT: '0.01',
        },
    });
    assert.ok(/Create dispenser/.test(v0.summary), 'v0 summary identifies create lane');
    assert.ok(
        v0.details.some((d) => d.label === 'Buyer pays (coin)' && d.value === 'BTC'),
        'v0 coin-paid surfaces Buyer pays (coin)',
    );
    assert.ok(
        v0.details.some((d) => d.label === 'Estimated fills' && d.value === '10'),
        'v0 computes estimated fill count',
    );
    assert.ok(
        !v0.warnings.some((w) => /ambiguous/.test(w)),
        'v0 coin-paid does not warn about ambiguous payment',
    );

    // v0 — escrow < give warning
    const v0small = decoder.decodeAction({
        action: 'DISPENSER',
        params: {
            VERSION: '0',
            GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10', GIVE_ESCROW: '1',
            GET_COIN: 'BTC', GET_AMOUNT: '0.01',
        },
    });
    assert.ok(
        v0small.warnings.some((w) => /smaller than a single fill/.test(w)),
        'v0 warns when escrow < give',
    );

    // v0 — oracle without FIAT_CODE warning
    const v0bareOracle = decoder.decodeAction({
        action: 'DISPENSER',
        params: {
            VERSION: '0',
            GIVE_TICK: 'JDOG', GIVE_AMOUNT: '10', GIVE_ESCROW: '100',
            GET_COIN: 'BTC', GET_AMOUNT: '0',
            ORACLE_ADDRESS: '1OracleAddrXXX',
        },
    });
    assert.ok(
        v0bareOracle.warnings.some((w) => /Oracle pricing requires FIAT_CODE/.test(w)),
        'v0 warns when oracle set without FIAT_CODE',
    );

    // v1 — Cancel
    const v1 = decoder.decodeAction({
        action: 'DISPENSER',
        params: { VERSION: '1', DISPENSER_ACTION_INDEX: '1234' },
    });
    assert.ok(/Cancel dispenser/.test(v1.summary), 'v1 summary identifies cancel lane');
    assert.ok(/#1234/.test(v1.summary), 'v1 summary includes dispenser index');
    assert.ok(
        v1.warnings.some((w) => /1-hour close window/.test(w)),
        'v1 warns about close delay',
    );

    // v2 — Edit
    const v2 = decoder.decodeAction({
        action: 'DISPENSER',
        params: { VERSION: '2', DISPENSER_ACTION_INDEX: '1234', GIVE_ESCROW: '100' },
    });
    assert.ok(/Edit dispenser/.test(v2.summary), 'v2 summary identifies edit lane');
    assert.ok(
        v2.details.some((d) => d.label === 'Refill escrow by' && d.value === '100'),
        'v2 surfaces escrow refill amount',
    );
    assert.ok(
        v2.warnings.some((w) => /1-hour delay/.test(w)),
        'v2 warns about list-change delay',
    );

    // pipe/semicolon in MEMO gets flagged
    const bad = decoder.decodeAction({
        action: 'DISPENSER',
        params: {
            VERSION: '0',
            GIVE_TICK: 'JDOG', GIVE_AMOUNT: '1', GIVE_ESCROW: '10',
            GET_COIN: 'BTC', GET_AMOUNT: '0.01',
            MEMO: 'bad|memo',
        },
    });
    assert.ok(
        bad.warnings.some((w) => /\| or ;/.test(w)),
        'decoder flags pipe/semicolon in MEMO',
    );
}

// --- 9. Background handler + messaging helpers -------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('action\.dispenser'/.test(bg),
    'background host registers action.dispenser',
);
assert.ok(
    /dispenserAction\(\{\s*\.\.\.req,\s*vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.dispenser handler forwards deps to dispenserAction',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function dispenserAction\b/.test(m),
        `${shell} messaging.js exports dispenserAction`,
    );
    assert.ok(
        /sendMessage\('action\.dispenser'/.test(m),
        `${shell} messaging.js routes dispenserAction via action.dispenser`,
    );
}

// --- 10. ActionsMenu + App.jsx sub-routes ------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        app.includes('DispenserForm'),
        `${shell} App.jsx imports DispenserForm`,
    );
    assert.ok(
        app.includes("'dispenser'"),
        `${shell} App.jsx tracks the dispenser sub-route`,
    );
    assert.ok(
        /id:\s*['"]dispenser['"]/.test(app),
        `${shell} App.jsx registers the dispenser entry in buildActionEntries`,
    );
    assert.ok(
        /onCreateDispenser:\s*\(\)\s*=>\s*setUnlockedView\('dispenser'\)/.test(app),
        `${shell} App.jsx wires onCreateDispenser to the dispenser sub-route`,
    );
}

console.log(
    'OK — dispenser form smoke (DispenserForm §40.7.1 + dispenserAction core flow + action.dispenser handler + three messaging helpers + ActionsMenu entry + popup/web/desktop wiring + decoder coverage for v0 coin-paid + v0 oracle-warn + v0 low-escrow-warn + v1 cancel + v2 edit + MEMO pipe/semicolon warn)',
);
