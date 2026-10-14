// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §29 Send/Receive, Step 5: Receive request-payment +
// Share button.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const recvSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Receive.jsx'),
    'utf8',
);
const recvCss = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'Receive.module.css'),
    'utf8',
);
const shareSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'share.js'),
    'utf8',
);

// QR-first redesign: the request-payment fields are now inline (no
// "Request payment" accordion, no memo/expiry). The user sets an amount
// (and optional token tick) and the QR re-renders to encode it; sharing
// hands off the QR *image* via the Web Share API rather than a URI.

// --- imports ----------------------------------------------------------

assert.match(recvSrc, /useMemo/, 'useMemo imported');
assert.match(recvSrc, /import QRCode from 'qrcode'/, 'QRCode imported');

// --- inline payment-request state ------------------------------------

for (const s of ['reqAmount', 'reqTick', 'amountInputMode', 'fiatAmount']) {
    assert.match(recvSrc, new RegExp(`\\b${s}\\b`), `state: ${s}`);
}

// --- request URI memo ------------------------------------------------

assert.match(recvSrc, /qrUri = useMemo/, 'qrUri memo');
assert.match(
    recvSrc,
    /uriLib\.encodeBip21Uri\(/,
    'encodes a BIP21-style URI carrying the requested amount',
);
assert.match(recvSrc, /amount,/, 'request URI uses the entered amount');
assert.match(recvSrc, /chain: activeChainId/, 'request URI preserves the selected network');
assert.match(recvSrc, /\.\.\.\(tick \? \{ tick \} : \{\}\)/, 'request URI carries the token tick');

// --- QR generation ---------------------------------------------------

assert.match(recvSrc, /QRCode\.toDataURL\(qrUri/, 'request URI rendered to QR');

// --- QR image copy + share -------------------------------------------

assert.match(recvSrc, /copyQrImage = useCallback/, 'copy callback memoized');
assert.match(recvSrc, /shareQrImage = useCallback/, 'share callback memoized');
assert.match(recvSrc, /import \{ shareContent, ShareOutcome \}/, 'imports platform share selection');
// Every shell's CSP limits connect-src to wallet hosts, so the PNG decoder
// stays in-process instead of relying on `fetch(dataUrl)`.
assert.doesNotMatch(recvSrc, /fetch\(qrDataUrl\)/, 'never fetches the QR data URL');
assert.match(recvSrc, /dataUrlToBlob\(qrDataUrl\)/, 'decodes the QR data URL in-process');
// The read-only address also provides a direct copy action.
assert.match(recvSrc, /copyAddress = useCallback/, 'single-tap request copy callback');
assert.match(recvSrc, /onClick=\{copyAddress\}/, 'tapping the address field copies it');
assert.match(recvSrc, /copyText\(address\.address\)/, 'address copy matches the visible address');
assert.match(
    recvSrc,
    /navigator\.clipboard\.write\(\[new ClipboardItem/,
    'copies the QR PNG to the clipboard as an image',
);
assert.match(
    recvSrc,
    /await shareContent\(data, \{ fallbackText: qrUri \}\)/,
    'uses native share before platform fallbacks',
);
assert.match(recvSrc, /title: `Receive \$\{asset\} with XChain`/, 'shares a useful title');
assert.match(recvSrc, /url: qrUri/, 'shares the exact payment request URL');
assert.match(
    recvSrc,
    /nav\.canShare\(withFile\)/,
    'attaches the QR image only when file sharing is supported',
);
assert.match(recvSrc, /fallbackText: qrUri/, 'provides the payment request as the share fallback');
assert.match(recvSrc, /ShareOutcome\.CANCELED/, 'treats share-sheet cancellation quietly');
const nativeShare = shareSrc.indexOf("getNativePlugin('App'");
const webShare = shareSrc.indexOf('await nav.share(data)');
const copyFallback = shareSrc.indexOf('await copyText(fallbackText');
assert.ok(nativeShare >= 0, 'platform share finds the native App bridge');
assert.ok(nativeShare < webShare, 'native share precedes Web Share');
assert.ok(webShare < copyFallback, 'Web Share precedes clipboard fallback');

// --- buttons ---------------------------------------------------------

assert.match(recvSrc, /Copy QR/, 'Copy QR button');
assert.match(recvSrc, /Share QR/, 'Share QR button is always offered for a rendered request');
assert.doesNotMatch(
    recvSrc,
    /\{canShareFiles \? \(/,
    'Share QR does not disappear when file sharing is unsupported',
);

// --- CSS hooks -------------------------------------------------------

for (const cls of ['qrBox', 'qr', 'qrActions', 'assetCard']) {
    assert.match(recvCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('receive-request-share smoke OK');
