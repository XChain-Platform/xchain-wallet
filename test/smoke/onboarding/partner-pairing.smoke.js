// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §20.5 /  smoke: the watcher <-> signer pairing lane stays wired
// end to end across the host and all three shells.
//
// The behaviour is covered by test/unit/flows/pairPartner.test.js and
// test/unit/routes/PairPartnerWallet.test.jsx. This smoke is the cheap
// insurance against the cross-package half regressing silently: a lane
// wired in the web shell but dropped from desktop is exactly the class of
// gap the FOLLOWUPS ledger keeps recording ("desktop was missing the
// prereq shims entirely"), and neither unit test can see it.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...parts) => readFileSync(join(wsRoot, ...parts), 'utf8');

// --- 1. The core flow exists and exports the pairing surface ----------

const flow = read('packages', 'core', 'src', 'flows', 'pairPartner.js');
for (const name of [
    'partnerModeFor',
    'describePairingLane',
    'collectPairingKeys',
    'buildPairingPayload',
    'encodePairingPayload',
    'parsePairingPayload',
    'verifyPartnerPairing',
    'pairPartner',
    'partnerPairingSourceKeys',
]) {
    assert.ok(
        new RegExp(`export (?:async )?function ${name}\\(`).test(flow),
        `pairPartner.js exports ${name}`,
    );
}

// The two call-to-action strings are the user-visible contract of the
// lane; §20.5 names them, so pin them rather than leaving them free.
assert.ok(flow.includes("'Pair a signer'"), 'the watcher half offers "Pair a signer"');
assert.ok(flow.includes("'Pair a watcher'"), 'the signer half offers "Pair a watcher"');

// Nothing private may ride the pairing payload.
assert.ok(
    !/privateKey|xprv|mnemonic/.test(flow.replace(/\/\/.*$/gm, '')),
    'the pairing flow never touches private key material outside comments',
);

const flowsIndex = read('packages', 'core', 'src', 'flows', 'index.js');
assert.ok(
    /from '\.\/pairPartner\.js'/.test(flowsIndex),
    'flows/index.js re-exports the pairing flow',
);

// --- 2. Settings carries the verified partner record ------------------

const settings = read('packages', 'core', 'src', 'schemas', 'settings.js');
assert.ok(/partnerPairing: null/.test(settings), 'settings default to unpaired');
assert.ok(
    /r\.partnerPairing !== undefined && r\.partnerPairing !== null/.test(settings),
    'validateSettings is v2-tolerant about partnerPairing (absent / null both fine)',
);

// --- 3. Host routes ---------------------------------------------------

const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
for (const route of ['pairing.payload', 'pairing.pair', 'pairing.unpair']) {
    assert.ok(
        host.includes(`host.register('${route}'`),
        `createBackgroundHost registers ${route}`,
    );
}
assert.ok(
    /collectPairingKeys,/.test(host) && /pairPartner,/.test(host),
    'the host imports the pairing flow from core rather than re-implementing it',
);
assert.ok(
    /if \(!pooled\) signer\.lock\(\)/.test(host),
    'a signer the pairing route unlocked itself is locked again on the way out',
);

// --- 4. Messaging shims in all three shells ---------------------------

const shells = [
    ['web', join('packages', 'web', 'src', 'messaging.js')],
    ['extension', join('packages', 'extension', 'src', 'popup', 'messaging.js')],
    ['desktop', join('packages', 'desktop', 'renderer', 'messaging.js')],
];
for (const [name, rel] of shells) {
    const src = readFileSync(join(wsRoot, rel), 'utf8');
    for (const shim of ['pairingPayloadRequest', 'pairPartnerRequest', 'unpairPartnerRequest']) {
        assert.ok(
            new RegExp(`export function ${shim}\\(`).test(src),
            `${name} shell exposes ${shim}`,
        );
    }
    assert.ok(src.includes("'pairing.payload'"), `${name} shim targets the pairing.payload route`);
    assert.ok(src.includes("'pairing.pair'"), `${name} shim targets the pairing.pair route`);
}

// --- 5. The onboarding lane is reachable in all three shells ----------

const route = read('packages', 'core', 'src', 'shared', 'routes', 'PairPartnerWallet.jsx');
assert.ok(
    /export function PairPartnerWallet\(/.test(route),
    'PairPartnerWallet.jsx exports the route component',
);
for (const stage of ['role', 'seed', 'exchange']) {
    assert.ok(route.includes(`stage === '${stage}'`), `the lane renders its ${stage} stage`);
}

const onboarding = read('packages', 'core', 'src', 'shared', 'routes', 'Onboarding.jsx');
assert.ok(
    /onPairPartner/.test(onboarding) && /Pair a watcher or signer/.test(onboarding),
    'Onboarding exposes the pairing lane behind an onPairPartner prop',
);

const appShells = [
    ['web', join('packages', 'web', 'src', 'App.jsx')],
    ['extension', join('packages', 'extension', 'src', 'popup', 'App.jsx')],
    ['desktop', join('packages', 'desktop', 'renderer', 'App.jsx')],
];
for (const [name, rel] of appShells) {
    const src = readFileSync(join(wsRoot, rel), 'utf8');
    assert.ok(
        src.includes('PairPartnerWallet'),
        `${name} shell imports and renders PairPartnerWallet`,
    );
    assert.ok(
        src.includes("onboardingStep === 'pair-partner'"),
        `${name} shell routes the pair-partner onboarding step`,
    );
    assert.ok(
        src.includes("onPairPartner={() => setOnboardingStep('pair-partner')}"),
        `${name} shell wires the Onboarding entry point`,
    );
}

console.log('partner-pairing smoke OK');
