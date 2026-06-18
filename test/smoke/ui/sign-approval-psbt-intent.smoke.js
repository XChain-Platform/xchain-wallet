// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21.2 / §48: signPsbt approval intent cross-check.
//
// The dApp-bridge signPsbt approval used to show only a truncated raw hex
// string (unverifiable), so a compromised dApp could swap in a drain PSBT
// undetected. The approval now decodes the PSBT (via the psbt.parse host
// route) into destinations + amounts + fee, marking which outputs return
// to the user's own addresses. Source-level checks that this wiring is in
// place and the opaque-hex summary is gone.

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

// --- 1. Approval messaging exposes parsePsbt -> psbt.parse ---------------

assert.match(msgSrc, /export function parsePsbt\(/, 'approval/messaging.js exports parsePsbt');
assert.match(msgSrc, /sendMessage\('psbt\.parse'/, 'parsePsbt routes to the psbt.parse host handler');

// --- 2. SignApproval imports + decodes the PSBT --------------------------

assert.match(signSrc, /\n\s*parsePsbt,\n/, 'imports parsePsbt from messaging');
assert.match(
    signSrc,
    /if \(kind !== 'signPsbt'\) return undefined;/,
    'PSBT-decode effect short-circuits for non-signPsbt kinds',
);
assert.match(signSrc, /parsePsbt\(\{ chainId, psbtHex: psbtHexForSign \}\)/, 'decodes via parsePsbt');
assert.match(
    signSrc,
    /getAddressesByChain\(walletId\)/,
    'fetches own addresses to distinguish change from external recipients',
);

// --- 3. The opaque truncated-hex summary is gone -------------------------

assert.doesNotMatch(
    signSrc,
    /truncate\(inner\.psbtHex/,
    'the signPsbt SignSummary branch no longer dumps a truncated psbtHex string',
);
assert.doesNotMatch(signSrc, /function truncate\(/, 'the now-unused truncate helper is removed');

// --- 4. Decoded intent renders, gated on signPsbt ------------------------

assert.match(signSrc, /<PsbtIntentSummary/, 'renders the PsbtIntentSummary component');
const psbtGateIdx = signSrc.indexOf("kind === 'signPsbt' ? (");
assert.ok(psbtGateIdx > 0, 'PsbtIntentSummary is gated behind a signPsbt ternary');
assert.match(signSrc, /function PsbtIntentSummary\(/, 'defines PsbtIntentSummary');

// Surfaces the security-relevant totals.
assert.match(signSrc, /Leaving wallet/, 'shows how much leaves the wallet');
assert.match(signSrc, /Network fee/, 'shows the fee');
assert.match(signSrc, /Change \(back to you\)/, 'labels change returning to own addresses');

// --- 5. Fails loud when decode is impossible -----------------------------

// A parse failure must warn (role="alert"), never silently fall back to hex.
const intentFnIdx = signSrc.indexOf('function PsbtIntentSummary(');
const intentFnSrc = signSrc.slice(intentFnIdx, intentFnIdx + 1600);
assert.match(intentFnSrc, /role="alert"/, 'undecodable PSBT renders an alert');
assert.match(intentFnSrc, /could not be decoded/, 'alert explains the transaction could not be decoded');

console.log('sign-approval-psbt-intent smoke OK');
