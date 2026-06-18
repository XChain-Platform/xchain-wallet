// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic: Step 2: G066: Locked.jsx wiring
// for failed-attempts escalating delay.

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
const cssSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Locked.module.css'),
    'utf8',
);
const flowsIndexSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);

// --- imports -----------------------------------------------------------

assert.match(lockedSrc, /getLockoutState/, 'imports getLockoutState');
assert.match(lockedSrc, /getRemainingMs/, 'imports getRemainingMs');
assert.match(lockedSrc, /recordLockoutFailure/, 'imports recordLockoutFailure');
assert.match(lockedSrc, /recordLockoutSuccess/, 'imports recordLockoutSuccess');

assert.match(
    flowsIndexSrc,
    /recordFailure as recordLockoutFailure/,
    'flows/index re-exports recordFailure under namespaced name',
);

// --- state hooks -------------------------------------------------------

assert.match(lockedSrc, /useState\(getLockoutState\)/, 'lockout state seeded from storage');
assert.match(lockedSrc, /useState\(\(\) =>\s*getRemainingMs/, 'remainingMs initialised lazily');
assert.match(lockedSrc, /isLockedOut = remainingMs > 0/, 'derives isLockedOut');

// --- countdown ticker --------------------------------------------------

assert.match(lockedSrc, /setInterval/, 'countdown ticker via setInterval');
assert.match(lockedSrc, /clearInterval\(handle\)/, 'cleans up interval on unmount');
assert.match(lockedSrc, /if \(remainingMs <= 0\) return undefined/, 'ticker no-ops when not locked');

// --- submit gating -----------------------------------------------------

assert.match(
    lockedSrc,
    /if \(busy \|\| password\.length === 0 \|\| isLockedOut\) return/,
    'submit aborted while locked out',
);

// --- success path clears lockout --------------------------------------

assert.match(lockedSrc, /recordLockoutSuccess\(\)/, 'success clears persisted lockout');
assert.match(
    lockedSrc,
    /setLockout\(\{ failedAttempts: 0, lockedUntilMs: 0 \}\)/,
    'success resets local state too',
);

// --- failure path increments only on bad password ---------------------

assert.match(lockedSrc, /isBadPassword/, 'distinguishes bad-password from other errors');
assert.match(
    lockedSrc,
    /const next = recordLockoutFailure\(\)/,
    'increments only inside bad-password branch',
);
assert.match(
    lockedSrc,
    /Try again in \$\{formatCountdown\(nextRemaining\)\}/,
    'error message names retry window when locked',
);

// --- input + button disabled while locked ------------------------------

assert.match(
    lockedSrc,
    /disabled=\{busy \|\| isLockedOut\}/,
    'input disabled while locked',
);
assert.match(
    lockedSrc,
    /disabled=\{password\.length === 0 \|\| isLockedOut\}/,
    'submit button disabled while locked',
);
assert.match(
    lockedSrc,
    /Locked \(\$\{formatCountdown\(remainingMs\)\}\)/,
    'button label flips to Locked + countdown',
);

// --- banner aria + countdown formatting -------------------------------

assert.match(lockedSrc, /role="status"/, 'banner uses status role');
assert.match(lockedSrc, /aria-live="polite"/, 'banner is aria-live polite');
assert.match(lockedSrc, /Too many failed attempts/, 'banner copy present');

assert.match(
    lockedSrc,
    /function formatCountdown\(ms\)/,
    'countdown formatter defined locally',
);
assert.match(
    lockedSrc,
    /Math\.ceil\(ms \/ 1000\)/,
    'countdown rounds UP so it never shows 0 prematurely',
);

// --- CSS slot ----------------------------------------------------------

assert.match(cssSrc, /\.lockoutBanner\b/, 'lockoutBanner style class present');
assert.match(cssSrc, /\.lockoutCountdown\b/, 'lockoutCountdown style class present');
assert.match(cssSrc, /tabular-nums/, 'countdown uses tabular numerals');

console.log('locked-lockout smoke OK');
