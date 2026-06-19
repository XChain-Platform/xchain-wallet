// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 9 (piece 3b): MINT form.
//
// Asserts:
//   1. packages/core/src/shared/routes/MintForm.jsx exists and exports
//      a single component. Reuses IssueTokenForm.module.css styles.
//   2. Two-stage state machine (form → review/submitting → done)
//      matches the Send.jsx / IssueTokenForm pattern.
//   3. Review runs the composed MINT params through decoder.decodeAction.
//   4. Sign wires through messaging.mintToken (the new Step-9 helper).
//   5. Validation rejects empty ticker / non-A-Z-0-9-dot ticker / empty
//      or zero amount.
//   6. Params composer: VERSION='0', TICK uppercased, AMOUNT set,
//      DESTINATION only when non-empty.
//   7. Core flow mintToken exists and is re-exported from
//      @xchain-wallet/core flows. Guards required inputs.
//   8. Background host registers action.mint; both messaging helpers
//      export mintToken(opts) returning sendMessage('action.mint', …).
//   9. ActionsMenu entries include a 'mint' item; popup + web App.jsx
//      track the 'mint' sub-route and pass onMint to buildActionEntries.

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

// --- 4. Sign wires through messaging.mintToken ------------------------

assert.ok(
    /messaging\.mintToken\s*\(/.test(src),
    'MintForm calls messaging.mintToken from the sign stage',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'MintForm distinguishes wrong-password from other errors',
);

// --- 5. Validation ----------------------------------------------------

assert.ok(/Ticker is required/.test(src), 'MintForm rejects empty ticker');
assert.ok(
    /\[A-Za-z0-9\.\]\+|A-Za-z0-9\./.test(src),
    'MintForm validates ticker character set (subtokens allowed)',
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
    typeof flows.mintToken,
    'function',
    'flows.mintToken is re-exported from core',
);
await assert.rejects(
    async () => flows.mintToken(),
    /mintToken: opts is required/,
    'mintToken rejects missing opts',
);
await assert.rejects(
    async () => flows.mintToken({}),
    /mintToken: params is required/,
    'mintToken rejects missing params',
);
await assert.rejects(
    async () => flows.mintToken({ params: {} }),
    /mintToken: params\.TICK is required/,
    'mintToken rejects empty TICK',
);
await assert.rejects(
    async () => flows.mintToken({ params: { TICK: 'MYTOKEN' } }),
    /mintToken: params\.AMOUNT is required/,
    'mintToken rejects missing AMOUNT',
);
await assert.rejects(
    async () => flows.mintToken({ params: { TICK: 'MYTOKEN', AMOUNT: '10' } }),
    /mintToken: from is required/,
    'mintToken rejects missing source',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'mintToken.js'), 'utf8');
assert.ok(
    /action:\s*'MINT'/.test(flowSrc),
    'mintToken flow forwards action: "MINT" to submitAction',
);
assert.ok(
    /normalizeSource/.test(flowSrc),
    'mintToken flow reuses normalizeSource from sendToken',
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
    /mintToken\(\{\s*\.\.\.req,\s*signer:[^}]+vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.mint handler forwards deps to mintToken',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function mintToken\b/.test(m),
        `${shell} messaging.js exports mintToken`,
    );
    assert.ok(
        /sendMessage\('action\.mint'/.test(m),
        `${shell} messaging.js routes mintToken via action.mint`,
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
    'OK: mint form smoke (MintForm §40.3 + mintToken core flow + action.mint handler + both messaging helpers + ActionsMenu entry + popup/web wiring)',
);
