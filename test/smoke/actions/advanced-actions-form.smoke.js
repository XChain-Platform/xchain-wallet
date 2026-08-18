// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2 / Step 25 (piece 10): Advanced Actions form
// (§40.10). Generic "submit any XChain action" surface driven by the
// SDK's introspection API.
//
// Asserts:
//   1. AdvancedActionsForm.jsx exists + exports a single component;
//      reuses IssueTokenForm CSS (same precedent as DividendForm /
//      AirdropForm).
//   2. Four-stage state machine: compose → review → submitting → done.
//   3. Messaging call-sites: listActions, getActionFields,
//      getActionFormats, validateAction, advancedAction, and
//      password-error handling.
//   4. Rest-fields: form detects the '...' prefix and renders a
//      textarea; scalar fields render as Input. VERSION is auto-field
//      (not rendered).
//   5. Actions with dedicated forms are still listed but decorated.
//   6. Core flows: advancedAction + the four introspection
//      passthroughs are re-exported and guard required inputs.
//   7. Validation is routed through messaging.validateAction; the
//      `version` parameter, when non-empty, pins VERSION in the
//      submitted params.
//   8. Background host registers action.advanced, sdk.listActions,
//      sdk.getActionFormats, sdk.getActionFields, sdk.validateAction.
//   9. All three shells' messaging.js expose advancedAction +
//      listActions + getActionFormats + getActionFields +
//      validateAction with correct sendMessage routes.
//  10. ActionsMenu 'advanced' entry + App.jsx sub-route + onAdvanced
//      handler in popup / web / desktop.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';
import { surfacesEntry } from '../_action-entries.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

const formPath = join(sharedRoutes, 'AdvancedActionsForm.jsx');
assert.ok(existsSync(formPath), 'AdvancedActionsForm.jsx exists');

const src = readFileSync(formPath, 'utf8');

// --- 1. Single-component export --------------------------------------

assert.ok(/export function AdvancedActionsForm\b/.test(src), 'AdvancedActionsForm is named export');
// Exactly one COMPONENT export (PascalCase). The rule this pins is "one route
// file, one screen", not "one export": exporting a pure helper so it can carry
// its own unit suite is legitimate and desirable, and the original
// count-every-export form flagged exactly that (formatValidationError, which has
// five tests against it) as if it were a second component.
const componentExports = (src.match(/^export\s+(?:function|const|class)\s+([A-Z]\w*)/gm) || []);
assert.equal(
    componentExports.length,
    1,
    `AdvancedActionsForm.jsx exports exactly one component (found: ${componentExports.join(', ')})`,
);
assert.ok(
    /IssueTokenForm\.module\.css/.test(src),
    'AdvancedActionsForm reuses IssueTokenForm CSS',
);

// --- 2. Four-stage state machine -------------------------------------

for (const stage of ['compose', 'review', 'submitting', 'done']) {
    assert.ok(src.includes(`'${stage}'`), `AdvancedActionsForm tracks stage "${stage}"`);
}

// --- 3. Messaging call-sites -----------------------------------------

assert.ok(/messaging\.listActions\s*\(/.test(src), 'AdvancedActionsForm calls messaging.listActions');
assert.ok(/messaging\.getActionFields\s*\(/.test(src), 'AdvancedActionsForm calls messaging.getActionFields');
assert.ok(/messaging\.getActionFormats\s*\(/.test(src), 'AdvancedActionsForm calls messaging.getActionFormats');
assert.ok(/messaging\.validateAction\s*\(/.test(src), 'AdvancedActionsForm calls messaging.validateAction');
assert.ok(/messaging\.advancedAction\s*\(/.test(src), 'AdvancedActionsForm calls messaging.advancedAction');
assert.ok(src.includes("'InvalidPasswordError'"), 'AdvancedActionsForm handles wrong-password');

// --- 4. Rest-field + auto-field rendering ----------------------------

assert.ok(
    /REST_PREFIX\s*=\s*['"]\.\.\.['"]/.test(src),
    'AdvancedActionsForm defines REST_PREFIX = "..."',
);
assert.ok(
    /AUTO_FIELDS\s*=\s*new Set\(\[['"]VERSION['"]\]\)/.test(src),
    'AdvancedActionsForm treats VERSION as an auto-field',
);
assert.ok(/<textarea/.test(src), 'rest-fields render as a textarea');
assert.ok(/<Input\b/.test(src), 'scalar fields render as <Input>');

// --- 5. Dedicated-form decoration ------------------------------------

assert.ok(
    /ACTIONS_WITH_DEDICATED_FORMS\b/.test(src),
    'AdvancedActionsForm carries a dedicated-form set',
);
for (const dedicated of ['AIRDROP', 'DIVIDEND', 'DISPENSER', 'BROADCAST', 'ISSUE', 'MINT', 'DESTROY', 'SEND', 'SWEEP']) {
    assert.ok(
        src.includes(`'${dedicated}'`),
        `dedicated-form set names ${dedicated}`,
    );
}
assert.ok(
    /dedicated form available/.test(src),
    'dedicated-form decoration shows "(dedicated form available)" label',
);

// --- 6. Core flow guard-rails ----------------------------------------

for (const name of [
    'advancedAction',
    'listActions',
    'getActionFormats',
    'getActionFields',
    'validateActionDryRun',
]) {
    assert.equal(typeof flows[name], 'function', `flows.${name} re-exported`);
}

await assert.rejects(async () => flows.advancedAction(), /advancedAction: opts is required/);
await assert.rejects(async () => flows.advancedAction({ params: {} }), /action is required/);
await assert.rejects(async () => flows.advancedAction({ action: 'LINK' }), /params is required/);

await assert.rejects(async () => flows.listActions({}), /sdkRegistry is required/);
await assert.rejects(
    async () => flows.listActions({ sdkRegistry: {} }),
    /chainId is required/,
);
await assert.rejects(async () => flows.getActionFields({ sdkRegistry: {} }), /chainId is required/);
await assert.rejects(
    async () => flows.getActionFields({ sdkRegistry: {}, chainId: 'x' }),
    /action is required/,
);
await assert.rejects(
    async () => flows.validateActionDryRun({ sdkRegistry: {}, chainId: 'x' }),
    /action is required/,
);

// --- 6b. Introspection happy path against a mocked SDK --------------

{
    const sdk = {
        getActions: () => ['SEND', 'LINK', 'CALLBACK'],
        getActionFormats: (a) => ({ 0: 'VERSION|COIN1|COIN2' }),
        getActionFields: (a, v) => ['VERSION', 'COIN1', 'COIN2'],
        validateAction: (a, p) => ({
            valid: Object.keys(p).length > 0,
            errors: Object.keys(p).length === 0 ? [{ field: 'COIN1', message: 'required' }] : [],
        }),
    };
    const sdkRegistry = { get: () => sdk };

    const names = await flows.listActions({ sdkRegistry, chainId: 'bitcoin-mainnet' });
    assert.deepEqual(names, ['SEND', 'LINK', 'CALLBACK']);

    const fmts = await flows.getActionFormats({ sdkRegistry, chainId: 'bitcoin-mainnet', action: 'LINK' });
    assert.equal(fmts[0], 'VERSION|COIN1|COIN2');

    const fields = await flows.getActionFields({ sdkRegistry, chainId: 'bitcoin-mainnet', action: 'LINK' });
    assert.deepEqual(fields, ['VERSION', 'COIN1', 'COIN2']);

    const withVersion = await flows.getActionFields({
        sdkRegistry, chainId: 'bitcoin-mainnet', action: 'LINK', version: '0',
    });
    assert.deepEqual(withVersion, ['VERSION', 'COIN1', 'COIN2']);

    const good = await flows.validateActionDryRun({
        sdkRegistry, chainId: 'bitcoin-mainnet', action: 'LINK', params: { COIN1: 'X' },
    });
    assert.equal(good.valid, true);

    const bad = await flows.validateActionDryRun({
        sdkRegistry, chainId: 'bitcoin-mainnet', action: 'LINK', params: {},
    });
    assert.equal(bad.valid, false);
    assert.equal(bad.errors.length, 1);
}

// --- 7. Version pinning + params composition -------------------------

assert.ok(
    /out\.VERSION\s*=\s*String\(version\)/.test(src),
    'AdvancedActionsForm pins VERSION from the version picker when set',
);

// --- 8. Background handler registrations -----------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const route of [
    'action.advanced',
    'sdk.listActions',
    'sdk.getActionFormats',
    'sdk.getActionFields',
    'sdk.validateAction',
]) {
    assert.ok(
        bg.includes(`host.register('${route}'`),
        `background host registers ${route}`,
    );
}

// --- 9. Three-shell messaging ----------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['advancedAction', 'listActions', 'getActionFormats', 'getActionFields', 'validateAction']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(/sendMessage\('action\.advanced'/.test(m), `${shell} routes advancedAction`);
    assert.ok(/sendMessage\('sdk\.listActions'/.test(m), `${shell} routes listActions`);
    assert.ok(/sendMessage\('sdk\.getActionFormats'/.test(m), `${shell} routes getActionFormats`);
    assert.ok(/sendMessage\('sdk\.getActionFields'/.test(m), `${shell} routes getActionFields`);
    assert.ok(/sendMessage\('sdk\.validateAction'/.test(m), `${shell} routes validateAction`);
}

// --- 10. ActionsMenu entry + App.jsx sub-route ----------------------

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('AdvancedActionsForm'), `${shell} App.jsx imports AdvancedActionsForm`);
    assert.ok(app.includes("'advanced'"), `${shell} App.jsx tracks the advanced sub-route`);
    assert.ok(
        surfacesEntry(app, 'advanced', 'Advanced action'),
        `${shell} App.jsx registers the Advanced action entry`,
    );
    assert.ok(
        /onAdvanced:\s*\(\)\s*=>\s*setUnlockedView\('advanced'\)/.test(app),
        `${shell} App.jsx wires onAdvanced to the advanced sub-route`,
    );
}

console.log(
    'OK: advanced actions form smoke (AdvancedActionsForm §40.10: 4-stage machine + SDK introspection wiring + rest/auto field rendering + dedicated-form decoration + 5 core flows guard-railed + mocked SDK introspection round-trips + 5 BG handlers + 5 messaging exports × 3 shells + ActionsMenu entry + App.jsx sub-route in popup/web/desktop)',
);
