// Smoke for Phase 2 — Step 10 (piece 3c) — DESTROY form.
//
// Asserts:
//   1. DestroyForm.jsx exists and exports a single component, reusing
//      IssueTokenForm's CSS module.
//   2. Two-stage state machine (form → review/submitting → done).
//   3. Form stage renders an explicit irreversibility prose block so
//      the user sees the warning before composing, not just on review.
//   4. Review runs DESTROY params through decoder.decodeAction.
//   5. Sign wires through messaging.destroyAsset.
//   6. Sign button uses the danger variant (visual signal).
//   7. Core flow destroyAsset exists + is re-exported + guards required
//      inputs.
//   8. Background host registers action.destroy; popup + web messaging
//      helpers export destroyAsset.
//   9. ActionsMenu + App.jsx wire the 'destroy' sub-route and pass
//      onDestroy to buildActionEntries.

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

// --- 5. Sign wires through messaging.destroyAsset ---------------------

assert.ok(
    /messaging\.destroyAsset\s*\(/.test(src),
    'DestroyForm calls messaging.destroyAsset from the sign stage',
);
assert.ok(
    src.includes("'InvalidPasswordError'"),
    'DestroyForm distinguishes wrong-password from other errors',
);

// --- 6. Danger variant on the sign button ------------------------------

assert.ok(
    /variant="danger"/.test(src),
    'DestroyForm uses the danger variant on the sign button',
);

// --- 7. Core flow -----------------------------------------------------

assert.equal(
    typeof flows.destroyAsset,
    'function',
    'flows.destroyAsset is re-exported from core',
);
await assert.rejects(
    async () => flows.destroyAsset(),
    /destroyAsset: opts is required/,
    'destroyAsset rejects missing opts',
);
await assert.rejects(
    async () => flows.destroyAsset({}),
    /destroyAsset: params is required/,
    'destroyAsset rejects missing params',
);
await assert.rejects(
    async () => flows.destroyAsset({ params: {} }),
    /destroyAsset: params\.TICK is required/,
    'destroyAsset rejects empty TICK',
);
await assert.rejects(
    async () => flows.destroyAsset({ params: { TICK: 'MYTOKEN' } }),
    /destroyAsset: params\.AMOUNT is required/,
    'destroyAsset rejects missing AMOUNT',
);
await assert.rejects(
    async () => flows.destroyAsset({ params: { TICK: 'MYTOKEN', AMOUNT: '10' } }),
    /destroyAsset: from is required/,
    'destroyAsset rejects missing source',
);

const flowSrc = readFileSync(join(core, 'src', 'flows', 'destroyAsset.js'), 'utf8');
assert.ok(
    /action:\s*'DESTROY'/.test(flowSrc),
    'destroyAsset flow forwards action: "DESTROY" to submitAction',
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
    /destroyAsset\(\{\s*\.\.\.req,\s*vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.destroy handler forwards deps to destroyAsset',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(
        /export function destroyAsset\b/.test(m),
        `${shell} messaging.js exports destroyAsset`,
    );
    assert.ok(
        /sendMessage\('action\.destroy'/.test(m),
        `${shell} messaging.js routes destroyAsset via action.destroy`,
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
    'OK — destroy form smoke (DestroyForm §40.4 + destroyAsset core flow + action.destroy handler + both messaging helpers + ActionsMenu entry + danger-variant sign button + popup/web wiring)',
);
