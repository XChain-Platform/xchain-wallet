// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-16 (CoinPay auto-pay): the engine, the consent chain,
// and every wiring leg. Auto-pay signs real coin unattended, so this
// pins the layered defenses in place: consent recorded from the exact
// signed params, engine started in all three shells with the pool's
// signers and the HOST-shared reservation ledger, the panel's checkbox
// only for software signers on a native-GIVE order, and the payer
// lease + policy modules registered in the vault.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Vault: both PC-16 collections registered + codec slots -------------
const vaultSrc = read('packages', 'core', 'src', 'storage', 'Vault.js');
assert.match(vaultSrc, /this\.autopayOrders = makeCollection\(/, 'autopayOrders collection registered');
assert.match(vaultSrc, /this\.autopayLeases = makeCollection\(/, 'autopayLeases collection registered');
const codecSrc = read('packages', 'core', 'src', 'storage', 'codec.js');
assert.match(codecSrc, /autopayOrders: parsed\.autopayOrders \?\? empty\.autopayOrders/, 'codec merges autopayOrders');
assert.match(codecSrc, /autopayLeases: parsed\.autopayLeases \?\? empty\.autopayLeases/, 'codec merges autopayLeases');

// ---- Consent write: orderAction persists the exact signed terms ---------
const orderSrc = read('packages', 'core', 'src', 'flows', 'orderAction.js');
assert.match(orderSrc, /isNativeGiveOrder\(opts\.params\)/, 'consent only for native-GIVE orders');
assert.match(orderSrc, /recordAutopayConsent\(/, 'consent record written post-broadcast');
assert.match(orderSrc, /autopayArmed = false/, 'failed consent write surfaces instead of failing the order');

// ---- Engine: caps live in the pure policy; watcher uses them ------------
const policySrc = read('packages', 'core', 'src', 'market', 'autopayPolicy.js');
assert.match(policySrc, /ARMING_CUTOFF_SECONDS = 45 \* 60/, 'T-45 arming cutoff pinned');
assert.match(policySrc, /RETRY_CUTOFF_SECONDS = AT_RISK_SECONDS/, 'retry cutoff = the PC-15 at-risk band');
assert.match(policySrc, /DEFAULT_CONFIRM_DEPTH = 2/, 'depth-2 confirm gate pinned');
const watcherSrc = read('packages', 'core', 'src', 'notifications', 'CoinpayAutopayWatcher.js');
assert.match(watcherSrc, /evaluateObligation\(\{/, 'watcher decides through the policy module');
assert.match(watcherSrc, /coinpayAction/, 'payments ride the verified coinpayAction preamble');
assert.match(watcherSrc, /_attempted\.add\(matchIndex\);/, 'attempt marked before signing');
assert.match(watcherSrc, /pendingTxReferencesMatch/, 'own-pendingTx duplicate defense wired');
assert.match(watcherSrc, /createAutopayLease\(/, 'payer lease claimed/renewed per cycle');
const notifExports = read('packages', 'core', 'src', 'notifications', 'index.js');
assert.match(notifExports, /CoinpayAutopayWatcher/, 'engine exported from notifications');

// ---- Host: autopay handlers + ledger exposure ---------------------------
const hostSrc = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
for (const handler of ['autopay.list', 'autopay.setEnabled', 'autopay.exposure', 'autopay.resolveIndexes', 'autopay.status']) {
    assert.match(hostSrc, new RegExp(`host\\.register\\('${handler.replace('.', '\\.')}'`), `${handler} registered`);
}
assert.match(hostSrc, /host\.reservationLedger = reservationLedger;/,
    'host exposes its ledger so engine holds net with confirm-surface reservations');

// ---- Shells: engine started everywhere, with the shared ledger ----------
const extBg = read('packages', 'extension', 'src', 'background.js');
assert.match(extBg, /new notificationsLib\.CoinpayAutopayWatcher\(\{/, 'extension starts the engine');
assert.match(extBg, /reservationLedger: host\.reservationLedger/, 'extension engine uses the host ledger');
assert.match(extBg, /shellKind: 'extension'/, 'extension shellKind');
const webBridge = read('packages', 'web', 'src', 'hostBridge.js');
assert.match(webBridge, /new notificationsLib\.CoinpayAutopayWatcher\(\{/, 'web starts the engine');
assert.match(webBridge, /shellKind: 'web'/, 'web shellKind');
const desktopRuntime = read('packages', 'desktop', 'main', 'runtime.js');
assert.match(desktopRuntime, /new notificationsLib\.CoinpayAutopayWatcher\(\{/, 'desktop starts the engine');
assert.match(desktopRuntime, /shellKind: 'desktop'/, 'desktop shellKind');
assert.match(desktopRuntime, /signerPool: runtime\.signerPool/, 'desktop unlock populates the signer pool (arms auto-pay)');

// ---- Messaging: all three shells expose the autopay client methods ------
for (const [shellPath, label] of [
    [['packages', 'extension', 'src', 'popup', 'messaging.js'], 'extension'],
    [['packages', 'web', 'src', 'messaging.js'], 'web'],
    [['packages', 'desktop', 'renderer', 'messaging.js'], 'desktop'],
]) {
    const src = read(...shellPath);
    for (const fn of ['listAutopayOrders', 'setAutopayEnabled', 'getAutopayExposure', 'resolveAutopayIndexes', 'getAutopayStatus']) {
        assert.match(src, new RegExp(`export function ${fn}\\(`), `${label} messaging exports ${fn}`);
    }
}

// ---- PlaceOrderPanel: consent UI + native-lane wire correctness ---------
const panel = read('packages', 'core', 'src', 'shared', 'components', 'PlaceOrderPanel.jsx');
assert.match(panel, /GIVE_COIN: coinTicker, GET_COIN: coinTicker/,
    'ORDER params carry the COIN networks (indexer rejects them missing)');
assert.match(panel, /p\.GIVE_TICK\.toUpperCase\(\) === coinTicker\) p\.GIVE_TICK = ''/,
    'native GIVE side composes as an EMPTY tick (wire rule)');
assert.match(panel, /Enable CoinPay auto-pay/, 'consent checkbox present');
assert.match(panel, /useState\(true\)/, 'checkbox defaults ON');
assert.match(panel, /giveIsNative && !isWatcherMode && !isHwSource\(fromAddress\)/,
    'checkbox only for software signers on a native-GIVE order');
assert.match(panel, /I understand the wallet must stay open for auto-pay to work\./,
    'web keep-open acknowledgment copy');
assert.match(panel, /autopay: autopayArm \? \{ enabled: true \} : undefined/,
    'consent flag threads through the submit paths');
assert.match(panel, /Outstanding auto-pay exposure/, 'aggregate exposure shown when armed');

// ---- Revocation + status surfaces ---------------------------------------
const openOrders = read('packages', 'core', 'src', 'shared', 'components', 'OpenOrdersPanel.jsx');
assert.match(openOrders, /setAutopayEnabled\(\{ id: record\.id, enabled: record\.autopay !== true \}\)/,
    'per-market order rows carry the local revocation toggle');
const obligations = read('packages', 'core', 'src', 'shared', 'routes', 'ObligationsView.jsx');
assert.match(obligations, /getAutopayStatus/, 'ObligationsView reads the armed/disarmed status');
assert.match(obligations, /Auto-pay is disarmed/, 'disarmed re-arm banner present');

// ---- Explorer dependency contract ---------------------------------------
// The policy REFUSES to pay when order_matches rows lack fill amounts, so
// the wallet-side contract is the degrade path; the explorer-side columns
// are pinned in xchain-explorer's own suite (db.action-queries).
assert.match(policySrc, /amounts-unavailable/, 'missing fill amounts degrade to notify-manual, never pay');

console.log('coinpay-autopay smoke: OK');
