// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 5 — G068 part 1 — sign-path
// gating + Settings → Safety wiring.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const submitSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'sdk', 'submitWithSigner.js'),
    'utf8',
);
const signFlowsSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'signFlows.js'),
    'utf8',
);
const multisigSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'multisigSignLocally.js'),
    'utf8',
);
const flowsIndex = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);
const safetySrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'SafetySection.jsx'),
    'utf8',
);
const rowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'settings', 'PanicModeRow.jsx'),
    'utf8',
);

// --- flows/index re-exports -------------------------------------------

for (const name of [
    'getPanicModeState',
    'getPanicRemainingMs',
    'isSigningFrozen',
    'activatePanicMode',
    'deactivatePanicMode',
    'assertSigningAllowed',
    'PanicModeActiveError',
    'PANIC_MODE_DEFAULT_DURATION_MS',
]) {
    assert.match(flowsIndex, new RegExp(`\\b${name}\\b`), `flows/index re-exports ${name}`);
}

// --- sign-path chokepoints all import + call assertSigningAllowed -----

for (const [src, name] of [
    [submitSrc, 'submitWithSigner'],
    [signFlowsSrc, 'signFlows'],
    [multisigSrc, 'multisigSignLocally'],
]) {
    assert.match(
        src,
        /import \{ assertSigningAllowed \} from .+panicMode\.js/,
        `${name} imports assertSigningAllowed`,
    );
    assert.match(
        src,
        /assertSigningAllowed\(\)/,
        `${name} calls assertSigningAllowed()`,
    );
}

// signFlows must call assertSigningAllowed in BOTH signMessageFlow + signPsbtFlow.
const signFlowsCalls = signFlowsSrc.match(/assertSigningAllowed\(\)/g) || [];
assert.equal(signFlowsCalls.length, 2, 'signFlows.js gates both flows (signMessage + signPsbt)');

// --- SafetySection wiring ---------------------------------------------

assert.match(safetySrc, /import \{ PanicModeRow \}/, 'SafetySection imports PanicModeRow');
assert.match(safetySrc, /<PanicModeRow \/>/, 'SafetySection renders PanicModeRow');

// The toggle's role changed from "Panic mode" enable to "Auto-arm".
assert.match(
    safetySrc,
    /Auto-arm panic mode/,
    'toggle relabelled as Auto-arm reservation',
);

// PanicModeRow must NOT be gated on settings.panicMode.enabled —
// activation must always be available for emergencies.
assert.equal(
    /settings\.panicMode\?\.enabled \? <PanicModeRow/.test(safetySrc),
    false,
    'PanicModeRow always renders (no toggle gate)',
);

// --- PanicModeRow logic ------------------------------------------------

assert.match(rowSrc, /activatePanicMode/, 'row imports activate');
assert.match(rowSrc, /deactivatePanicMode/, 'row imports deactivate');
assert.match(rowSrc, /getPanicRemainingMs/, 'row imports remaining-ms helper');
assert.match(rowSrc, /setInterval/, 'row ticks down');
assert.match(rowSrc, /clearInterval\(handle\)/, 'row cleans up interval');
assert.match(rowSrc, /isActive/, 'row toggles active vs inactive states');
assert.match(
    rowSrc,
    /Signing is frozen until the timer expires/,
    'active-state copy present',
);
assert.match(
    rowSrc,
    /Activate to freeze ALL signing/,
    'inactive-state copy present',
);
assert.match(
    rowSrc,
    /function formatPanicCountdown\(ms\)/,
    'has its own minute-granularity countdown formatter',
);
assert.match(
    rowSrc,
    /Math\.ceil\(ms \/ 60_000\)/,
    'panic countdown rounds UP at minute granularity',
);

console.log('panic-mode-wiring smoke OK');
