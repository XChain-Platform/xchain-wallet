// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-38: chunked DEPLOY + the audited template library. Pins the
// whole chain (flow -> vault record -> host -> 3-shell messaging -> form) and,
// most importantly, the consensus rails the flow is built on: one deployer for
// every leg, an indexer wait between legs, and a resume that re-verifies chunks
// against the chain instead of trusting the local record.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');
const core = (...p) => read('packages', 'core', 'src', ...p);

// ---- flow ----
const flow = core('flows', 'deployChunked.js');
assert.match(flow, /VERSION: '4'/, 'carrier is DEPLOY v4');
assert.match(flow, /hasStaking \? '3' : '2'/, 'assembler is v2, or v3 with staking fields');
assert.doesNotMatch(flow, /CODE:/, 'the assembling leg carries CODE_HASH, never inline CODE');
assert.match(flow, /sdk\.planDeploy/, 'chunk math comes from the SDK planner, not a local re-derivation');
// Consensus rail 1: one deployer for every leg.
assert.match(flow, /sourceAddress: source\.address/, 'every leg funds from the pinned source address');
assert.match(flow, /same address/, 'resume refuses a different deployer');
// Consensus rail 2: indexed before the next leg.
assert.match(flow, /each chunk must index before the next leg/, 'indexer wait is mandatory, not optional');
assert.match(flow, /did not index/, 'a carrier that does not index stops the run before assembling');
// Consensus rail 3 + durability.
assert.match(flow, /CODE_HASH mismatch/, 'resume refuses a record whose source changed');
assert.match(flow, /verifyRecordedChunks/, 'resume re-verifies recorded chunks against the chain');

// ---- vault record ----
const schema = read('packages', 'core', 'src', 'schemas', 'pendingDeploy.js');
assert.match(schema, /sourceAddress/, 'record pins the deployer');
assert.match(schema, /codeHash/, 'record carries the chunk-group id');
assert.match(schema, /'chunking',\n    'assembling',\n    'done',/, 'three-stage lifecycle');
const vault = read('packages', 'core', 'src', 'storage', 'Vault.js');
assert.match(vault, /pendingDeploys/, 'collection registered on the vault');
const codec = read('packages', 'core', 'src', 'storage', 'codec.js');
assert.match(codec, /pendingDeploys: \[\]/, 'collection seeded in the empty document');
assert.match(codec, /pendingDeploys: parsed\.pendingDeploys/, 'collection read back on decode');

// ---- host + messaging ----
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
for (const route of [
    "'deploy.plan'", "'action.deployChunked'", "'action.deployChunked.hw'",
    "'pendingDeploys.listForWallet'", "'pendingDeploys.clear'",
    "'contracts.listTemplates'", "'contracts.scaffold'",
]) {
    assert.ok(host.includes(route), `host registers ${route}`);
}
assert.match(host, /waitForAction/, 'host supplies the indexer wait for the chunked run');
for (const shell of [['web', 'src'], ['desktop', 'renderer'], ['extension', 'src', 'popup']]) {
    const m = read('packages', ...shell, 'messaging.js');
    for (const fn of ['planDeploy', 'deployChunked', 'deployChunkedHw', 'listPendingDeploys', 'clearPendingDeploy', 'listContractTemplates', 'scaffoldContract']) {
        assert.match(m, new RegExp(`export function ${fn}\\b`), `${shell[0]} messaging exports ${fn}`);
    }
}

// ---- form ----
const form = core('shared', 'routes', 'DeployContractForm.jsx');
assert.match(form, /listContractTemplates/, 'form loads the template list');
assert.match(form, /handleUseTemplate/, 'form can scaffold from a template');
assert.match(form, /messaging\.planDeploy/, 'form sizes the deploy before signing');
assert.match(form, /plan\.single === false/, 'form routes over-cap sources into the chunked lane');
assert.match(form, /transactions plus 1 assembling transaction/, 'form states the real transaction count');
assert.match(form, /plan\.totalChunks \+ 1/, 'form totals the legs the user actually pays for');
assert.match(form, /A watch-only wallet cannot/, 'watcher mode is refused for the chunked lane, not half-served');
assert.match(form, /Resume this deploy/, 'resume banner offered for interrupted runs');
assert.match(form, /already on chain/, 'resume copy states the chunks are already paid for');
assert.match(form, /deployChunkedHw/, 'hardware lane wired');

// ---- SDK leg present (cross-repo coupling) ----
// The wallet refuses to guess the chunk math, so an SDK without planDeploy must
// fail loudly rather than silently deploy a broken group.
assert.match(flow, /this SDK build has no planDeploy/, 'missing SDK planner is a loud refusal');

console.log('deploy-chunked smoke: all assertions passed');
