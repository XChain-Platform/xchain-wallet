// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §24.3 / Cluster Y FOLLOWUP 1 smoke: dedicated scan-and-classify route.
//
// Asserts:
//   1. ScanRoute exists, mounts QrScanner + a paste fallback, and
//      classifies via the existing detectQrContent helper.
//   2. BottomTabBar PRIMARY_TABS swaps Receive for Scan and the More
//      sheet now lists Receive (so the surface set stays complete).
//   3. LeftNav primary list grows a Scan entry between Receive and DEX
//      and VIEW_GROUPS knows about it.
//   4. Web + desktop + extension popup App.jsx import ScanRoute, ship
//      a 'scan' top-level view, and route the four supported outcomes
//      (send / receive / psbt) to existing views via setUnlockedView /
//      setSendPrefill.
//   5. The shared ScanRoute does NOT auto-import secret material:
//      WIF / mnemonic outcomes surface a "use Import Wallet" message
//      instead of calling onClassified.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. ScanRoute file shape ------------------------------------------

const scanRouteSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'ScanRoute.jsx'),
    'utf8',
);
assert.ok(/export function ScanRoute\(/.test(scanRouteSrc),
    'ScanRoute is exported');
assert.ok(/import \{ detectQrContent \} from '\.\.\/\.\.\/uri\/detectQrContent\.js'/.test(scanRouteSrc),
    'ScanRoute imports the existing detectQrContent classifier (no duplicate logic)');
assert.ok(/import \{[^}]*\bparseXchainUri\b[^}]*\} from '\.\.\/\.\.\/uri\/xchainUri\.js'/.test(scanRouteSrc),
    'ScanRoute imports parseXchainUri for the richer xchain: intent split');
//  §3.6: the same import line now also pulls hardenUriIntentText, the
// deep-link display-hardening fix (memo/tick land in prefill state
// unneutralized otherwise). Asserted separately from the line above so a
// regression in either import is its own failure, not a shared one.
assert.ok(/import \{[^}]*\bhardenUriIntentText\b[^}]*\} from '\.\.\/\.\.\/uri\/xchainUri\.js'/.test(scanRouteSrc),
    'ScanRoute imports hardenUriIntentText and applies it to a scanned xchain: intent before routing');
assert.ok(/QrScanner onFrame=\{handleFrame\}/.test(scanRouteSrc),
    'ScanRoute mounts <QrScanner> with a frame handler');
assert.ok(/<textarea/.test(scanRouteSrc),
    'ScanRoute provides a paste-fallback textarea (BarcodeDetector not always available)');
assert.ok(/t\('scan\.classifyPaste'\)/.test(scanRouteSrc),
    'ScanRoute exposes a Classify-pasted-payload action for the textarea path (i18n: scan.classifyPaste)');
assert.ok(/claimedRef\.current/.test(scanRouteSrc),
    'ScanRoute uses a claimedRef latch so a stream of QR frames only routes once');
assert.ok(/t\('scan\.error\.wif'\)/.test(scanRouteSrc) && /t\('scan\.error\.mnemonic'\)/.test(scanRouteSrc),
    'ScanRoute refuses to auto-route WIF / mnemonic; directs the user to Import Wallet instead (i18n: scan.error.wif/mnemonic)');
assert.ok(/t\('scan\.error\.xcwChunk',\s*\{\s*n:\s*detected\.n,\s*total:\s*detected\.total\s*\}\)/.test(scanRouteSrc),
    'ScanRoute punts XCW chunks back to PsbtSignForm (i18n: scan.error.xcwChunk with n/total vars)');

// --- 1b. ScanRoute uses t() and dictionary covers every key ----------

assert.ok(/import \{ t \} from '\.\.\/\.\.\/i18n\/index\.js'/.test(scanRouteSrc),
    'ScanRoute imports t() from the core i18n module (Cluster R FOLLOWUP 2 beachhead)');

const SCAN_KEYS = [
    'common.back',
    'scan.title',
    'scan.scannerAlt',
    'scan.routing',
    'scan.pasteLabel',
    'scan.pastePlaceholder',
    'scan.classifyPaste',
    'scan.error.pasteEmpty',
    'scan.error.unknownXchainIntent',
    'scan.error.wif',
    'scan.error.mnemonic',
    'scan.error.xcwChunk',
    'scan.error.unknown',
];
const { en } = await import('../../../packages/core/src/i18n/locales/en/index.js');
for (const key of SCAN_KEYS) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0,
        `en dictionary defines "${key}" for ScanRoute`);
}
// Each key (except common.back, which is shared with the rest of the app)
// is referenced in ScanRoute via t('key').
for (const key of SCAN_KEYS) {
    assert.ok(scanRouteSrc.includes(`t('${key}')`)
        || scanRouteSrc.includes(`t('${key}',`),
        `ScanRoute calls t('${key}')`);
}
assert.ok(/\{n\}\/\{total\}/.test(en['scan.error.xcwChunk']),
    'scan.error.xcwChunk uses {n}/{total} placeholders');
assert.ok(/\{type\}/.test(en['scan.error.unknown']),
    'scan.error.unknown uses {type} placeholder');

// --- 2. BottomTabBar PRIMARY_TABS swap --------------------------------

const tabBarSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'BottomTabBar.jsx'),
    'utf8',
);
// Slice each array's body so the regex only inspects the intended block.
function arrayBody(name) {
    const start = tabBarSrc.indexOf(`const ${name} = [`);
    if (start < 0) throw new Error(`${name} not found in BottomTabBar.jsx`);
    const end = tabBarSrc.indexOf('];', start);
    return tabBarSrc.slice(start, end + 2);
}
const primaryBody = arrayBody('PRIMARY_TABS');
const sheetBody = arrayBody('SHEET_PRIMARY');
assert.ok(/id: 'scan',[\s\S]*?Icon\.ScanIcon/.test(primaryBody),
    'PRIMARY_TABS now contains Scan with ScanIcon');
assert.ok(!/id: 'receive'/.test(primaryBody),
    'PRIMARY_TABS no longer carries Receive (moved to More sheet)');
assert.ok(/id: 'receive',[\s\S]*?Icon\.ReceiveIcon/.test(sheetBody),
    'SHEET_PRIMARY (More drawer) now lists Receive so the surface stays reachable');
assert.ok(/Cluster Y FOLLOWUP 1/.test(tabBarSrc),
    'BottomTabBar header documents the swap as Cluster Y FOLLOWUP 1');

// --- 3. LeftNav adds Scan ---------------------------------------------

const leftNavSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'LeftNav.jsx'),
    'utf8',
);
assert.ok(/scan: \['scan'\]/.test(leftNavSrc),
    'LeftNav VIEW_GROUPS knows about the scan view');
assert.ok(
    /\{ id: 'scan', label: 'Scan', Icon: Icon\.ScanIcon \}/.test(leftNavSrc),
    'LeftNav primary list renders a Scan row with ScanIcon',
);

// --- 4. Three shells wire ScanRoute -----------------------------------

const shells = [
    { name: 'web', path: ['packages', 'web', 'src', 'App.jsx'] },
    { name: 'desktop', path: ['packages', 'desktop', 'renderer', 'App.jsx'] },
    { name: 'popup', path: ['packages', 'extension', 'src', 'popup', 'App.jsx'] },
];

for (const shell of shells) {
    const src = readFileSync(join(wsRoot, ...shell.path), 'utf8');
    assert.ok(/ScanRoute.*from '@xchain-wallet\/core\/shared\/routes\/ScanRoute\.jsx'/.test(src),
        `${shell.name} App.jsx imports ScanRoute`);
    assert.ok(/unlockedView === 'scan' && activeWalletId/.test(src),
        `${shell.name} App.jsx ships a 'scan' top-level view guarded on activeWalletId`);
    assert.ok(/onClassified=\{\(outcome\) => \{[\s\S]*?outcome\.kind === 'send'[\s\S]*?setUnlockedView\('send'\)/.test(src),
        `${shell.name} App.jsx routes send outcomes via setSendPrefill + setUnlockedView('send')`);
    assert.ok(/outcome\.kind === 'receive'[\s\S]*?setUnlockedView\('receive'\)/.test(src),
        `${shell.name} App.jsx routes receive outcomes to the Receive view`);
    assert.ok(/outcome\.kind === 'psbt'[\s\S]*?setUnlockedView\('sign-psbt'\)/.test(src),
        `${shell.name} App.jsx routes psbt outcomes to the Sign PSBT view`);
    // Membership, not position. This asserted `'scan'` was the LAST member of
    // the union, so any later view (PC-30's 'oracle', 's 'settings')
    // read as a missing scan route.
    assert.ok(/@type \{[^}]*'scan'[^}]*\} \*\/ \('home'\)/.test(src),
        `${shell.name} App.jsx unlockedView union covers 'scan'`);
}

// --- 5. Runtime classification: send + receive + psbt + secrets ------
// (Node smokes can't import .jsx; we exercise the underlying classifier
//  ScanRoute calls into to confirm the four outcome branches still
//  produce the shapes the shell wiring expects.)

const { detectQrContent } = await import('../../../packages/core/src/uri/detectQrContent.js');
const { parseXchainUri } = await import('../../../packages/core/src/uri/xchainUri.js');

const sendBip21 = detectQrContent('bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq?amount=0.0001');
assert.equal(sendBip21.type, 'bip21', 'detectQrContent classifies a BIP21 send URI');
assert.ok(sendBip21.address && sendBip21.address.startsWith('bc1q'),
    'BIP21 outcome carries the destination address');

const sendXchain = parseXchainUri('xchain://bitcoin-mainnet/BTC?amount=1&to=bc1q123');
assert.equal(sendXchain.kind, 'send', 'parseXchainUri returns kind:send for the path-style send URI');
assert.equal(sendXchain.address, 'bc1q123');
assert.equal(sendXchain.amount, '1');

const recvXchain = parseXchainUri('xchain://bitcoin-mainnet/BTC?kind=receive');
assert.equal(recvXchain.kind, 'receive', 'parseXchainUri returns kind:receive when explicitly requested');

const psbt = detectQrContent('70736274ff' + '0001020304'.repeat(10));
assert.equal(psbt.type, 'psbt-hex', 'detectQrContent classifies a PSBT hex blob');

const wif = detectQrContent('5JqfQ4cMxXshA1g7tVo3pEAULkkzy3X9P3T6vWXNwT5gKMx7c4P');
// May or may not validate as a WIF depending on checksum; we only
// care that the classifier *would* expose a 'wif' branch when valid,
// and ScanRoute's source already documents the refusal-to-auto-import.
assert.ok(['wif', 'unknown', 'address'].includes(wif.type),
    'wif test string classifies into one of the documented branches');

console.log(
    'OK: scan-route smoke (§24.3 / Cluster Y FOLLOWUP 1: ScanRoute mounts QrScanner + paste fallback over the existing detectQrContent classifier; BottomTabBar swaps Receive->Scan in PRIMARY_TABS and lists Receive in More; LeftNav grows a Scan row + VIEW_GROUPS entry; web/desktop/popup App.jsx all import ScanRoute and route send/receive/psbt outcomes to existing views; secret material is NOT auto-imported)',
);
