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
// §5.3.4: permanence must ride in the error NAME - the messaging envelope
// carries only { name, message }, so a custom field would be dropped.
assert.match(submitActionSrc, /err\.name\s*=\s*permanence === 'permanent'/, 'submitAction stamps permanence into the error name');
const hostEnvelopeSrc = read('packages', 'extension', 'src', 'background', 'MessageHost.js');
assert.match(hostEnvelopeSrc, /return \{ ok: false, error: \{ name, message \} \}/, 'boundary envelope is still name+message only (permanence must not rely on custom fields)');
const permanenceSrc = read('packages', 'core', 'src', 'flows', 'broadcastPermanence.js');
assert.match(permanenceSrc, /export function broadcastFailureKindFromError/, 'permanence is recoverable from a boundary-crossed error');

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
// §5.3.4 credential re-prompt: the hook returns to `ready` with an error and
// the modal renders it, so a bad password does not tear the modal down.
assert.match(sendSrc, /error=\{confirmAction\.error\}/, 'Send passes the confirm error into the modal');
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

// §5.2.7 layout contract is a SAFETY property, not cosmetics: header and
// footer pinned, body the only scroll region, so a long BATCH/AIRDROP
// intent can never push Reject/Approve off-screen in the ~360x600 popup.
const modalCss = read('packages', 'core', 'src', 'shared', 'components', 'ConfirmActionModal.module.css');
assert.match(modalCss, /\.panel\s*\{[^}]*flex-direction:\s*column/s, 'panel is a flex column');
assert.match(modalCss, /\.panel\s*\{[^}]*max-height/s, 'panel is capped to the viewport');
assert.match(modalCss, /\.body\s*\{[^}]*overflow-y:\s*auto/s, 'body scrolls internally');
assert.match(modalCss, /\.body\s*\{[^}]*min-height:\s*0/s, 'body can shrink (flex overflow needs min-height:0)');
assert.match(modalCss, /\.header\s*\{[^}]*flex:\s*0 0 auto/s, 'header is pinned');
assert.match(modalCss, /\.footer\s*\{[^}]*flex:\s*0 0 auto/s, 'footer is pinned');
assert.match(modalCss, /prefers-reduced-motion/, 'entry animation respects reduced-motion');

console.log('confirm-modal-send-slice1.smoke.js OK');
