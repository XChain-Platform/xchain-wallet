// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-36 atomic BATCH composer: the batchCommand flow (COMMAND
// assembly + constraint pre-check), its host + 3-shell messaging wiring,
// the BatchComposerForm surface, and its web-shell route wiring. Signing
// reuses the generic advancedAction path (action='BATCH'), so no new sign
// flow is asserted.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Flow: constraint pre-check + command builder ----
assert.equal(typeof flows.validateBatchConstraints, 'function', 'flows.validateBatchConstraints exported');
assert.equal(typeof flows.buildBatchCommand, 'function', 'flows.buildBatchCommand exported');
assert.deepEqual(flows.BATCH_FORBIDDEN_ACTIONS, ['BATCH'], 'forbidden actions pinned');
assert.deepEqual(flows.BATCH_SINGLETON_ACTIONS, ['ISSUE', 'DEPLOY', 'FILE'], 'singleton actions pinned');
assert.deepEqual(flows.validateBatchConstraints([{ action: 'SEND' }, { action: 'BROADCAST' }]), [], 'legal queue passes');
assert.ok(flows.validateBatchConstraints([{ action: 'DEPLOY' }]).length === 0, 'a single DEPLOY is legal');
assert.ok(flows.validateBatchConstraints([{ action: 'DEPLOY' }, { action: 'DEPLOY' }]).length > 0, 'two DEPLOYs rejected');
assert.ok(flows.validateBatchConstraints([
    { action: 'MINT', params: { TICK: 'JDOG' } },
    { action: 'MINT', params: { TICK: 'JDOG' } },
]).length > 0, 'two MINTs of the same token rejected');
assert.ok(flows.validateBatchConstraints([
    { action: 'MINT', params: { TICK: 'JDOG' } },
    { action: 'MINT', params: { TICK: 'PEPE' } },
]).length === 0, 'MINTs of two distinct tokens accepted');
assert.ok(flows.validateBatchConstraints([]).length > 0, 'empty queue rejected');

// ---- Host + 3-shell messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /host\.register\('batch\.buildCommand'/, 'host registers batch.buildCommand');
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    assert.ok(read(...shell).includes("'batch.buildCommand'"), `${shell.join('/')} exposes batch.buildCommand`);
}

// ---- BatchComposerForm surface ----
const form = read('packages', 'core', 'src', 'shared', 'routes', 'BatchComposerForm.jsx');
assert.match(form, /buildBatchCommand/, 'form composes via buildBatchCommand');
assert.match(form, /validateBatchConstraints/, 'form pre-checks constraints live');
assert.match(form, /action: 'BATCH'/, 'form signs a BATCH action');
assert.match(form, /advancedAction/, 'form signs through the generic advancedAction path');
assert.match(form, /buildActionPsbtRequest/, 'form supports watcher encode-only');
assert.match(form, /EXCLUDED_ACTIONS[\s\S]*'FILE'/, 'FILE is excluded from the picker');
assert.match(form, /const EXCLUDED_ACTIONS = new Set\(\['BATCH', 'FILE'\]\)/, 'DEPLOY is no longer excluded: only nested BATCH and FILE are (D5)');
// A batch is NOT atomic: each sub-action validates and lands on its own, so a
// child that runs out of fee fails alone and its siblings stand. This assertion
// used to demand the word "Atomic" and had been red ever since the form started
// telling the truth instead - a gate pinning the OPPOSITE of the contract.
assert.match(form, /each still confirms on its own/,
    'form states that sub-actions confirm individually, not all-or-nothing');
assert.doesNotMatch(form, /\bAtomic\b/,
    'form must not claim atomicity: a batch is not all-or-nothing');

// ---- Web-shell route wiring (desktop/ext deferred: concurrent PC-30 edits) ----
const webApp = read('packages', 'web', 'src', 'App.jsx');
assert.match(webApp, /BatchComposerForm/, 'web App imports + renders BatchComposerForm');
assert.match(webApp, /'batch-compose'/, 'web App routes the batch-compose view');
assert.match(webApp, /id: 'batch'/, 'web App menu offers the atomic batch');

console.log('batch-composer smoke: all assertions passed');
