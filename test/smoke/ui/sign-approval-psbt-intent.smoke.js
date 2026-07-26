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

//  slice 5: the window's local PsbtIntentSummary is DELETED. The
// approval surface now renders core's <PsbtIntentPanel>, the same component
// the in-wallet PSBT variant uses, so these properties are asserted where
// they now live. Two copies of "what does this transaction do to my money"
// was the drift §5.5 exported the panel separately to prevent.
assert.match(signSrc, /<PsbtIntentPanel/, 'renders the shared PsbtIntentPanel');
const psbtGateIdx = signSrc.indexOf("kind === 'signPsbt' ? (");
assert.ok(psbtGateIdx > 0, 'the panel is gated behind a signPsbt ternary');
assert.doesNotMatch(signSrc, /PsbtIntentSummary/, 'the legacy local summary is gone');

const panelSrc = readFileSync(join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'PsbtIntentPanel.jsx'), 'utf8');

// Surfaces the security-relevant totals.
assert.match(panelSrc, /Leaving this wallet/, 'shows how much leaves the wallet');
assert.match(panelSrc, /Network fee/, 'shows the fee');
assert.match(panelSrc, /Change \(back to you\)/, 'labels change returning to own addresses');

// --- 5. Fails loud when decode is impossible -----------------------------

// A parse failure must warn (role="alert"), never silently fall back to hex.
assert.match(panelSrc, /role="alert"/, 'undecodable PSBT renders an alert');
assert.match(panelSrc, /could not be decoded/, 'alert explains the transaction could not be decoded');

// --- 6. Approval is held until the decode settles (F1) -------------------
// Approving before the intent renders would be approving un-verified
// effects, and a failed decode must hard-block. Both gates funnel through
// approvalBlocked, which is used in the Approve handler AND the button.
assert.match(signSrc, /psbtDecodePending\s*=\s*\n?\s*kind === 'signPsbt' &&[\s\S]*psbtIntent\.loading/,
    'holds approval while the PSBT decode is still in flight');
assert.match(signSrc, /psbtApprovalBlocked = psbtDecodeFailed \|\| psbtDecodePending/,
    'combines the failed and pending gates');
assert.match(signSrc, /if \(busy \|\| password\.length === 0 \|\| !walletId \|\| approvalBlocked\) return/,
    'the Approve handler refuses while blocked');
assert.match(signSrc, /disabled=\{password\.length === 0 \|\| !walletId \|\| approvalBlocked\}/,
    'the Approve button is disabled while blocked');

// --- 7. Co-sign approvals get the same gate (WYSIWYS parity) -------------
// A coSign request the wallet already knows is undecodable or out-of-policy
// (the summary even says the co-signer will refuse it) must not leave
// Approve clickable; the pending-preview state also holds approval.
assert.match(signSrc, /coSignApprovalBlocked\s*=\s*\n?\s*kind === 'coSign' &&/,
    'derives a coSign approval gate');
assert.match(signSrc, /coSignApprovalBlocked[\s\S]*coSignPreview\.loading/,
    'coSign gate holds while the preview is loading');
assert.match(signSrc, /coSignApprovalBlocked[\s\S]*decodeOk/,
    'coSign gate blocks on a failed decode');
assert.match(signSrc, /coSignApprovalBlocked[\s\S]*policyOk/,
    'coSign gate blocks on an out-of-policy request');
assert.match(signSrc, /approvalBlocked = psbtApprovalBlocked \|\| coSignApprovalBlocked/,
    'both kind gates funnel into the shared approvalBlocked flag');

console.log('sign-approval-psbt-intent smoke OK');
