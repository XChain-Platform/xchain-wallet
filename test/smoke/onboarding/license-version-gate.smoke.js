// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §25.1 / Cluster J FOLLOWUP 4 smoke: license re-acceptance gate
// covers the unlocked Add-Wallet lane when the version bumps.
//
// v0.186.0 added a `licenseAcceptedAt` localStorage key + a one-shot
// gate at first launch. The gate skipped when `onBack` was supplied
// (the unlocked-vault "Add Wallet" entry point) on the assumption that
// the user accepted at install. v0.281.0 introduces `LICENSE_VERSION`:
// when the binding terms in LICENSE.md change, bumping the constant
// forces every user (including those entering through Add Wallet)
// to re-accept.
//
// Asserts:
//   1. `LICENSE_VERSION` exported from buildInfo.js as a non-empty
//      string.
//   2. Onboarding.jsx imports LICENSE_VERSION + reads / writes the
//      versioned acceptance key.
//   3. The gate condition is `!licenseSatisfied` (no longer guards
//      with `&& !onBack`): version mismatch shows the gate even
//      from the Add-Wallet path.
//   4. `markAccepted()` writes both the timestamp AND the current
//      LICENSE_VERSION.
//   5. `licenseSatisfied` is true only when both keys are present and
//      the version matches the current constant.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. LICENSE_VERSION exported -------------------------------------

const buildInfo = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'buildInfo.js'),
    'utf8',
);
assert.ok(
    /export const LICENSE_VERSION = '[^']+'/.test(buildInfo),
    'buildInfo exports LICENSE_VERSION as a non-empty string',
);
const versionMatch = buildInfo.match(/export const LICENSE_VERSION = '([^']+)'/);
assert.ok(versionMatch && versionMatch[1].length > 0, 'LICENSE_VERSION value present');

// --- 2. Onboarding wires the version key -----------------------------

const onboarding = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Onboarding.jsx'),
    'utf8',
);
assert.ok(
    /import \{[^}]*LICENSE_VERSION[^}]*\} from '\.\.\/\.\.\/buildInfo\.js'/.test(onboarding),
    'Onboarding imports LICENSE_VERSION from buildInfo',
);
assert.ok(
    /const LICENSE_VERSION_KEY = 'xc:licenseAcceptedVersion'/.test(onboarding),
    'Onboarding declares the version-key constant',
);
assert.ok(/function readAcceptedVersion/.test(onboarding),
    'Onboarding has readAcceptedVersion helper');
assert.ok(
    /readAcceptedVersion\(\)/.test(onboarding),
    'Onboarding reads the stored version on mount',
);
assert.ok(
    /licenseSatisfied =\s*!!licenseAcceptedAt && licenseAcceptedVersion === LICENSE_VERSION/.test(onboarding),
    'licenseSatisfied = both keys present AND version matches',
);

// --- 3. Gate condition no longer skips for onBack -------------------

assert.ok(
    /if \(!licenseSatisfied\) \{/.test(onboarding),
    'gate condition is `if (!licenseSatisfied)`: onBack no longer bypasses re-acceptance',
);
// Make sure the original "&& !onBack" guard is gone from the gate
// branch.
assert.ok(
    !/!licenseAcceptedAt && !onBack/.test(onboarding),
    'old "!licenseAcceptedAt && !onBack" guard is removed',
);

// --- 4. markAccepted writes both keys -------------------------------

assert.ok(
    /setItem\(LICENSE_STORAGE_KEY, new Date\(\)\.toISOString\(\)\);[\s\S]{0,80}setItem\(LICENSE_VERSION_KEY, LICENSE_VERSION\)/.test(onboarding),
    'markAccepted writes both timestamp + LICENSE_VERSION',
);
assert.ok(
    /setLicenseAcceptedVersion\(LICENSE_VERSION\)/.test(onboarding),
    'handleAcceptLicense reflects the version into local state',
);

// --- 5. Smoke the helpers in isolation by re-implementing the bits --

// Read the constants from source so the smoke isn't redundantly
// hard-coded: when LICENSE_VERSION bumps, the smoke continues to pass.
const fakeStore = new Map();
const localStorage = {
    getItem(k) { return fakeStore.has(k) ? fakeStore.get(k) : null; },
    setItem(k, v) { fakeStore.set(k, v); },
    removeItem(k) { fakeStore.delete(k); },
};

function readAcceptedAt() { return localStorage.getItem('xc:licenseAcceptedAt') || null; }
function readAcceptedVersion() { return localStorage.getItem('xc:licenseAcceptedVersion') || null; }
function markAccepted(version) {
    localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
    localStorage.setItem('xc:licenseAcceptedVersion', version);
}
function isSatisfied(version) {
    return !!readAcceptedAt() && readAcceptedVersion() === version;
}

const CURRENT = versionMatch[1];

// Fresh install: not satisfied.
assert.equal(isSatisfied(CURRENT), false);

// Old-version-only acceptance (pre-FOLLOWUP user): not satisfied
// because no version is stored.
fakeStore.set('xc:licenseAcceptedAt', '2025-01-01T00:00:00Z');
assert.equal(isSatisfied(CURRENT), false,
    'pre-versioned acceptance is treated as stale');

// Accept current version: satisfied.
markAccepted(CURRENT);
assert.equal(isSatisfied(CURRENT), true);

// Version bump: stored 'old' vs new '2'.
fakeStore.set('xc:licenseAcceptedVersion', '0');
assert.equal(isSatisfied('1'), false, 'version bump invalidates acceptance');

// Re-accept after bump.
markAccepted('1');
assert.equal(isSatisfied('1'), true);

console.log(
    "OK: license-version-gate smoke (Cluster J FOLLOWUP 4) buildInfo exports LICENSE_VERSION; Onboarding reads xc:licenseAcceptedVersion alongside xc:licenseAcceptedAt; gate fires whenever stored version != current; Add-Wallet's onBack shortcut no longer bypasses re-acceptance; markAccepted writes both keys atomically; pre-versioned acceptance is treated as stale",
);
