// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 10 (piece 3c): DESTROY form.
//
// Asserts:
//   1. DestroyForm.jsx exists and exports a single component, reusing
//      IssueTokenForm's CSS module.
//   2. Two-stage state machine (form → review/submitting → done).
//   3. Form stage renders an explicit irreversibility prose block so
//      the user sees the warning before composing, not just on review.
//   4. Review runs DESTROY params through decoder.decodeAction.
//   5. Sign wires through messaging.destroyToken.
//   6. Sign button uses the danger variant (visual signal).
//   7. Core flow destroyToken exists + is re-exported + guards required
//      inputs.
//   8. Background host registers action.destroy; popup + web messaging
//      helpers export destroyToken.
//   9. ActionsMenu + App.jsx wire the 'destroy' sub-route and pass
//      onDestroy to buildActionEntries.

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

const formPath = join(sharedRoutes, 'DestroyForm.jsx');
assert.ok(existsSync(formPath), 'DestroyForm.jsx exists');
const src = readFileSync(formPath, 'utf8');

// --- 1. Public surface + CSS reuse ------------------------------------

assert.ok(/export function DestroyForm\b/.test(src), 'DestroyForm is a named export');
const exportCount = (src.match(/^export\s+(function|const|class)\b/gm) || []).length;
assert.equal(exportCount, 1, 'DestroyForm.jsx only exports the component');
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'DestroyForm reuses IssueTokenForm CSS module',
);

// --- 2. Two-stage state machine ---------------------------------------

for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `DestroyForm tracks stage "${stage}"`);
}

// --- 3. Form-stage irreversibility prose ------------------------------

assert.ok(
    /irreversible/i.test(src),
    'DestroyForm surfaces the irreversibility warning on the form stage',
);

// --- 4. Review runs through decoder.decodeAction ----------------------

assert.ok(
    /action:\s*['"]DESTROY['"]/.test(src),
    'DestroyForm calls decoder with action: "DESTROY"',
);
assert.ok(/decoderLib\.decodeAction/.test(src), 'DestroyForm invokes decoder.decodeAction');
assert.ok(src.includes('decoded.warnings'), 'DestroyForm renders decoder warnings');

// --- 5. Sign dispatch via the shared useActionForm hook (G6) ----------
//
// Signer dispatch (watcher / HW / software) moved into useActionForm;
// the form declares its messaging methods and calls the hook submit().

assert.ok(
    /useActionForm\(/.test(src),
    'DestroyForm dispatches through the shared useActionForm hook',
);
assert.ok(
    /software:\s*'destroyToken'/.test(src),
    'DestroyForm maps the software-signer path to destroyToken',
);
assert.ok(
    /hw:\s*'destroyAssetHw'/.test(src),
    'DestroyForm maps the hardware-signer path to destroyAssetHw',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'DestroyForm distinguishes wrong-password from other errors',
);

// --- 6. Danger variant on the sign button ------------------------------
//
// §20 Cluster X Step 7: variant flips to 'primary' in watcher mode (the
// "Create unsigned transaction" CTA is not destructive; destruction happens at
// broadcast on a different wallet). Pin the conditional shape so a future
// drop of the danger variant doesn't go unnoticed.

assert.ok(
    /variant=\{isWatcherMode \? 'primary' : 'danger'\}/.test(src)
        || /variant="danger"/.test(src),
    'DestroyForm uses the danger variant (or watcher-mode-conditional flip) on the sign button',
);
assert.ok(
    src.includes("'danger'") || src.includes('"danger"'),
    'DestroyForm still uses the danger variant for full / HW signing',
);

// --- 7. Core flow -----------------------------------------------------

assert.equal(
    typeof flows.destroyToken,
    'function',
    'flows.destroyToken is re-exported from core',
);
await assert.rejects(
    async () => flows.destroyToken(),
    /destroyToken: opts is required/,
    'destroyToken rejects missing opts',
);
await assert.rejects(
    async () => flows.destroyToken({}),
    /destroyToken: params is required/,
    'destroyToken rejects missing params',
);
await assert.rejects(
    async () => flows.destroyToken({ params: {} }),
    /destroyToken: params\.TICK is required/,
    'destroyToken rejects empty TICK',
);
await assert.rejects(
    async () => flows.destroyToken({ params: { TICK: 'MYTOKEN' } }),
    /destroyToken: params\.AMOUNT is required/,
    'destroyToken rejects missing AMOUNT',
);
await assert.rejects(
    async () => flows.destroyToken({ params: { TICK: 'MYTOKEN', AMOUNT: '10' } }),
    /destroyToken: from is required/,
    'destroyToken rejects missing source',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'destroyToken.js'), 'utf8');
assert.ok(
    /action:\s*'DESTROY'/.test(flowSrc),
    'destroyToken flow forwards action: "DESTROY" to submitAction',
);

// --- 8. Background handler + messaging helpers ------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
assert.ok(
    /host\.register\('action\.destroy'/.test(bg),
    'background host registers action.destroy',
);
assert.ok(
    /destroyToken\(\{\s*\.\.\.req,\s*signer:[^}]+vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.destroy handler forwards deps to destroyToken',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function destroyToken\b/.test(m),
        `${shell} messaging.js exports destroyToken`,
    );
    assert.ok(
        /sendMessage\('action\.destroy'/.test(m),
        `${shell} messaging.js routes destroyToken via action.destroy`,
    );
}

// --- 9. ActionsMenu + App.jsx sub-routes ------------------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('DestroyForm'), `${shell} App.jsx imports DestroyForm`);
    assert.ok(
        app.includes("'destroy'"),
        `${shell} App.jsx tracks the destroy sub-route`,
    );
    assert.ok(
        /id:\s*['"]destroy['"]/.test(app),
        `${shell} App.jsx registers the destroy entry in buildActionEntries`,
    );
    assert.ok(
        /onDestroy:\s*\(\)\s*=>\s*setUnlockedView\('destroy'\)/.test(app),
        `${shell} App.jsx wires onDestroy to the destroy sub-route`,
    );
}

console.log(
    'OK: destroy form smoke (DestroyForm §40.4 + destroyToken core flow + action.destroy handler + both messaging helpers + ActionsMenu entry + danger-variant sign button + popup/web wiring)',
);
