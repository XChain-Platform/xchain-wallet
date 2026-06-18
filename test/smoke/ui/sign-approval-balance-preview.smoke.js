// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21, Step 4: SignApproval (signAction) wires <BalanceChanges>.
//
// Source-level checks that the approval window now:
//   - imports BalanceChanges + the new approval-side messaging helpers
//   - fetches address balances against the dApp-requested chain only
//     for the signAction kind (signMessage / signPsbt / signIn skip
//     the preview (they don't move value)
//   - resolves the source address from payload.payload.from.address
//     when the dApp passes it; otherwise falls back to the wallet's
//     first address on the requested chain
//   - degrades gracefully on fetch error
//   - renders the section only for signAction (no orphan section on
//     signMessage / signPsbt / signIn)

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const signPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
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

// --- 2. SignApproval imports + state --------------------------------------

assert.match(signSrc, /import \{ BalanceChanges \}/, 'imports BalanceChanges');
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

// useMemo passes the dApp action + params through the simulator.
assert.match(signSrc, /decoderLib\.simulateAction\(/);
assert.match(signSrc, /action: payload\?\.action,/);
assert.match(signSrc, /params: payload\?\.payload \|\| \{\}/);
assert.match(signSrc, /balances: decoderLib\.balancesFromSdk\(previewBalances\.sdkShape\)/);
assert.match(signSrc, /feeEstimate:\s*'0'/);

// --- 4. Render gates on signAction ---------------------------------------

const summaryIdx = signSrc.indexOf('<SignSummary');
const balanceJsxIdx = signSrc.indexOf("kind === 'signAction'", summaryIdx);
const formIdx = signSrc.indexOf('id="sign-approval-form"');
assert.ok(
    summaryIdx > 0 && balanceJsxIdx > 0 && formIdx > 0,
    'all three blocks present',
);
assert.ok(
    summaryIdx < balanceJsxIdx && balanceJsxIdx < formIdx,
    'BalanceChanges sits between SignSummary and the password form',
);

// signMessage / signPsbt / signIn do NOT render the preview (gated).
const balanceBlockIdx = signSrc.indexOf('<BalanceChanges', balanceJsxIdx);
const blockExtract = signSrc.slice(balanceJsxIdx, balanceBlockIdx + 200);
assert.match(blockExtract, /signAction/, 'render gate references signAction');
assert.match(blockExtract, /\? \(/, 'gate uses ternary, not unconditional');

// --- 5. Loading + error props plumbed through ----------------------------

assert.match(signSrc, /loading=\{previewBalances\.loading\}/);
assert.match(signSrc, /error=\{previewBalances\.error\}/);

console.log('sign-approval-balance-preview smoke OK');
