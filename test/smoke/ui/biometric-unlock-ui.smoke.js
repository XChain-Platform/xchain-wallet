// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic, Step 4 (G063): biometric unlock UI
// wiring (Locked.jsx button + Settings → Safety BiometricRow).

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
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'BiometricRow.jsx'),
    'utf8',
);
const flowsIndex = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);

// --- flows/index re-exports -------------------------------------------

for (const name of [
    'isBiometricSupported',
    'isBiometricRegistered',
    'clearBiometricCredential',
    'registerBiometricCredential',
    'unlockWithBiometric',
    'BiometricUnsupportedError',
    'BiometricNotRegisteredError',
    'BiometricPrfUnavailableError',
]) {
    assert.match(flowsIndex, new RegExp(`\\b${name}\\b`), `flows/index re-exports ${name}`);
}

// --- Locked.jsx wiring -------------------------------------------------

assert.match(lockedSrc, /isBiometricSupported/, 'Locked imports isBiometricSupported');
assert.match(lockedSrc, /isBiometricRegistered/, 'Locked imports isBiometricRegistered');
assert.match(lockedSrc, /unlockWithBiometric/, 'Locked imports unlockWithBiometric');

assert.match(lockedSrc, /biometricAvailable/, 'Locked tracks biometricAvailable state');
assert.match(
    lockedSrc,
    /if \(!isBiometricRegistered\(\)\)/,
    'Locked short-circuits biometric probe when no credential registered',
);
assert.match(
    lockedSrc,
    /async function handleBiometric/,
    'Locked has a handleBiometric function',
);
assert.match(
    lockedSrc,
    /const unwrapped = await unlockWithBiometric\(\)/,
    'biometric path unwraps password before unlocking',
);
assert.match(
    lockedSrc,
    /await messaging\.unlockWallet\(unwrapped\)/,
    'biometric path then runs the standard unlock',
);
assert.match(
    lockedSrc,
    /recordLockoutSuccess\(\)/,
    'biometric success clears lockout',
);
// Biometric failure must NOT increment the lockout counter.
assert.equal(
    /handleBiometric[\s\S]*recordLockoutFailure/.test(lockedSrc),
    false,
    'biometric failure does NOT increment lockout',
);

assert.match(
    lockedSrc,
    /\{biometricAvailable \?[\s\S]*Use biometrics[\s\S]*\) : null\}/,
    'biometric button renders only when available',
);
assert.match(
    lockedSrc,
    /onClick=\{handleBiometric\}/,
    'biometric button wired to handler',
);

// --- SafetySection includes BiometricRow ------------------------------

assert.match(safetySrc, /import \{ BiometricRow \}/, 'SafetySection imports BiometricRow');
assert.match(safetySrc, /<BiometricRow \/>/, 'SafetySection renders BiometricRow');

// --- BiometricRow logic ------------------------------------------------

assert.match(
    rowSrc,
    /isBiometricSupported/,
    'BiometricRow probes platform support',
);
assert.match(
    rowSrc,
    /isBiometricRegistered/,
    'BiometricRow reads registration state',
);
assert.match(
    rowSrc,
    /registerBiometricCredential/,
    'Enable path calls register helper',
);
assert.match(
    rowSrc,
    /clearBiometricCredential/,
    'Disable path clears credential record',
);
assert.match(
    rowSrc,
    /supported === null/,
    'Pending probe state rendered before answer',
);
assert.match(
    rowSrc,
    /Not available/,
    'Unsupported state rendered',
);
assert.match(
    rowSrc,
    /password\.length === 0/,
    'Enable form requires password',
);
assert.match(
    rowSrc,
    /role="alert"/,
    'Enable form surfaces errors via role=alert',
);

console.log('biometric-unlock-ui smoke OK');
