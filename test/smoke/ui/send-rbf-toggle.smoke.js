// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX, Step 2: Send.jsx RBF toggle wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const sendSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx'),
    'utf8',
);
const sendCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.module.css'),
    'utf8',
);

// --- state ----------------------------------------------------------

assert.match(sendSrc, /const \[rbfEnabled, setRbfEnabled\] = useState\(true\)/, 'rbfEnabled defaults to true');

// --- settings-derived default ---------------------------------------

// §35.10: stored null follows the descriptor default, so Send resolves
// the entry through resolveFeeConfig instead of reading the raw field.
assert.match(
    sendSrc,
    /resolveFeeConfig\(settings\?\.fees\?\.\[chainId\]/,
    'resolves settings.fees[chainId] against the chain descriptor',
);
assert.match(
    sendSrc,
    /setRbfEnabled\(rbfByDefault\)/,
    'syncs state from the resolved preference on chain change',
);

// --- payload --------------------------------------------------------

// The payload carries the flag clamped to the descriptor's rbfSupported,
// so a chain without RBF (Dogecoin), or with no descriptor, never sends rbf:true.
assert.match(
    sendSrc,
    /const rbfSupported = descriptor\?\.feeStrategy\?\.rbfSupported === true;/,
    'reads the chain RBF capability from the descriptor, failing closed when it is missing',
);
assert.match(
    sendSrc,
    /const rbfForSend = rbfSupported && rbfEnabled;/,
    'clamps the per-send flag to the chain capability',
);
assert.match(
    sendSrc,
    /rbf:\s*rbfForSend,/,
    'clamped rbf flag flows into the send payload',
);
assert.doesNotMatch(sendSrc, /rbf:\s*rbfEnabled,/, 'no payload carries the unclamped flag');
const rbfSeed = sendSrc.slice(
    sendSrc.indexOf('const [rbfEnabled, setRbfEnabled]'),
    sendSrc.indexOf('setRbfEnabled(rbfByDefault)'),
);
assert.ok(rbfSeed.length > 0, 'RBF seeding effect located');
assert.doesNotMatch(
    rbfSeed,
    /settings\.fees\[chainId\]\) return;/,
    'a chain with no stored fee entry still reseeds from the descriptor',
);

// --- toggle UI ------------------------------------------------------

assert.match(sendSrc, /role="switch"/, 'toggle uses switch role');
assert.match(sendSrc, /checked=\{rbfForSend\}/);
assert.match(sendSrc, /disabled=\{!rbfSupported\}/, 'toggle disabled where the chain has no RBF');
assert.match(sendSrc, /aria-label="Replace-by-fee enabled"/);
assert.match(sendSrc, /Replace-by-fee/, 'visible label');
assert.match(
    sendSrc,
    /speeding up or cancelling/,
    'hint copy explains why',
);

// --- CSS hooks ------------------------------------------------------

for (const cls of ['rbfRow', 'rbfLabel', 'rbfHint']) {
    assert.match(sendCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('send-rbf-toggle smoke OK');
