// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-29 (unlock threshold, GATE_MIN_AMOUNT). Two properties:
//
// 1. THE MAP IS ALL-NULL. The engine leg (indexer/encoder/SDK) rides
//    the  coordinated flag-day train, which is NOT assembled: a
//    height landing in protocolActivations.js outside that train makes
//    the wallet emit a ninth FILE field the pre-train network silently
//    DROPS (the wire is trailing-tolerant; verified 2026-07-25 against
//    the real SDK validator + indexer setActionParams), publishing an
//    immutable file whose threshold is unenforced forever. This file
//    pins the pre-train state; when the train pins real heights, update
//    this assertion IN THE SAME CHANGE.
// 2. The wallet leg is fully wired behind the gate: publish flow
//    emission + form field, send-guard below-threshold plain-SEND lane,
//    readiness mirroring, and the TokenDetail display leg.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- 1. Activation map: present, frozen, all-null ----------------------
const activations = read('packages', 'core', 'src', 'flows', 'protocolActivations.js');
assert.match(activations, /export const GATE_MIN_AMOUNT_ACTIVATION_HEIGHTS = Object\.freeze\(/,
    'activation map exists and is frozen');
const mapBody = activations.split('Object.freeze({')[1].split('})')[0];
const entries = mapBody.split('\n').map((l) => l.trim()).filter((l) => /^'[a-z-]+':/.test(l));
assert.equal(entries.length, 9, 'all nine chain ids enumerated');
for (const line of entries) {
    assert.match(line, /: null,?$/,
        `PRE-TRAIN INVARIANT VIOLATED: ${line} pins a height outside the  train assembly`);
}
assert.match(activations, /export async function resolveGateMinAmountActive/, 'async resolver exported');

// ---- 2a. Publish flow: gated emission --------------------------------
const publish = read('packages', 'core', 'src', 'flows', 'gatedPublishAction.js');
assert.match(publish, /resolveGateMinAmountActive\(/, 'publish flow checks activation itself (not just the form)');
assert.match(publish, /not active on this chain yet/, 'early emission refused with a reason');
assert.match(publish, /\.\.\.\(gateMinAmount !== null \? \[gateMinAmount\] : \[\]\)/,
    'GATE_MIN_AMOUNT rides as an optional ninth FILE field');
assert.match(publish, /gateMinAmount,\s*\}\);/, 'threshold counted in the plaintext ceiling');

// ---- 2b. Size math ----------------------------------------------------
const limits = read('packages', 'core', 'src', 'flows', 'fileSizeLimits.js');
assert.match(limits, /gateMinAmount != null && String\(gateMinAmount\)\.length > 0/,
    'gatedBatchActionString mirrors the optional ninth field');

// ---- 2c. Send guard: below-threshold plain-SEND lane -------------------
const guard = read('packages', 'core', 'src', 'flows', 'gatedSendGuard.js');
assert.match(guard, /export function gatedGroupThreshold/, 'pack-minimum threshold helper exported');
assert.match(guard, /export async function splitGroupsByThreshold/, 'threshold split helper exported');
assert.match(guard, /splitGroupsByThreshold\(\{\s*\n?\s*sdkRegistry, chainId, sdk, to/,
    'prepareGatedSend routes groups through the threshold lane');
assert.ok(guard.split('splitGroupsByThreshold({').length >= 3,
    'gatedSendReadiness mirrors the same lane');
assert.match(guard, /if \(groups\.length === 0\) return null;/,
    'all-below-threshold composes a plain SEND');
assert.match(guard, /GATED_SEND_BELOW_THRESHOLD/, 'dropped packs surface as a warning, not silence');
assert.match(guard, /return allRequired;\s*\n\s*\}\s*\n\n\s*const requiredGroups/,
    'unreadable destination balance degrades to all-required (valid-send direction)');

// ---- 2d. Readiness plumbing: Send.jsx -> messaging -> host -------------
const send = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
assert.match(send, /gatedSendReadiness\(\{\s*\n\s*walletId,[\s\S]*?to: toAddress\.trim\(\) \|\| undefined/,
    'Send.jsx feeds destination into the readiness probe');
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /gatedSendReadiness\(\{[\s\S]*?to: req\.to,\s*\n\s*amount: req\.amount,/,
    'host handler forwards to/amount to the threshold lane');

// ---- 2e. Publisher form: field behind the gate -------------------------
const form = read('packages', 'core', 'src', 'shared', 'routes', 'GatedPublishForm.jsx');
assert.match(form, /gateMinAmountScheduledHeight\(chainId\)/, 'form reads the scheduled height (null = hidden)');
assert.match(form, /getIndexerWatermark\(\{ chainId \}\)/, 'scheduled chains check the live watermark');
assert.match(form, /\{thresholdActive \? \(/, 'threshold input renders only when ACTIVE');
assert.match(form, /first-access lock, not\s*\n?\s*copy protection/, 'honest security-model copy present');
assert.match(form, /thresholdActive && gateMinAmount\.trim\(\)\s*\n?\s*\? \{ gateMinAmount: gateMinAmount\.trim\(\) \}/,
    'threshold submitted only when active and set');

// ---- 2f. Display leg: listGatedFiles + TokenDetail ---------------------
const content = read('packages', 'core', 'src', 'flows', 'gatedContent.js');
assert.match(content, /row\.gate_min_amount \?\? row\.gateMinAmount/, 'listGatedFiles carries the threshold through');
const detail = read('packages', 'core', 'src', 'shared', 'routes', 'TokenDetail.jsx');
assert.match(detail, /hold ≥ \{f\.gateMinAmount\} \{tick\} to unlock/, 'gated rows show the hold-N-to-unlock hint');
assert.match(detail, /file\.gateMinAmount \? `at least \$\{file\.gateMinAmount\}` : 'at least 1'/,
    'locked-access copy names the real threshold');

console.log('gated-threshold smoke: OK');
