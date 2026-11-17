// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §21, Step 6: RawPsbtViewer reveal (Developer Mode).
//
// Closes Settings FOLLOWUP 6 from the §35 close report. Asserts:
//   - <RawPsbtViewer> exists with the expected public API
//   - Returns null when developerMode=false (the only way the gate
//     short-circuits; caller never gets a stray reveal block)
//   - G127 removes the collapsed raw disclosure from review screens and routes
//     caller PSBTs through PsbtIntentPanel, which shows every input and output
//   - both extension approval and the in-wallet Sign Transaction flow use that
//     fail-closed replacement, with Developer Mode as the explicit escape hatch
//   - approval-side messaging exposes getSettings

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const compPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'RawPsbtViewer.jsx');
const cssPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'RawPsbtViewer.module.css');
const signPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'kinds', 'SignApproval.jsx');
const sendPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
const psbtFormPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'PsbtSignForm.jsx');
const psbtConfirmPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'PsbtConfirmScreen.jsx');
const intentPath = join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'PsbtIntentPanel.jsx');
const approvalMsgPath = join(wsRoot, 'packages', 'extension', 'src', 'approval', 'messaging.js');

assert.ok(existsSync(compPath), 'RawPsbtViewer.jsx exists');
assert.ok(existsSync(cssPath), 'RawPsbtViewer.module.css exists');

const compSrc = readFileSync(compPath, 'utf8');
const cssSrc = readFileSync(cssPath, 'utf8');
const signSrc = readFileSync(signPath, 'utf8');
const sendSrc = readFileSync(sendPath, 'utf8');
const psbtFormSrc = readFileSync(psbtFormPath, 'utf8');
const psbtConfirmSrc = readFileSync(psbtConfirmPath, 'utf8');
const intentSrc = readFileSync(intentPath, 'utf8');
const msgSrc = readFileSync(approvalMsgPath, 'utf8');

// --- 1. Public API + gate semantics -------------------------------------

assert.match(compSrc, /export function RawPsbtViewer\(/);
assert.match(compSrc, /props\.developerMode/);
assert.match(compSrc, /props\.psbtHex/);
assert.match(compSrc, /props\.actionFields/);

// Hard gate: developerMode=false → null. Plus secondary gate: nothing
// to show → null (avoids an empty disclosure if both psbtHex and
// actionFields are absent).
assert.match(
    compSrc,
    /if \(!developerMode\) return null;/,
    'developerMode=false short-circuits to null',
);
assert.match(
    compSrc,
    /if \(!hasPsbt && !hasFields\) return null;/,
    'no payload → null (no orphan disclosure)',
);

// --- 2. Sections + copy button ------------------------------------------

assert.match(compSrc, /aria-label="Unsigned transaction code"|aria-label=\{t\('components\.watcherResultPanel\.unsignedTransactionHex2'\)\}/);
assert.match(compSrc, /aria-label="Action fields"|aria-label=\{t\('components\.rawPsbtViewer\.actionFields'\)\}/);
assert.match(compSrc, /aria-label="Parsed inputs \/ outputs"|aria-label=\{t\('components\.rawPsbtViewer\.parsedInputsOutputs'\)\}/);
assert.match(compSrc, /parser not wired yet|t\('components\.rawPsbtViewer\.parserNotWiredYetSee'\)/, 'placeholder is honest about the parser limit');
assert.match(compSrc, /copyText\(value\)/, 'copy uses the shared clipboard path');
assert.match(compSrc, /Copy failed: clipboard unavailable/, 'copy failure is visible in plain words');
assert.match(
    compSrc,
    /copyLabel\('psbt', 'Unsigned Transaction Code'\)/,
    'PSBT copy button labels what it copies',
);
assert.match(
    compSrc,
    /copyLabel\('fields', 'Action Fields'\)/,
    'action-fields copy button labels what it copies',
);

// CSS hooks for every visible piece.
for (const cls of ['root', 'toggle', 'body', 'section', 'label', 'hex', 'json', 'placeholder', 'copyBtn']) {
    assert.match(cssSrc, new RegExp(`\\.${cls}\\b`), `CSS defines .${cls}`);
}

// --- 3. SignApproval replacement ---------------------------------------

assert.doesNotMatch(signSrc, /RawPsbtViewer/, 'G127 approval has no collapsed technical-details viewer');
assert.match(signSrc, /import \{ PsbtIntentPanel \}/, 'imports the PSBT safety panel');
assert.match(signSrc, /getSettings/, 'imports getSettings from approval messaging');

// Settings fetch on mount.
assert.match(signSrc, /const \[developerMode, setDeveloperMode\] = useState\(false\);/);
// Non-greedy across braces on purpose: the same .then body also hydrates the
// custom-chain registry inside a try/catch, so a brace-free gap would pin the
// absence of that block rather than this wiring.
assert.match(
    signSrc,
    /getSettings\(\)\s*\.then\(\(s\) => \{[\s\S]*?setDeveloperMode\(Boolean\(s\?\.developerMode\)\);/s,
    'fetches settings on mount and sets developerMode',
);
assert.match(
    signSrc,
    /\.catch\(\(\) => \{ \/\* keep developerMode false on failure \*\//,
    'fetch failure leaves developerMode false (gate stays closed)',
);

// A caller PSBT exposes the decoded input/output set, and an unreadable action
// that spends this wallet's inputs stays fail-closed outside Developer Mode.
assert.match(
    signSrc,
    /<PsbtIntentPanel[\s\S]*?decomposed=\{psbtIntent\.error \? null : psbtIntent\.decomposed\}/,
    'signPsbt renders the decomposed transaction through PsbtIntentPanel',
);
assert.match(
    signSrc,
    /psbtRefusalReason\(\{[\s\S]*?developerMode[\s\S]*?\}\)/,
    'developer mode gates the fail-closed unreadable-action escape hatch',
);
assert.match(intentSrc, /inputs\.map\(/, 'PSBT safety panel enumerates every input');
assert.match(intentSrc, /outputs\.map\(/, 'PSBT safety panel enumerates every output');

// --- 4. approval/messaging.js ------------------------------------------

assert.match(msgSrc, /export function getSettings\(/);
assert.match(msgSrc, /sendMessage\('settings\.get'\)/);

// --- 5. In-wallet PSBT signing and G127 exclusion -----------------------

assert.doesNotMatch(sendSrc, /RawPsbtViewer/, 'Send review has no G127-forbidden technical disclosure');
assert.match(
    psbtFormSrc,
    /<PsbtConfirmScreen[\s\S]*?decomposed=\{decomposed\}[\s\S]*?developerMode=\{developerMode\}/,
    'Sign Transaction routes the decoded PSBT and Developer Mode gate to PsbtConfirmScreen',
);
assert.match(
    psbtConfirmSrc,
    /variant="psbt"[\s\S]*?psbtPanel=\{\([\s\S]*?<PsbtIntentPanel/,
    'PsbtConfirmScreen puts the input/output panel on the shared confirm page',
);
assert.match(
    psbtConfirmSrc,
    /refusal=\{refusal\}/,
    'PsbtConfirmScreen passes an unreadable-action refusal into the confirm gate',
);

console.log('raw-psbt-viewer smoke OK');
