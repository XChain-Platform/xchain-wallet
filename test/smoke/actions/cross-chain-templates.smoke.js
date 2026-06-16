// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 4 — Step 16 of 23 — Cross-chain templates
// (§42.8.4).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCrossChainTemplate } from '../../../packages/core/src/templates/cross-chain/validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');
const templatesDir = join(core, 'src', 'templates', 'cross-chain');

// --- Validator ---

assert.equal(typeof validateCrossChainTemplate, 'function',
    'validateCrossChainTemplate is exported');
assert.equal(validateCrossChainTemplate(null).ok, false,
    'validator rejects null');
assert.equal(validateCrossChainTemplate({}).ok, false,
    'validator rejects empty object');
assert.equal(validateCrossChainTemplate({
    id: 'x',
    name: 'X',
    description: 'X',
    actions: [{ chainHint: 'primary', action: 'SEND', params: {} }],
}).ok, true, 'validator accepts well-formed template');
const badAction = validateCrossChainTemplate({
    id: 'x',
    name: 'X',
    description: 'X',
    actions: [{ chainHint: 'unknown', action: '', params: null }],
});
assert.equal(badAction.ok, false, 'validator rejects bad action row');
assert.ok(badAction.errors.some((e) => /chainHint/.test(e)),
    'validator surfaces chainHint error');
assert.ok(badAction.errors.some((e) => /action/.test(e)),
    'validator surfaces action error');
assert.ok(badAction.errors.some((e) => /params/.test(e)),
    'validator surfaces params error');

// --- Bundled JSON files ---

const jsonFiles = readdirSync(templatesDir)
    .filter((n) => n.endsWith('.json'));
assert.ok(jsonFiles.length >= 3,
    `expected ≥3 bundled cross-chain templates, found ${jsonFiles.length}`);

// Each bundled JSON file must validate.
for (const name of jsonFiles) {
    const raw = readFileSync(join(templatesDir, name), 'utf8');
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (err) { assert.fail(`${name} is not valid JSON: ${err.message}`); }
    const res = validateCrossChainTemplate(parsed);
    assert.ok(res.ok, `${name} fails validation: ${res.ok ? '' : res.errors.join('; ')}`);
}

// The three reference templates from §42.8.4 must be present by id.
const expectedIds = new Set([
    'launch-token-with-metadata',
    'bridge-token-pair',
    'cross-chain-airdrop',
]);
const seenIds = new Set();
for (const name of jsonFiles) {
    const parsed = JSON.parse(readFileSync(join(templatesDir, name), 'utf8'));
    seenIds.add(parsed.id);
}
for (const id of expectedIds) {
    assert.ok(seenIds.has(id),
        `expected template id "${id}" to be bundled`);
}

// --- CrossChainTemplates route ---

const routePath = join(sharedRoutes, 'CrossChainTemplates.jsx');
assert.ok(existsSync(routePath), 'CrossChainTemplates.jsx exists');
const route = readFileSync(routePath, 'utf8');
assert.ok(/export function CrossChainTemplates\b/.test(route),
    'CrossChainTemplates is a named export');
assert.ok(/CROSS_CHAIN_TEMPLATES/.test(route),
    'CrossChainTemplates renders the bundled template list');
assert.ok(/Use template/.test(route),
    'CrossChainTemplates renders the "Use template" launch button');
assert.ok(/onLaunch/.test(route),
    'CrossChainTemplates calls onLaunch with resolved prefill rows');
assert.ok(/primary|secondary|tertiary/.test(route),
    'CrossChainTemplates resolves chainHint to a concrete chainId');

// --- ParallelComposer prefill plumbing ---

const composer = readFileSync(join(sharedRoutes, 'ParallelComposer.jsx'), 'utf8');
assert.ok(/initialRows/.test(composer),
    'ParallelComposer accepts an initialRows prop for template prefill');

// --- App.jsx wiring (all three shells) ---

for (const [shell, appPath] of [
    ['popup', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
    ['desktop', join(desktop, 'renderer', 'App.jsx')],
]) {
    const app = readFileSync(appPath, 'utf8');
    assert.ok(app.includes('CrossChainTemplates'),
        `${shell} App.jsx imports CrossChainTemplates`);
    assert.ok(app.includes("'cross-chain-templates'"),
        `${shell} tracks 'cross-chain-templates' sub-route`);
    assert.ok(/onCrossChainTemplates: \(\) => setUnlockedView\('cross-chain-templates'\)/.test(app),
        `${shell} ActionsMenu wires onCrossChainTemplates`);
    assert.ok(/parallelPrefill/.test(app),
        `${shell} App.jsx tracks parallelPrefill state`);
    assert.ok(/initialRows=\{parallelPrefill \|\| undefined\}/.test(app),
        `${shell} passes parallelPrefill into ParallelComposer.initialRows`);
    assert.ok(/Cross-chain templates/.test(app),
        `${shell} ActionsMenu surfaces the "Cross-chain templates" entry`);
}

console.log(
    'OK — cross-chain templates smoke (validator + 3 bundled reference templates: launch-token-with-metadata / bridge-token-pair / cross-chain-airdrop + CrossChainTemplates list route + ParallelComposer initialRows prefill prop + 3-shell App.jsx prefill plumbing + ActionsMenu entry)',
);
