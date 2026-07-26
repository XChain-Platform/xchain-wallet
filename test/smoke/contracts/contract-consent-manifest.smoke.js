// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-39 (contract consent manifest).
//
// Asserts:
//   1. Every review screen that hands a contract authority mounts
//      ContractConsentPanel: EXECUTE, DEPOSIT/WITHDRAW, controller bind,
//      contract stake. This is the item's coverage claim, so it is the
//      assertion most worth pinning against a future refactor.
//   2. Each mount fetches through useContractManifest with a `skip` that
//      defers the lookup to the review stage.
//   3. Bind and stake scope consent to the authority-GRANTING direction
//      (no panel on unbind / unstake / delegate).
//   4. The panel renders PC-39's trust states off `manifest.status` and
//      carries the indexer-reported provenance caveat (the verified path
//      rides PC-50).
//   5. The flow reads the raw contract row, which is what makes an
//      unreachable explorer distinguishable from an unrestricted
//      contract, and is re-exported + host-wired for all three shells.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sharedRoutes = join(core, 'src', 'shared', 'routes');
const sharedComponents = join(core, 'src', 'shared', 'components');
const sharedHooks = join(core, 'src', 'shared', 'hooks');

const read = (p) => readFileSync(p, 'utf8');

// 1 + 2: all four consent surfaces mount the panel behind the hook.
const SURFACES = [
    ['ExecuteContractForm.jsx', 'EXECUTE'],
    ['ContractFundsForm.jsx', 'DEPOSIT / WITHDRAW'],
    ['ControllerBindForm.jsx', 'controller bind'],
    ['ContractStakeForm.jsx', 'contract stake'],
];

for (const [file, label] of SURFACES) {
    const path = join(sharedRoutes, file);
    assert.ok(existsSync(path), `${file} exists`);
    const src = read(path);
    assert.ok(
        /import \{ useContractManifest \} from '\.\.\/hooks\/useContractManifest\.js'/.test(src),
        `${label}: imports useContractManifest`,
    );
    assert.ok(
        /import \{ ContractConsentPanel \} from '\.\.\/components\/ContractConsentPanel\.jsx'/.test(src),
        `${label}: imports ContractConsentPanel`,
    );
    assert.ok(
        /<ContractConsentPanel[\s\S]{0,240}manifest=\{manifest\}/.test(src),
        `${label}: mounts the panel on its review screen`,
    );
    assert.ok(
        /useContractManifest\(\{[\s\S]{0,320}?skip:[\s\S]{0,160}?stage !== 'review'/.test(src),
        `${label}: defers the lookup to the review stage`,
    );
}

// 3: consent is scoped to the authority-granting direction.
const bindSrc = read(join(sharedRoutes, 'ControllerBindForm.jsx'));
assert.ok(
    /skip: unbind \|\|/.test(bindSrc),
    'controller bind: no manifest lookup when unbinding (revoking needs no consent)',
);
assert.ok(
    /\{!unbind \? \([\s\S]{0,200}<ContractConsentPanel/.test(bindSrc),
    'controller bind: the panel renders on bind only',
);

const stakeSrc = read(join(sharedRoutes, 'ContractStakeForm.jsx'));
assert.ok(
    /skip: mode !== 'stake' \|\|/.test(stakeSrc),
    'contract stake: no manifest lookup for unstake / delegate',
);
assert.ok(
    /\{mode === 'stake' \? \([\s\S]{0,200}<ContractConsentPanel/.test(stakeSrc),
    'contract stake: the panel renders on the stake leg only',
);

// 4: the panel's three trust states + the provenance caveat.
const panelSrc = read(join(sharedComponents, 'ContractConsentPanel.jsx'));
assert.ok(
    /status === 'unavailable'/.test(panelSrc) && /status === 'unrestricted'/.test(panelSrc),
    'panel branches on manifest.status, not on a bare null permissions',
);
assert.ok(
    /couldn&rsquo;t look up/.test(panelSrc),
    'panel states plainly when the wallet could not check',
);
assert.ok(
    /Anything\./.test(panelSrc) && /any action the protocol allows/.test(panelSrc),
    'panel states an undeclared allowlist as unrestricted (DEPLOY.md rule), not as a missing field',
);
assert.ok(
    /Reported by the XChain index, not checked against the chain by\s*\n?\s*this wallet/.test(panelSrc),
    'panel carries the indexer-reported provenance caveat (verified path rides PC-50)',
);
assert.ok(
    /the network limit applies/.test(panelSrc),
    'an absent per-contract cap reads as the network cap, not as "not declared"',
);

const hookSrc = read(join(sharedHooks, 'useContractManifest.js'));
assert.ok(
    /status: 'unavailable'/.test(hookSrc),
    'hook sentinel is unavailable, so a build without the host method never claims unrestricted',
);

// 5: the flow reads the raw row (the answered / not-answered signal).
const flowSrc = read(join(core, 'src', 'flows', 'contractDetail.js'));
assert.ok(
    /sdk\.getContract\(contractActionIndex\)/.test(flowSrc)
        && !/sdk\.getContractManifest\(/.test(flowSrc),
    'contractManifestFor reads the contract row, not the row-less SDK manifest wrapper',
);
assert.ok(
    /status: permissions === null \? 'unrestricted' : 'declared'/.test(flowSrc),
    'a resolved row is what promotes null permissions to unrestricted',
);
assert.equal(
    typeof flows.contractManifestFor, 'function',
    'contractManifestFor is re-exported from the flows barrel',
);

const hostSrc = read(join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'));
assert.ok(
    /contractManifestFor\(\{ \.\.\.req, sdkRegistry \}\)/.test(hostSrc),
    'background host passes the manifest read through (shared by all three shells)',
);

for (const shell of [
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
]) {
    assert.ok(
        /export function getContractManifest\(/.test(read(shell)),
        `${shell.split('/packages/')[1]}: exposes getContractManifest`,
    );
}

console.log(
    'OK: contract consent manifest smoke (PC-39: four consent surfaces + three trust states + indexer-reported provenance + raw-row flow)',
);
