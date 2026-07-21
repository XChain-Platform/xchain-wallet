// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for  §5.6 slice 1: the single-encode ConfirmActionModal wired
// into Send.jsx through the HOST boundary. All SDK access is host-side, so
// compose + tamper + preflight run in the background and reach the React
// tree over `messaging`. This asserts the whole boundary is connected end to
// end: the two host routes, the three shells' messaging methods, and Send's
// flag-gated modal path signing the prebuilt PSBT.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- host routes (createBackgroundHost) -----------------------------

const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(hostSrc, /host\.register\('action\.composeForConfirm'/, 'compose route registered');
assert.match(hostSrc, /host\.register\('action\.preflight'/, 'preflight route registered');
assert.match(hostSrc, /composeActionForConfirm\(/, 'compose route calls the host flow');
assert.match(hostSrc, /sdk\.preflight\(/, 'preflight route calls sdk.preflight host-side');
// The compose route resolves own-chain addresses so change is not a tamper.
assert.match(hostSrc, /addressesByChain\(/, 'compose route resolves ownAddresses from the vault');
// §4.7 two-window race: a host-shared reservation ledger + reserve/release
// routes, and preflight nets the reservations into localDeltas.
assert.match(hostSrc, /const reservationLedger = createReservationLedger\(\)/, 'host-shared reservation ledger');
assert.match(hostSrc, /host\.register\('action\.reserve'/, 'reserve route registered');
assert.match(hostSrc, /host\.register\('action\.releaseReservation'/, 'release route registered');
assert.match(hostSrc, /reservationLedger\.localDeltas\(chainId/, 'preflight nets reservations into localDeltas');

// --- host flow (composeActionForConfirm) ----------------------------

const flowSrc = read('packages', 'core', 'src', 'flows', 'composeActionForConfirm.js');
assert.match(flowSrc, /assertNoTamper\(/, 'flow runs the tamper check host-side');
assert.match(flowSrc, /decomposePsbt:\s*\(hex\)\s*=>\s*sdk\.wallet\.decomposePsbt/, 'tamper uses host decomposePsbt');
assert.match(flowSrc, /decodeActionFromPsbt:\s*\(hex\)\s*=>\s*sdk\.decoder\.decodeActionFromPsbt/, 'tamper uses host decodeActionFromPsbt');
assert.match(flowSrc, /tamperVerified:\s*true/, 'returns a tamper-verified envelope');

// --- messaging methods, all three shells ----------------------------

for (const [shell, ...p] of [
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    const src = read(...p);
    assert.match(src, /export function composeForConfirm\(/, `${shell}: composeForConfirm method`);
    assert.match(src, /sendMessage\('action\.composeForConfirm'/, `${shell}: composeForConfirm routes to the host`);
    assert.match(src, /export function preflight\(/, `${shell}: preflight method`);
    assert.match(src, /sendMessage\('action\.preflight'/, `${shell}: preflight routes to the host`);
    assert.match(src, /export function reserve\(/, `${shell}: reserve method`);
    assert.match(src, /export function releaseReservation\(/, `${shell}: releaseReservation method`);
}

// --- prebuilt-PSBT threading (core) ---------------------------------

const sendTokenSrc = read('packages', 'core', 'src', 'flows', 'sendToken.js');
assert.match(sendTokenSrc, /prebuiltPsbt:\s*opts\.prebuiltPsbt/, 'sendToken forwards prebuiltPsbt');
const submitActionSrc = read('packages', 'core', 'src', 'flows', 'submitAction.js');
assert.match(submitActionSrc, /prebuiltPsbt,/, 'submitAction forwards prebuiltPsbt to submitWithSigner');

// --- Send.jsx flag-gated modal path ---------------------------------

const sendSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
assert.match(sendSrc, /import \{ ConfirmActionModal \}/, 'imports the modal');
assert.match(sendSrc, /useConfirmAction\(\)/, 'uses the confirm hook');
assert.match(sendSrc, /isConfirmModalSliceEnabled\(settings, 'send'\)/, 'reads the send slice flag with code default');
assert.match(sendSrc, /messaging\.composeForConfirm\(/, 'compose() calls the host compose route');
assert.match(sendSrc, /messaging\.preflight\(/, 'preflight streams from the host route');
assert.match(sendSrc, /prebuiltPsbt:\s*\{/, 'Approve signs the prebuilt PSBT via sendToken');
// Hardware + watcher stay on the legacy path for this slice.
assert.match(sendSrc, /singleEncodeSend && !isWatcherMode && !isHwSource/, 'modal path scoped to software sends');
// The onApprove password is read from a live ref, not a stale closure.
assert.match(sendSrc, /password:\s*passwordValueRef\.current/, 'onApprove reads the live password ref');
// §4.7 reservation wired through messaging (host-shared ledger).
assert.match(sendSrc, /reserve:\s*\(e\)\s*=>\s*messaging\.reserve\(e\)/, 'Send reserves via messaging at Approve');
assert.match(sendSrc, /reserve:\s*\{\s*tick:/, 'Send passes the reserve amount');

console.log('confirm-modal-send-slice1.smoke.js OK');
