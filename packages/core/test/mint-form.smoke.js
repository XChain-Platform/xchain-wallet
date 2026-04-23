// Smoke for Phase 2 — Step 9 (piece 3b) — MINT form.
//
// Asserts:
//   1. packages/core/src/shared/routes/MintForm.jsx exists and exports
//      a single component. Reuses IssueTokenForm.module.css styles.
//   2. Two-stage state machine (form → review/submitting → done)
//      matches the Send.jsx / IssueTokenForm pattern.
//   3. Review runs the composed MINT params through decoder.decodeAction.
//   4. Sign wires through messaging.mintAsset — the new Step-9 helper.
//   5. Validation rejects empty ticker / non-A-Z-0-9-dot ticker / empty
//      or zero amount.
//   6. Params composer: VERSION='0', TICK uppercased, AMOUNT set,
//      DESTINATION only when non-empty.
//   7. Core flow mintAsset exists and is re-exported from
//      @xchain-wallet/core flows. Guards required inputs.
//   8. Background host registers action.mint; both messaging helpers
//      export mintAsset(opts) returning sendMessage('action.mint', …).
//   9. ActionsMenu entries include a 'mint' item; popup + web App.jsx
//      track the 'mint' sub-route and pass onMint to buildActionEntries.

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
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'MintForm.jsx');
assert.ok(existsSync(formPath), 'MintForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Public surface + CSS reuse ------------------------------------

assert.ok(
    /export function MintForm\b/.test(src),
    'MintForm is a named export',
);
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'MintForm.jsx only exports the component');
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'MintForm reuses IssueTokenForm CSS module (same visual shape)',
);

// --- 2. Two-stage state machine ---------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `MintForm tracks stage "${stage}"`);
}

// --- 3. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]MINT['"]/.test(src),
    'MintForm calls decoder with action: "MINT"',
);
assert.ok(
    /decoderLib\.decodeAction/.test(src),
    'MintForm invokes decoder.decodeAction',
);
assert.ok(src.includes('decoded.warnings'), 'MintForm renders decoder warnings');

// --- 4. Sign wires through messaging.mintAsset ------------------------

assert.ok(
    /messaging\.mintAsset\s*\(/.test(src),
    'MintForm calls messaging.mintAsset from the sign stage',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'MintForm distinguishes wrong-password from other errors',
);

// --- 5. Validation ----------------------------------------------------

assert.ok(/Ticker is required/.test(src), 'MintForm rejects empty ticker');
assert.ok(
    /\[A-Za-z0-9\.\]\+|A-Za-z0-9\./.test(src),
    'MintForm validates ticker character set (subassets allowed)',
);
assert.ok(
    /Amount must be a positive number/.test(src),
    'MintForm rejects zero/empty amount',
);

// --- 6. Params composer -----------------------------------------------

assert.ok(/VERSION:\s*'0'/.test(src), 'MintForm pins VERSION=0');
assert.ok(/\.toUpperCase\(\)/.test(src), 'MintForm uppercases ticker');
assert.ok(/AMOUNT:\s*String/.test(src), 'MintForm sets AMOUNT');
assert.ok(
    /p\.DESTINATION\s*=\s*destination\.trim\(\)/.test(src),
    'MintForm only sets DESTINATION when non-empty',
);

// --- 7. Core flow -----------------------------------------------------

assert.equal(
    typeof flows.mintAsset,
    'function',
    'flows.mintAsset is re-exported from core',
);
await assert.rejects(
    async () => flows.mintAsset(),
    /mintAsset: opts is required/,
    'mintAsset rejects missing opts',
);
await assert.rejects(
    async () => flows.mintAsset({}),
    /mintAsset: params is required/,
    'mintAsset rejects missing params',
);
await assert.rejects(
    async () => flows.mintAsset({ params: {} }),
    /mintAsset: params\.TICK is required/,
    'mintAsset rejects empty TICK',
);
await assert.rejects(
    async () => flows.mintAsset({ params: { TICK: 'MYTOKEN' } }),
    /mintAsset: params\.AMOUNT is required/,
    'mintAsset rejects missing AMOUNT',
);
await assert.rejects(
    async () => flows.mintAsset({ params: { TICK: 'MYTOKEN', AMOUNT: '10' } }),
    /mintAsset: from is required/,
    'mintAsset rejects missing source',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'mintAsset.js'), 'utf8');
assert.ok(
    /action:\s*'MINT'/.test(flowSrc),
    'mintAsset flow forwards action: "MINT" to submitAction',
);
assert.ok(
    /normalizeSource/.test(flowSrc),
    'mintAsset flow reuses normalizeSource from sendAsset',
);

// --- 8. Background handler + messaging helpers -------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('action\.mint'/.test(bg),
    'background host registers action.mint',
);
assert.ok(
    /mintAsset\(\{\s*\.\.\.req,\s*vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.mint handler forwards deps to mintAsset',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function mintAsset\b/.test(m),
        `${shell} messaging.js exports mintAsset`,
    );
    assert.ok(
        /sendMessage\('action\.mint'/.test(m),
        `${shell} messaging.js routes mintAsset via action.mint`,
    );
}

// --- 9. ActionsMenu + App.jsx sub-routes -------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(
        app.includes('MintForm'),
        `${shell} App.jsx imports MintForm`,
    );
    assert.ok(
        app.includes("'mint'"),
        `${shell} App.jsx tracks the mint sub-route`,
    );
    assert.ok(
        /id:\s*['"]mint['"]/.test(app),
        `${shell} App.jsx registers the mint entry in buildActionEntries`,
    );
    assert.ok(
        /onMint:\s*\(\)\s*=>\s*setUnlockedView\('mint'\)/.test(app),
        `${shell} App.jsx wires onMint to the mint sub-route`,
    );
}

console.log(
    'OK — mint form smoke (MintForm §40.3 + mintAsset core flow + action.mint handler + both messaging helpers + ActionsMenu entry + popup/web wiring)',
);
