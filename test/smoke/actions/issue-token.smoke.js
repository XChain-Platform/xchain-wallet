// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 5 (piece 2c): issueToken flow +
// action.issue host handler + shell messaging helpers.
//
// End-to-end wiring behind the Token Creation Wizard's sign stage:
//
//   TokenWizard.jsx               → messaging.issueToken({ ... })
//   popup/messaging.js            → chrome.runtime.sendMessage('action.issue', ...)
//   web/messaging.js              → hostBridge.sendMessage('action.issue', ...)
//   createBackgroundHost.js       → host.register('action.issue', ...)
//   core/flows/issueToken.js      → submitAction({ action: 'ISSUE', params, ... })

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. Core flow -----------------------------------------------------

const flowPath = join(core, 'src', 'flows', 'issueToken.js');
assert.ok(existsSync(flowPath), 'core/src/flows/issueToken.js exists');

assert.equal(
    typeof flows.issueToken,
    'function',
    'flows.issueToken is re-exported from core',
);

const flowSrc = readFileSync(flowPath, 'utf8');
assert.ok(
    /action:\s*['"]ISSUE['"]/.test(flowSrc),
    'issueToken forwards action: "ISSUE" to submitAction',
);
assert.ok(
    /params\.TICK/.test(flowSrc),
    'issueToken validates params.TICK',
);
assert.ok(
    /normalizeSource\(opts\.from/.test(flowSrc),
    'issueToken normalizes the source address (reused from sendToken)',
);

// Guard rails: the flow rejects obvious misuse before sending the
// transaction to the encoder.
await assert.rejects(
    async () => flows.issueToken(),
    /issueToken: opts is required/,
    'issueToken rejects missing opts',
);
await assert.rejects(
    async () => flows.issueToken({}),
    /issueToken: params is required/,
    'issueToken rejects missing params',
);
await assert.rejects(
    async () => flows.issueToken({ params: {} }),
    /issueToken: params\.TICK is required/,
    'issueToken rejects empty TICK',
);
await assert.rejects(
    async () => flows.issueToken({ params: { TICK: 'MYTOKEN' } }),
    /issueToken: from is required/,
    'issueToken rejects missing source',
);

// --- 2. Background host handler --------------------------------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
assert.ok(
    /host\.register\(['"]action\.issue['"]/.test(bg),
    'createBackgroundHost registers action.issue',
);
assert.ok(
    /issueToken\(\{\s*\.\.\.req,\s*signer:[^}]+vault,\s*chainRegistry,\s*sdkRegistry\s*\}\)/.test(bg),
    'action.issue handler forwards to issueToken with injected deps',
);
assert.ok(
    /\bissueToken\b/.test(bg.split('} = flows;')[0]),
    'createBackgroundHost destructures issueToken from flows',
);

// --- 3. Messaging helpers --------------------------------------------

const popupMsg = readFileSync(join(ext, 'src', 'popup', 'messaging.js'), 'utf8');
const webMsg = readFileSync(join(web, 'src', 'messaging.js'), 'utf8');

for (const [shell, src] of [['popup', popupMsg], ['web', webMsg]]) {
    assert.ok(
        /export function issueToken\b/.test(src),
        `${shell} messaging.js exports issueToken`,
    );
    assert.ok(
        src.includes("'action.issue'"),
        `${shell} issueToken helper targets 'action.issue'`,
    );
}

// --- 4. Wizard calls through the helper -----------------------------

const wizard = readFileSync(
    join(core, 'src', 'shared', 'routes', 'TokenWizard.jsx'),
    'utf8',
);
assert.ok(
    /messaging\.issueToken\s*\(/.test(wizard),
    'TokenWizard calls messaging.issueToken from the sign stage',
);

console.log(
    'OK: issueToken smoke (flow + guard rails + action.issue handler wiring + messaging helpers + wizard call-site)',
);
