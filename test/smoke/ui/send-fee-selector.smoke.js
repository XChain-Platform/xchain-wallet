// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §44 Fee UX, Step 1: Send.jsx wires the FeeSelector
// + per-tier feeEstimate flowing to the simulator + Max button.

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

// --- imports -----------------------------------------------------------

assert.match(sendSrc, /FeeSelector,/, 'FeeSelector imported from ui');
assert.match(
    sendSrc,
    /import \{[\s\S]*estimateNativeSendFee[\s\S]*estimateNativeSendFeeTiers[\s\S]*customFeeEstimate[\s\S]*\}/,
    'imports tier helpers',
);

// --- fee state ---------------------------------------------------------

assert.match(sendSrc, /feePick/, 'feePick state slot');
assert.match(sendSrc, /setFeePick/, 'feePick setter');
assert.match(sendSrc, /mode: 'normal'/, 'default mode is normal');

// --- tier state + async fetch (Step 4) ---------------------------------

assert.match(sendSrc, /\[feeTiers, setFeeTiers\] = useState/, 'tier state slot');
assert.match(sendSrc, /estimateNativeSendFeeTiers\(/, 'sync seed for first paint');
assert.match(
    sendSrc,
    /fetchNativeSendFeeTiers\(\{[\s\S]*messaging,[\s\S]*chainId,/,
    'async fetcher upgrades to SDK source when available',
);

assert.match(sendSrc, /feeEstimate = useMemo/, 'selected estimate memo');
assert.match(
    sendSrc,
    /feePick\.mode === 'custom'/,
    'custom branch dispatches to customFeeEstimate',
);
assert.match(
    sendSrc,
    /customFeeEstimate\(\{[\s\S]*rate:\s*Number\(feePick\.customRate\)/,
    'custom rate piped to customFeeEstimate',
);
assert.match(
    sendSrc,
    /estimateNativeSendFee\(\{[\s\S]*speed:\s*feePick\.mode/,
    'tier branch falls back to sync placeholder while async tiers load',
);
assert.match(
    sendSrc,
    /const liveTier = feeTiers \? feeTiers\[feePick\.mode\] : null/,
    'tier branch prefers SDK-sourced live tier when available',
);

// --- selector renders in the form -------------------------------------

const formIdx = sendSrc.indexOf('<FeeSelector');
assert.notEqual(formIdx, -1, 'FeeSelector renders in the form');
const formBlock = sendSrc.slice(formIdx, formIdx + 400);
assert.match(formBlock, /tiers=\{feeTiers\}/);
assert.match(formBlock, /value=\{feePick\}/);
assert.match(formBlock, /onChange=\{setFeePick\}/);

console.log('send-fee-selector smoke OK');
