// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX, Step 2: Send's RBF toggle wiring. The toggle lives in
// the shared Advanced section (formStandard/AdvancedSection.jsx); Send seeds
// its default from Settings and carries the clamped flag in its payload.

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
const advancedSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'formStandard', 'AdvancedSection.jsx'),
    'utf8',
);

// --- settings-derived default ---------------------------------------

// §35.10: stored null follows the descriptor default, so Send resolves
// the entry through resolveFeeConfig instead of reading the raw field, on
// every render, so a chain switch always reseeds.
assert.match(
    sendSrc,
    /resolveFeeConfig\(settings\?\.fees\?\.\[chainId\], chainRegistry\.get\(chainId\)\)\.rbfByDefault/,
    'resolves settings.fees[chainId] against the chain descriptor',
);
assert.doesNotMatch(sendSrc, /settings\.fees\[chainId\]\) return;/, 'a chain with no stored fee entry still seeds');
assert.match(
    sendSrc,
    /advanced=\{\{ rbfDefault: rbfByDefault/,
    'hands the resolved default to the shared Advanced section',
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
    /const rbfForSend = rbfSupported && \(advancedEntry\.rbf \?\? rbfByDefault\);/,
    'clamps the per-send flag (the user choice, else the default) to the chain capability',
);
assert.match(sendSrc, /rbf:\s*rbfForSend,/, 'clamped rbf flag flows into the send payload');

// --- toggle UI (shared Advanced section) ----------------------------

assert.match(advancedSrc, /<Switch\b/, 'toggle uses the kit Switch');
assert.match(
    advancedSrc,
    /const rbfChecked = rbfSupported && \(entry\.rbf \?\? effectiveRbfDefault\);/,
    'the switch shows the clamped choice',
);
assert.match(advancedSrc, /checked=\{rbfChecked\}/);
assert.match(advancedSrc, /disabled=\{disabled \|\| !rbfSupported\}/, 'toggle disabled where the chain has no RBF');
assert.match(advancedSrc, /aria-label=\{t\('send\.rbf\.label'\)\}/, 'the switch is named by the visible label key');
assert.match(advancedSrc, /t\('send\.rbf\.enabledHint'\)/, 'hint copy explains why');

console.log('send-rbf-toggle smoke OK');
