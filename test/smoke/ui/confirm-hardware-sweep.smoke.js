// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for: hardware signers reach the confirm surface.
//
// Every form migrated onto the single-encode pipeline originally gated its
// confirm path on `!isHwSource` (or `!hw`), so a hardware source fell back to
// the LEGACY review stage - where submitWithSigner REBUILDS the PSBT on
// Approve. That path has no output-set tamper check, no action-byte
// cross-check, no exact fee, no pre-flight panel and no §4.7 reservation,
// while the confirm page's own hardware note tells the user that screen is
// where action intent gets verified (the device can only show native outputs
// and destinations). The users with the most to verify had the least.
//
// action-forms-confirm.test.jsx drives three of these forms end to end with a
// device as the payer. This file is the SWEEP: it holds the property across
// every migrated form, including the ones whose source cannot be named at
// mount, so a new form (or a re-added gate) cannot quietly opt hardware out.
//
// Watcher mode is NOT swept: it encodes and never signs, so it legitimately
// branches away from a signing surface.

import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const shared = join(wsRoot, 'packages', 'core', 'src', 'shared');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the shared dispatcher exists and never leaks a password ------
//
// 20 hand-written copies of the HW/software branch is the drift this hook
// exists to prevent: one that forgets `signerId`, or passes a password on the
// device lane, is a bug no reviewer catches by eye.

const hookSrc = read('packages', 'core', 'src', 'shared', 'hooks', 'useActionConfirmFlow.js');
assert.match(hookSrc, /export function useConfirmSubmit\(/,
    'useConfirmSubmit is exported from the confirm-flow hook module');
assert.match(hookSrc, /messaging\[hardware\]\(\{ \.\.\.base, signerId \}\)/,
    'the HW lane carries signerId');
assert.match(hookSrc, /messaging\[software\]\(\{ \.\.\.base, password: passwordRef\.current \}\)/,
    'the password rides the SOFTWARE lane only');
{
    // The password must not appear anywhere in the hardware branch: a device
    // has no password to check, and sending one is a credential leak across a
    // boundary that never needed it.
    const hwBranch = hookSrc.slice(
        hookSrc.indexOf('messaging[hardware]'),
        hookSrc.indexOf('messaging[software]'),
    );
    assert.ok(!/password/.test(hwBranch), 'no password on the hardware lane');
}

// --- 2. the confirm screen swaps the password field for the device ---

const screenSrc = read('packages', 'core', 'src', 'shared', 'components', 'ActionConfirmScreen.jsx');
assert.match(screenSrc, /hwSource \?/, 'the shared confirm screen branches on a HW source');
assert.match(screenSrc, /hwStatus === 'available'/,
    'Approve readiness on a HW source is the DEVICE being available, not a typed password');
// §18.5: the cross-check that Send enforces has to survive the move onto the
// shared screen, or a hardware gate would be silently dropped.
assert.match(screenSrc, /hwRequireExplicitConfirm/,
    'the §18.5 cross-check reaches HwSignBlock through the shared screen');
assert.match(screenSrc, /!hwRequireExplicitConfirm \|\| hwExplicitConfirmed/,
    'an unticked cross-check keeps Approve disabled');

const credsSrc = read('packages', 'core', 'src', 'shared', 'components', 'SignCredentials.jsx');
assert.match(credsSrc, /requireExplicitConfirm=\{requireExplicitConfirm\}/,
    'SignCredentials forwards the cross-check to HwSignBlock');

// --- 3. the sweep: no migrated form gates its confirm path on HW -----

const routesDir = join(shared, 'routes');
const files = [
    ...readdirSync(routesDir).filter((f) => f.endsWith('.jsx')).map((f) => join(routesDir, f)),
    join(shared, 'components', 'PlaceOrderPanel.jsx'),
];

const offenders = [];
const covered = [];
for (const path of files) {
    const src = readFileSync(path, 'utf8');
    // Only forms that actually reached the single-encode pipeline are in
    // scope; an unmigrated form has no confirm path to gate.
    if (!/const singleEncode(Send)? = /.test(src)) continue;
    const name = path.split('/').pop();
    const gate = (src.match(/const singleEncode(?:Send)? = [^;]*;/s) || [''])[0];
    if (/&& !isHwSource|&& !hw\b/.test(gate)) offenders.push(`${name}: ${gate.trim()}`);
    else covered.push(name);
}

assert.equal(
    offenders.length,
    0,
    `these forms still send hardware down the legacy rebuild-on-Approve path:\n  ${offenders.join('\n  ')}`,
);
// A floor, so the sweep cannot pass by accident if the gate regex stops
// matching anything at all - and a ratchet, so a value-moving form cannot
// leave the lane again. It sat at 20 while 22 forms were on the lane, which
// is why the §5.6 tail (ORDER/DISPENSER ownership sales, cross-chain SWAP,
// BATCH, LINK, FILE, the fork legs, the attach-content legs) could stay off
// it without this sweep noticing. Raise it when forms join; a DROP is the
// regression it exists to catch.
assert.ok(covered.length >= 29,
    `expected the sweep to cover 29+ migrated forms, saw ${covered.length}`);

// --- 4. every swept form hands the confirm screen its device block ---
//
// Dropping the gate without wiring `hwSource` would open the confirm page for
// a HW user and then show them a password field they cannot fill: Approve
// would never enable. Worse than the legacy path, not better.

const missingDeviceBlock = [];
for (const path of files) {
    const src = readFileSync(path, 'utf8');
    if (!/const singleEncode(Send)? = /.test(src)) continue;
    // A form with no HW concept at all (no source picker, HD-only) is exempt.
    if (!/isHwSource|isHwSource\(|const hw = /.test(src)) continue;
    if (!/hwSource=\{/.test(src)) missingDeviceBlock.push(path.split('/').pop());
}
assert.equal(
    missingDeviceBlock.length,
    0,
    `these forms dropped the HW gate but never wired the device block:\n  ${missingDeviceBlock.join('\n  ')}`,
);

console.log(
    `OK: confirm hardware sweep smoke (useConfirmSubmit dispatches HW/software with no password on the device lane;`
    + `ActionConfirmScreen swaps the password field for HwSignBlock and keeps the §18.5 cross-check gating Approve; `
    + `${covered.length} migrated forms carry no !isHwSource confirm gate and all wire hwSource)`,
);
