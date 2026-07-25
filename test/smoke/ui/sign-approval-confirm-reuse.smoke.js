// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §5.6 slice 4: the dApp-approval window reuses the confirm
// surface's panels.
//
// The point of the slice is that a dApp request and a hand-signed one verify
// themselves through the SAME components, so a rule fixed on one surface is
// fixed on both. What this pins:
//
//   1. the shared panels are imported from core (not re-forked locally);
//   2. the whole <ConfirmActionModal> is deliberately NOT nested here - this
//      window already owns its Screen + origin block + Approve/Reject footer;
//   3. pre-flight for a dApp action runs HOST-side via an approval-scoped
//      route, and is never a bridge method a dApp could call itself;
//   4. the Approve gate is the shared predicate, not a second copy;
//   5. every new gate is ADDITIVE - the pre-existing decode/policy blocks
//      still hold, so the slice can never loosen an existing refusal.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const signPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
const approvalMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'messaging.js');
const bridgeSpecDir = join(wsRoot, 'packages', 'bridge-spec');

const signSrc = readFileSync(signPath, 'utf8');
const msgSrc = readFileSync(approvalMsgPath, 'utf8');

// Negative assertions run against CODE only. The file documents in prose why
// the modal shell is not reused here, and a naive string search would trip
// over that explanation - which is worth keeping.
const signCode = signSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// --- 1. Shared panels imported from core --------------------------------

for (const [component, path] of [
    ['PsbtIntentPanel', 'shared/components/PsbtIntentPanel.jsx'],
    ['PreflightPanel', 'shared/components/PreflightPanel.jsx'],
    ['ActionIntentSummary', 'shared/components/ActionIntentSummary.jsx'],
]) {
    assert.ok(
        signSrc.includes(`import { ${component} } from '@xchain-wallet/core/${path}'`),
        `SignApproval imports ${component} from core`,
    );
}
assert.match(
    signSrc,
    /import \{ psbtRefusalReason \} from '@xchain-wallet\/core\/shared\/components\/PsbtConfirmScreen\.jsx'/,
    'reuses the §5.5 refusal predicate rather than re-deriving the rule',
);

// --- 2. The modal shell is NOT nested -----------------------------------

assert.doesNotMatch(
    signCode,
    /import \{[^}]*ConfirmActionModal[^}]*\} from/,
    'does NOT import <ConfirmActionModal>: this window is already the confirm surface '
    + '(its own Screen + footer), which is why §5.5 exports the panels separately',
);
assert.doesNotMatch(
    signCode,
    /<ConfirmActionModal[\s/>]/,
    'does NOT render <ConfirmActionModal> (would nest two Screens and two footers)',
);
assert.match(
    signSrc,
    /<Screen\s+variant="popup"/,
    'keeps its own popup Screen + approval chrome',
);

// --- 3. Pre-flight is approval-scoped, never a bridge method ------------

assert.match(msgSrc, /export function preflight\(/, 'approval/messaging.js exposes preflight');
assert.match(
    msgSrc,
    /sendMessage\('action\.preflight'/,
    'preflight routes to the host action.preflight handler (SDK stays host-side)',
);
assert.match(signSrc, /\n\s*preflight,\n/, 'SignApproval imports preflight from messaging');
assert.match(
    signSrc,
    /kind !== 'signAction'/,
    'pre-flight is scoped to the signAction kind',
);

// §4.8: a dApp that could call preflight itself could binary-search balances.
// It must not appear anywhere in the bridge's public surface.
function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(js|jsx|json|ts|d\.ts)$/.test(name)) out.push(full);
    }
    return out;
}
for (const file of walk(bridgeSpecDir)) {
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(
        src,
        /\bpreflight\b/,
        `bridge-spec must not expose preflight to dApps (${file})`,
    );
}

// --- 4. One Approve-gate predicate across surfaces ----------------------

assert.match(
    signSrc,
    /import \{ canApproveWithReport \} from '@xchain-wallet\/core\/shared\/hooks\/useConfirmAction\.js'/,
    'uses the shared §4.2 Approve-gate predicate',
);
assert.match(
    signSrc,
    /preflightBlocked[\s\S]{0,200}!canApproveWithReport\(preflightState\.report, acknowledged\)/,
    'a blocking pre-flight finding disables Approve',
);
assert.match(
    signSrc,
    /const acknowledge = \(code\)/,
    'an overridable finding can be acknowledged in-window (§4.2 override UX)',
);

// --- 5. New gates are ADDITIVE ------------------------------------------

assert.match(
    signSrc,
    /const approvalBlocked = psbtApprovalBlocked \|\| coSignApprovalBlocked\s*\n?\s*\|\| !!psbtRefusal \|\| preflightBlocked/,
    'the slice-4 gates are OR-ed ON TOP of the existing decode + policy gates, '
    + 'never replacing them',
);
assert.match(
    signSrc,
    /psbtApprovalBlocked = psbtDecodeFailed \|\| psbtDecodePending/,
    'the pre-existing signPsbt decode gate is untouched',
);

// The refusal must key on the decode REASON, not merely on "no action": an
// ordinary payment (NO_OP_RETURN) carries no action and must still sign.
assert.match(
    signSrc,
    /decodeReason: psbtIntent\.actionDecodeReason/,
    'refusal keys on the decode reason so ordinary payments are not false-blocked',
);

// --- 6. Flag-gated, with the legacy path retained for one release -------

assert.match(
    signSrc,
    /isConfirmModalSliceEnabled\(s, 'extensionApproval'\)/,
    'reads the extensionApproval slice flag from settings',
);
assert.match(
    signSrc,
    /confirmSlice \?[\s\S]{0,400}<PsbtIntentPanel/,
    'the shared panel renders when the slice is on',
);
assert.match(
    signSrc,
    /<PsbtIntentSummary/,
    'the legacy summary is retained as the flag-off path (§5.6: a flag holds one release)',
);

console.log(
    'OK: sign-approval confirm-reuse smoke ( §5.6 slice 4: PsbtIntentPanel + '
    + 'PreflightPanel + ActionIntentSummary reused from core; modal shell deliberately '
    + 'not nested; preflight host-side and absent from bridge-spec; shared '
    + 'canApproveWithReport gate; new gates additive; reason-keyed refusal; flag-gated '
    + 'with the legacy summary retained)',
);
