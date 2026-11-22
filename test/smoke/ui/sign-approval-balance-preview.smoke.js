// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21, Step 4: SignApproval previews signAction balances.
//
// Source-level checks that the approval window now:
//   - fetches balances through the approval-side messaging helpers
//   - fetches address balances against the dApp-requested chain only
//     for the signAction kind
//   - resolves the source address from payload.payload.from.address
//     when the dApp passes it; otherwise falls back to the wallet's
//     first address on the requested chain
//   - puts projected post-action balances in the G127 facts card
//   - puts preview failures in the shared warning slot

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const signPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'approval', 'SignApproval.jsx');
const approvalMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'messaging.js');

const signSrc = readFileSync(signPath, 'utf8');
const msgSrc = readFileSync(approvalMsgPath, 'utf8');

// --- 1. Approval messaging exposes the helpers --------------------------

assert.match(
    msgSrc,
    /export function getAddressBalances\(/,
    'approval/messaging.js exports getAddressBalances',
);
assert.match(
    msgSrc,
    /export function getAddressesByChain\(/,
    'approval/messaging.js exports getAddressesByChain',
);
assert.match(
    msgSrc,
    /sendMessage\('balances\.address'/,
    'getAddressBalances routes to balances.address',
);
assert.match(
    msgSrc,
    /sendMessage\('addresses\.byChain'/,
    'getAddressesByChain routes to addresses.byChain',
);

// --- 2. SignApproval Confirm Standard + state -----------------------------

assert.match(signSrc, /ConfirmStandard,/, 'imports Confirm Standard');
assert.doesNotMatch(signSrc, /<BalanceChanges|import \{ BalanceChanges \}/, 'G127 retires the balance-change card');
assert.match(
    signSrc,
    /getAddressBalances,\s*\n\s*getAddressesByChain,/,
    'imports both messaging helpers',
);
assert.match(
    signSrc,
    /useEffect, useMemo, useRef, useState/,
    'imports useMemo (was previously useEffect/useRef/useState only)',
);

// --- 3. Effect + useMemo plumbing ----------------------------------------

// Effect runs only for signAction.
assert.match(
    signSrc,
    /if \(kind !== 'signAction' \|\| !chainId \|\| !walletId\) return undefined;/,
    'effect short-circuits for non-signAction kinds and missing inputs',
);

// Resolves dApp-supplied source address with a fallback to first chain address.
assert.match(
    signSrc,
    /payload\?\.payload\?\.from\?\.address \|\| payload\?\.from\?\.address/,
    'prefers dApp-supplied source address',
);
assert.match(
    signSrc,
    /getAddressesByChain\(walletId\)/,
    'falls back to addresses.byChain when dApp omits source',
);
assert.match(
    signSrc,
    /byChain\?\.\[chainId\]\?\.\[0\]\?\.address/,
    'fallback picks first address on the requested chain',
);

// The facts model passes the dApp action + params through the simulator.
assert.match(signSrc, /decoderLib\.simulateAction\(/);
assert.match(signSrc, /action: resolvedPayload\?\.action,/);
assert.match(signSrc, /params: resolvedPayload\?\.payload \|\| \{\}/);
assert.match(signSrc, /balances: decoderLib\.balancesFromSdk\(previewBalances\.sdkShape\)/);
assert.match(signSrc, /feeEstimate:\s*'0'/);
assert.match(
    signSrc,
    /projectedBalanceFacts[\s\S]{0,1200}?label: `Balance after \(\$\{String\(delta\.tick\)\.toUpperCase\(\)\}\)`/,
    'projected post-action balances become facts',
);

// --- 4. Facts and warning slot -------------------------------------------

assert.match(signSrc, /const generalConfirmationFacts = \[[\s\S]{0,180}?\.\.\.projectedBalanceFacts/);
assert.match(
    signSrc,
    /kind === 'signAction' && previewBalances\.error[\s\S]{0,120}?Balance preview unavailable\./,
    'preview failure is explicit but non-blocking',
);
assert.match(signSrc, /<ConfirmStandard\b[\s\S]{0,2400}?warning=\{confirmationWarning\}/);
assert.match(signSrc, /<ConfirmStandard[\s\S]{0,2400}?facts=\{confirmationFacts\}/);

console.log('sign-approval-balance-preview smoke OK');
