// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 6 — G068 part 2 — UI wiring of
// the duress passphrase: Locked.jsx silent-arm + Settings → Safety
// row mounting.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const lockedSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Locked.jsx'),
    'utf8',
);
const safetySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'SafetySection.jsx'),
    'utf8',
);
const rowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'DuressPassphraseRow.jsx'),
    'utf8',
);
const flowsIndex = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);

// --- flows/index re-exports -------------------------------------------

for (const name of [
    'isDuressConfigured',
    'setDuressPassphrase',
    'clearDuressPassphrase',
    'isDuressMatch',
    'tripDuressIfMatch',
    'DuressNotConfiguredError',
]) {
    assert.match(flowsIndex, new RegExp(`\\b${name}\\b`), `flows/index re-exports ${name}`);
}

// --- Locked.jsx silent-arm wiring -------------------------------------

assert.match(lockedSrc, /tripDuressIfMatch/, 'Locked imports tripDuressIfMatch');
// Trip must run INSIDE the InvalidPasswordError branch so the UI
// presents the same wrong-password message either way.
assert.match(
    lockedSrc,
    /isBadPassword[\s\S]*tripDuressIfMatch\(password\)/,
    'duress trip lives inside the bad-password branch',
);
// Trip must NOT run on the success path — duress passphrase that
// happens to match the real password must NOT arm panic mode.
assert.equal(
    /messaging\.unlockWallet\(password\);[\s\S]{0,200}tripDuressIfMatch/.test(lockedSrc),
    false,
    'duress is not tripped on the success path',
);
// Lockout still increments after a duress trip — observer must not
// see any difference.
assert.match(
    lockedSrc,
    /tripDuressIfMatch\(password\)[\s\S]{0,200}recordLockoutFailure\(\)/,
    'duress trip does not skip lockout increment',
);

// --- SafetySection mounts the new row ---------------------------------

assert.match(
    safetySrc,
    /import \{ DuressPassphraseRow \}/,
    'SafetySection imports DuressPassphraseRow',
);
assert.match(safetySrc, /<DuressPassphraseRow \/>/, 'SafetySection renders the row');

// --- DuressPassphraseRow logic ----------------------------------------

assert.match(rowSrc, /isDuressConfigured/, 'row reads configuration state');
assert.match(rowSrc, /setDuressPassphrase/, 'row imports setter');
assert.match(rowSrc, /clearDuressPassphrase/, 'row imports clear');
assert.match(rowSrc, /pass !== confirm/, 'set form requires matching confirm');
assert.match(
    rowSrc,
    /Passphrases do not match/,
    'mismatch error copy present',
);
assert.match(rowSrc, /role="alert"/, 'errors surface via role=alert');
assert.match(rowSrc, /autoComplete="new-password"/, 'inputs hint as new-password to managers');

console.log('duress-wiring smoke OK');
