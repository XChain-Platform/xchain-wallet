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
// One ledger, shared across every approval window. §5.4 later gave it a
// chrome.storage.session store so an MV3 worker kill cannot drop the
// reservations (see confirm-reservation-sw-persistence.smoke.js); this
// assertion only cares that exactly one host-shared ledger exists.
assert.match(hostSrc, /const reservationLedger = createReservationLedger\(/, 'host-shared reservation ledger');
assert.match(hostSrc, /host\.register\('action\.reserve'/, 'reserve route registered');
assert.match(hostSrc, /host\.register\('action\.releaseReservation'/, 'release route registered');
assert.match(hostSrc, /reservationLedger\.localDeltas\(chainId/, 'preflight nets reservations into localDeltas');

// --- host flow (composeActionForConfirm) ----------------------------

const flowSrc = read('packages', 'core', 'src', 'flows', 'composeActionForConfirm.js');
assert.match(flowSrc, /assertNoTamper\(/, 'flow runs the tamper check host-side');
assert.match(flowSrc, /decomposePsbt:\s*\(hex\)\s*=>\s*sdk\.wallet\.decomposePsbt/, 'tamper uses host decomposePsbt');
assert.match(flowSrc, /decodeActionFromPsbt:\s*\(hex\)\s*=>\s*sdk\.decoder\.decodeActionStringFromPsbt/, 'tamper byte-match uses the policy-free raw extractor (decodeActionStringFromPsbt), not the co-signer decodeActionFromPsbt');
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
// §5.3.4: permanence must ride in the error NAME - the messaging envelope
// carries only { name, message }, so a custom field would be dropped.
assert.match(submitActionSrc, /err\.name\s*=\s*permanence === 'permanent'/, 'submitAction stamps permanence into the error name');
const hostEnvelopeSrc = read('packages', 'extension', 'src', 'background', 'MessageHost.js');
assert.match(hostEnvelopeSrc, /return \{ ok: false, error: \{ name, message \} \}/, 'boundary envelope is still name+message only (permanence must not rely on custom fields)');
const permanenceSrc = read('packages', 'core', 'src', 'flows', 'broadcastPermanence.js');
assert.match(permanenceSrc, /export function broadcastFailureKindFromError/, 'permanence is recoverable from a boundary-crossed error');

// --- Send.jsx flag-gated modal path ---------------------------------

const sendSrc = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
assert.match(sendSrc, /import \{ ActionConfirmScreen \}/, 'renders through the SHARED confirm screen, not a hand-rolled modal copy: that adapter is where the §5.2.5 exact fee and §5.2.3 deltas live');
assert.match(sendSrc, /useConfirmAction\(\)/, 'uses the confirm hook');
//  slice 5: the flag is gone; only the watcher carve-out branches.
assert.match(sendSrc, /if \(!isWatcherMode\) \{/, 'the confirm path is unconditional for anything that signs');
assert.doesNotMatch(sendSrc, /confirmModalSlices|isConfirmModalSliceEnabled/, 'no slice flag survives');
assert.match(sendSrc, /messaging\.composeForConfirm\(/, 'compose() calls the host compose route');
assert.match(sendSrc, /messaging\.preflight\(/, 'preflight streams from the host route');
assert.match(sendSrc, /const prebuiltPsbt = \{/, 'Approve signs the prebuilt PSBT via sendToken / sendAssetHw');
// : hardware confirms here too; watcher still branches (it encodes,
// it never signs). The §18.5 cross-check has to survive the move onto the
// shared screen, or a HW gate would be silently dropped.
assert.match(sendSrc, /if \(!isWatcherMode\)(?! && !isHwSource)/, 'confirm path covers hardware');
assert.match(sendSrc, /hwSource=\{isHwSource \? fromAddress : null\}/, 'HW source hands the confirm screen its device block');
assert.match(sendSrc, /hwRequireExplicitConfirm=\{signRisk\.requireExplicitConfirm\}/, '§18.5 cross-check reaches the confirm screen');
assert.match(sendSrc, /messaging\.sendAssetHw\(\{/, 'the HW lane signs the prebuilt PSBT through the same send flow');
// The onApprove password is read from a live ref, not a stale closure.
assert.match(sendSrc, /password:\s*passwordValueRef\.current/, 'onApprove reads the live password ref');
// §4.7 reservation wired through messaging (host-shared ledger).
assert.match(sendSrc, /reserve:\s*\(e\)\s*=>\s*messaging\.reserve\(e\)/, 'Send reserves via messaging at Approve');
assert.match(sendSrc, /reserve:\s*\{\s*tick:/, 'Send passes the reserve amount');
// §5.3.4 credential re-prompt: the hook returns to `ready` with an error and
// the modal renders it, so a bad password does not tear the modal down.
const confirmScreenSrc = read('packages', 'core', 'src', 'shared', 'components', 'ActionConfirmScreen.jsx');
assert.match(confirmScreenSrc, /error=\{confirmAction\.error\}/, 'the shared confirm screen passes the confirm error through, so a bad password re-prompts instead of tearing the page down');
const hookSrc = read('packages', 'core', 'src', 'shared', 'hooks', 'useConfirmAction.js');
assert.match(hookSrc, /isCredentialFailure\(err\)/, 'hook classifies credential failures');
assert.match(hookSrc, /reason:\s*'bad-credentials'/, 'credential failure re-prompts instead of settling');
assert.match(hookSrc, /!optsRef\.current\.reservationId/, 'reservation guarded against re-reserve on retry');
const modalSrc = read('packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.jsx');
assert.match(modalSrc, /data-testid="confirm-error"/, 'modal has an in-modal error surface');

// --- the confirm surface is STYLED (regression guard) ---------------
// It shipped unstyled once: the three components used global class-name
// strings with no stylesheet anywhere, so the "modal" rendered as bare
// markup. Each must import its co-located CSS module (the codebase
// convention, cf. NoticeModal) and define no global class strings.
for (const name of ['ConfirmActionModal', 'ActionIntentSummary', 'PreflightPanel']) {
    const jsx = read('packages', 'core', 'src', 'shared', 'components', `${name}.jsx`);
    assert.match(jsx, new RegExp(`import styles from '\\./${name}\\.module\\.css'`), `${name}: imports its CSS module`);
    assert.doesNotMatch(jsx, /className="(confirm-modal|preflight|action-intent|delta)-/, `${name}: no unstyled global class strings`);
    // The stylesheet must exist and be non-trivial.
    const css = read('packages', 'core', 'src', 'shared', 'components', `${name}.module.css`);
    assert.ok(css.length > 200, `${name}.module.css is present and non-empty`);
}

// §5.2.7 reachability is a SAFETY property, not cosmetics: the user must
// always be able to reach Reject. In the page form (operator direction
// 2026-07-22: the overlay didn't fit small/mobile viewports) that holds
// because this is an ordinary scrolling page whose action row flows
// inline with the content, so nothing can trap the buttons behind a
// fixed region. The overlay/panel markup must stay gone, and the footer
// must NOT dock to the viewport (operator direction: no docked bar, no
// banded panel above/below the buttons).
const modalCss = read('packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.module.css');
assert.match(modalCss, /\.page\s*\{[^}]*flex-direction:\s*column/s, 'page is a flex column');
assert.match(modalCss, /\.footer\s*\{[^}]*margin-top/s, 'action row is spaced from the content above it');
assert.doesNotMatch(modalCss, /\.footer\s*\{[^}]*position:\s*(sticky|fixed)/s, 'action row is not docked to the viewport');
assert.doesNotMatch(modalCss, /\.footer\s*\{[^}]*background/s, 'action row has no panel background band');
assert.doesNotMatch(modalCss, /\.footer\s*\{[^}]*border-top/s, 'action row has no divider rule above the buttons');
assert.doesNotMatch(modalCss, /\.overlay\b/, 'no overlay backdrop remains');
assert.match(modalSrc, /<Screen /, 'confirm surface renders as a Screen page');
assert.match(modalSrc, /title="Confirm"/, 'page header reads Confirm');
assert.match(modalSrc, /onBack=\{onReject\}/, 'header back arrow is Reject');

console.log('confirm-modal-send-slice1.smoke.js OK');
