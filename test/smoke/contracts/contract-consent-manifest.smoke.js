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
//   1. Every review screen that hands a contract authority puts the
//      manifest disclosure in the Confirm Standard facts card: EXECUTE,
//      DEPOSIT/WITHDRAW, controller bind, and contract stake.
//   2. Each surface fetches through useContractManifest with a `skip` that
//      defers the lookup to the review stage.
//   3. Bind and stake scope consent to the authority-granting direction
//      (no consent facts on unbind / unstake / delegate).
//   4. The facts render PC-39's trust states off `manifest.status` and
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
const sharedHooks = join(core, 'src', 'shared', 'hooks');

const read = (p) => readFileSync(p, 'utf8');

// 1 + 2: all four consent surfaces feed the facts card behind the hook.
const SURFACES = [
    ['ExecuteContractForm.jsx', 'EXECUTE'],
    ['ContractFundsForm.jsx', 'DEPOSIT / WITHDRAW'],
    ['ControllerBindForm.jsx', 'controller bind'],
    // Contract staking is the contract target of the one Staking form.
    ['StakingForm.jsx', 'contract stake'],
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
        /useContractManifest\(\{[\s\S]{0,320}?skip:[\s\S]{0,180}?stage !== 'review'/.test(src),
        `${label}: defers the lookup to the review stage`,
    );
    assert.ok(
        /status === 'unavailable'/.test(src) && /status === 'unrestricted'/.test(src),
        `${label}: distinguishes unavailable, unrestricted, and declared manifests`,
    );
    assert.ok(
        /The wallet couldn’t look up which actions/.test(src)
            && /Anything\. By continuing, you grant this contract/.test(src)
            && /Reported by the XChain index, not checked against the chain/.test(src)
            && /No limit of its own, so the network limit applies\./.test(src),
        `${label}: keeps the unavailable, unrestricted, provenance, and network-cap facts`,
    );
}

const executeSrc = read(join(sharedRoutes, 'ExecuteContractForm.jsx'));
const fundsSrc = read(join(sharedRoutes, 'ContractFundsForm.jsx'));
assert.ok(
    /facts: \[[\s\S]{0,500}?\.\.\.contractManifestFacts\(manifest\)/.test(executeSrc),
    'EXECUTE places manifest details in the Confirm Standard facts card',
);
assert.ok(
    /facts: contractManifestFacts\(manifest\)/.test(fundsSrc),
    'DEPOSIT / WITHDRAW places manifest details in the Confirm Standard facts card',
);
assert.equal(
    (executeSrc.match(/\.\.\.contractManifestFacts\(manifest\)/g) || []).length,
    2,
    'EXECUTE keeps manifest facts on watcher and software Confirm Standard paths',
);
assert.equal(
    (fundsSrc.match(/facts: contractManifestFacts\(manifest\)/g) || []).length,
    2,
    'DEPOSIT / WITHDRAW keeps manifest facts on watcher and software Confirm Standard paths',
);

// 3: consent is scoped to the authority-granting direction.
const bindSrc = read(join(sharedRoutes, 'ControllerBindForm.jsx'));
assert.ok(
    /skip: unbind \|\|/.test(bindSrc),
    'controller bind: no manifest lookup when unbinding (revoking needs no consent)',
);
assert.ok(
    /const consentFacts = useMemo\(\(\) => \{[\s\S]{0,80}?if \(unbind\) return \[\];/.test(bindSrc)
        && /\.\.\.consentFacts/.test(bindSrc)
        && /facts: controllerFacts/.test(bindSrc),
    'controller bind: consent facts feed Confirm Standard on bind only',
);
assert.equal(
    (bindSrc.match(/facts: controllerFacts/g) || []).length,
    2,
    'controller bind keeps consent facts on watcher and software Confirm Standard paths',
);

const stakeSrc = read(join(sharedRoutes, 'StakingForm.jsx'));
assert.ok(
    /skip: !isContract \|\| currentAction !== 'stake' \|\|/.test(stakeSrc),
    'contract stake: no manifest lookup for unstake / delegate or a validator stake',
);
assert.ok(
    /currentAction === 'stake' \? \{ facts: contractManifestFacts\(manifest\) \} : \{\}/.test(stakeSrc),
    'contract stake: consent facts feed Confirm Standard on the stake leg only',
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
