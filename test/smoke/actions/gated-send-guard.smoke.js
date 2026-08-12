// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-26 (gated SEND guard + key-recovery scan): every
// SEND-composing flow routes through prepareGatedSend (sendToken,
// buildSendPsbt, the composeForConfirm SEND branch); the scan
// persists recovered keys to the vault; Send.jsx surfaces
// ready/partial/blocked states with the recovery affordance; the
// non-SEND give-side flows warn (never block); Advanced warns loudly.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Guard flow ---------------------------------------------------------
const guard = read('packages', 'core', 'src', 'flows', 'gatedSendGuard.js');
assert.match(guard, /export async function prepareGatedSend/, 'guard entry point exists');
assert.match(guard, /action: 'BATCH', params: \{ VERSION: '0', COMMAND: `\$\{sendCmd\};\$\{messageCmd\}` \}/,
    'rewrites into one atomic BATCH(SEND, MESSAGE)');
assert.match(guard, /GatedSendKeysMissingError/, 'zero-keys hard block is typed');
assert.match(guard, /GatedRecipientPubkeyMissingError/, 'no-pubkey hard block is typed');
assert.match(guard, /recipientPubkeyMatchesAddress\(sdk, pubkey, to, descriptor\)/,
    'explorer pubkey is address-bound (anti-substitution)');
assert.match(guard, /GATED_SEND_PARTIAL_KEYS/, 'partial pack set warns, not blocks');
assert.match(guard, /eciesEncryptBytes\(payload, pubkey\)/, 'handoff ECIES-encrypted to the RECIPIENT pubkey');
assert.match(guard, /isDemoGatedActionIndex/, 'demo fixtures excluded from real detection');
assert.match(guard, /export async function gatedSendReadiness/, 'secret-free readiness probe exists');

// ---- Every SEND-composing path runs the guard ---------------------------
const sendFlow = read('packages', 'core', 'src', 'flows', 'sendToken.js');
assert.match(sendFlow, /prepareGatedSend\(\{/, 'sendToken (software + HW + bridge) runs the guard');
assert.match(sendFlow, /if \(!opts\.prebuiltPsbt && !isMulti\) \{/,
    'prebuilt path skips (already guarded at compose); PC-52 multi-leg skips because it is refused outright');
const psbtFlow = read('packages', 'core', 'src', 'flows', 'buildSendPsbt.js');
assert.match(psbtFlow, /prepareGatedSend\(\{/, 'watcher buildSendPsbt runs the guard');
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.match(host, /const gatedPlan = isMulti \? null : await prepareGatedSend\(\{/,
    'composeForConfirm SEND branch runs the guard on the single-recipient path');

// PC-52: the guard composes ONE key handoff, encrypted to ONE recipient, so a
// multi-recipient send of a gated tick has no valid composition today. Each
// SEND-composing path must refuse it rather than emit an unpaired gated send.
for (const [name, src] of [['sendToken', sendFlow], ['buildSendPsbt', psbtFlow], ['host composeForConfirm', host]]) {
    assert.match(src, /assertNoGatedLegs\(\{/, `${name} refuses a multi-leg send of a gated tick`);
}
assert.match(host, /host\.register\('action\.send\.psbt', async \(req, \{ vault, chainRegistry, sdkRegistry \}\)/,
    'watcher handler passes the vault for gatedKeys access');
assert.match(host, /host\.register\('gatedContent\.sendReadiness',/, 'readiness handler exists');
assert.match(host, /host\.register\('gatedContent\.scan',/, 'recovery-scan handler exists');

// ---- Recovery scan persists to the vault --------------------------------
const content = read('packages', 'core', 'src', 'flows', 'gatedContent.js');
assert.match(content, /export async function recoverGatedKeysForTick/, 'recovery scan flow exists');
assert.match(content, /source: 'recovered'/, 'recovered keys persist with the recovered source tag');
assert.match(content, /a\.source !== 'watch-only' && a\.source !== 'trezor' && a\.source !== 'ledger'/,
    'scan skips signer types that cannot export keys');

// ---- Messaging exports x3 shells ---------------------------------------
for (const [label, ...p] of [
    ['web', 'packages', 'web', 'src', 'messaging.js'],
    ['desktop', 'packages', 'desktop', 'renderer', 'messaging.js'],
    ['extension', 'packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const m = read(...p);
    for (const fn of ['gatedSendReadiness', 'gatedContentScan']) {
        assert.match(m, new RegExp(`export function ${fn}\\(`), `${label}: exports ${fn}`);
    }
}

// ---- Send.jsx UI --------------------------------------------------------
const send = read('packages', 'core', 'src', 'shared', 'routes', 'Send.jsx');
assert.match(send, /messaging\.gatedSendReadiness\(/, 'Send probes readiness');
assert.match(send, /gatedInfo\?\.state === 'blocked'/, 'blocked state stops review');
assert.match(send, /messaging\.gatedContentScan\(/, 'recovery scan wired');
assert.match(send, /isWatcherMode \|\| isHwSource/, 'HW/watcher get capability copy instead of the scan');
assert.match(send, /will NOT be able to open the missing pack/, 'partial state lists missing packs');

// ---- Non-SEND give-side warnings (never block) --------------------------
const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useGatedTickNotice.js');
assert.match(hook, /export function useGatedTickNotice/, 'shared detection hook exists');
assert.match(hook, /export function gatedTickWarningCopy/, 'shared warning copy exists');
for (const [label, noun, ...p] of [
    ['airdrop', 'airdrop recipients', 'packages', 'core', 'src', 'shared', 'routes', 'AirdropForm.jsx'],
    ['dividend', 'dividend recipients', 'packages', 'core', 'src', 'shared', 'routes', 'DividendForm.jsx'],
    ['dispenser', 'buyers dispensed this token', 'packages', 'core', 'src', 'shared', 'routes', 'DispenserForm.jsx'],
    ['swap', 'the swap counterparty', 'packages', 'core', 'src', 'shared', 'routes', 'SwapForm.jsx'],
    ['order', 'the order counterparty', 'packages', 'core', 'src', 'shared', 'components', 'PlaceOrderPanel.jsx'],
]) {
    const src = read(...p);
    assert.match(src, /useGatedTickNotice\(\{/, `${label}: detects gated give-side tick`);
    assert.ok(src.includes(`'${noun}'`), `${label}: renders the shared warning copy`);
}

// ---- Advanced escape hatch warns loudly, never blocks -------------------
const advanced = read('packages', 'core', 'src', 'shared', 'routes', 'AdvancedActionsForm.jsx');
assert.match(advanced, /action === 'SEND' \|\| action === 'BATCH'/, 'raw SEND/BATCH shows the gated rule warning');
assert.match(advanced, /a bare SEND of it will be rejected/, 'live-detected tick escalates the warning');
assert.ok(!/gatedRawNotice\.gated[\s\S]{0,200}disabled/.test(advanced), 'Advanced never disables submit on gated detection');

// ---- TokenDetail constraint copy ---------------------------------------
const tokenDetail = read('packages', 'core', 'src', 'shared', 'routes', 'TokenDetail.jsx');
assert.match(tokenDetail, /only to addresses that have made\s*\n?\s*at least one transaction/,
    'TokenDetail states the never-spent-recipient constraint');

console.log('gated-send-guard smoke: OK');
