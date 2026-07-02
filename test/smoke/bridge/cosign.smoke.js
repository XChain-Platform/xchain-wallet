// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the §22 / P4 passive co-signer bridge transport (coSign). The
// dApp-bridge completeness smoke covers the inject method + handler
// registration; this asserts the remaining layers are wired end to end:
// broker method, Approvals interface + fail-closed default, bridge-spec
// surface, the read-only coSign.parse host handler, the approval UI, and the
// core flows the handler drives.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Core flows exist and are exported from the flows barrel.
const flowsIndex = read('packages/core/src/flows/index.js');
for (const name of [
    'provisionCoSignerAccount',
    'passiveCoSignForAccount',
    'previewCoSignRequest',
    'findCoSignerAccountByAddress',
]) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(flowsIndex), `flows barrel exports ${name}`);
}
for (const f of [
    'packages/core/src/flows/passiveCoSign.js',
    'packages/core/src/flows/passiveCoSignForAccount.js',
    'packages/core/src/flows/previewCoSignRequest.js',
    'packages/core/src/flows/provisionCoSignerAccount.js',
    'packages/core/src/cosigner/vaultWindowStore.js',
    'packages/core/src/cosigner/vaultWindowPersistence.js',
    'packages/core/src/schemas/coSignerAccount.js',
]) {
    assert.ok(existsSync(join(root, f)), `${f} exists`);
}

// 2. Vault wires the coSignerAccounts collection.
const vaultSrc = read('packages/core/src/storage/Vault.js');
assert.ok(/coSignerAccounts\s*=\s*makeCollection/.test(vaultSrc), 'Vault registers coSignerAccounts collection');
const codecSrc = read('packages/core/src/storage/codec.js');
assert.ok(/coSignerAccounts/.test(codecSrc), 'codec includes coSignerAccounts (emptyDocument + merge)');

// 3. bridge-spec exposes the coSign surface.
const spec = read('packages/bridge-spec/src/index.ts');
for (const t of ['CoSignParams', 'CoSignResult', 'coSign(params: CoSignParams)']) {
    assert.ok(spec.includes(t), `bridge-spec declares ${t}`);
}

// 4. Broker + Approvals wiring.
const broker = read('packages/extension/src/background/approvalBroker.js');
assert.ok(/coSign\(req\)\s*\{\s*return this\._request\('coSign', req\)/.test(broker), 'ApprovalBroker.coSign parks a coSign approval');
const approvals = read('packages/extension/src/bridge/Approvals.js');
assert.ok(/coSign/.test(approvals), 'Approvals interface + rejectAll include coSign');

// The default rejects coSign fail-closed (a shell without an approval popup
// gets a structured error rather than an unguarded signature).
const { rejectAllApprovals, ApprovalRequiredError } = await import(
    join(root, 'packages/extension/src/bridge/Approvals.js')
);
await assert.rejects(
    () => rejectAllApprovals.coSign({ origin: 'x', kind: 'coSign' }),
    (e) => e instanceof ApprovalRequiredError && e.operation === 'coSign',
    'rejectAllApprovals.coSign throws ApprovalRequiredError',
);

// 5. Background handler drives the co-sign flow, and the read-only preview
//    handler is registered.
const handlers = read('packages/extension/src/bridge/handlers.js');
assert.ok(/findCoSignerAccountByAddress/.test(handlers), 'coSign handler resolves the account by aggregate address');
assert.ok(/passiveCoSignForAccount/.test(handlers), 'coSign handler drives passiveCoSignForAccount on approval');
assert.ok(/approvals\.coSign\(/.test(handlers), 'coSign handler always prompts via approvals.coSign');
const bgHost = read('packages/extension/src/background/createBackgroundHost.js');
assert.ok(/register\(\s*'coSign\.parse'/.test(bgHost), 'background registers coSign.parse preview handler');
assert.ok(/previewCoSignRequest/.test(bgHost), 'coSign.parse handler calls previewCoSignRequest');

// 6. Approval UI surfaces a legible co-sign intent (always-prompt safety).
const approvalUi = read('packages/extension/src/approval/kinds/SignApproval.jsx');
assert.ok(/coSign:\s*'Co-sign transaction'/.test(approvalUi), 'SignApproval titles the coSign kind');
assert.ok(/CoSignIntentSummary/.test(approvalUi), 'SignApproval renders CoSignIntentSummary');
assert.ok(/parseCoSign/.test(approvalUi), 'SignApproval decodes the request via parseCoSign');
const approvalMsg = read('packages/extension/src/approval/messaging.js');
assert.ok(/parseCoSign/.test(approvalMsg) && /coSign\.parse/.test(approvalMsg), 'approval messaging exposes parseCoSign -> coSign.parse');

console.log('OK: coSign bridge transport smoke (flows + vault collection + bridge-spec + broker + Approvals fail-closed + handler + coSign.parse + approval UI)');
