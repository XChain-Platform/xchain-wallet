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
    /uriLib\.buildXchainUri\(/,
    'encodes an xchain: send URI carrying the requested amount + tick',
);
assert.match(recvSrc, /amount: amount \|\| undefined/, 'request URI uses the entered amount');
assert.match(recvSrc, /tick: tick \|\| undefined/, 'request URI carries the token tick');
assert.match(
    recvSrc,
    /uriLib\.encodeBip21Uri\(/,
    'falls back to a bare BIP21 URI for non-xchain wallets',
);

// --- QR generation ---------------------------------------------------

assert.match(recvSrc, /QRCode\.toDataURL\(qrUri/, 'request URI rendered to QR');

// --- QR image copy + share -------------------------------------------

assert.match(recvSrc, /copyQrImage = useCallback/, 'copy callback memoized');
assert.match(recvSrc, /shareQrImage = useCallback/, 'share callback memoized');
assert.match(
    recvSrc,
    /navigator\.clipboard\.write\(\[new ClipboardItem/,
    'copies the QR PNG to the clipboard as an image',
);
assert.match(
    recvSrc,
    /navigator\.share\(\{[\s\S]*?files: \[file\]/,
    'shares the QR image file via the Web Share API',
);
assert.match(recvSrc, /canShareFiles/, 'feature-detects file-share support');
assert.match(
    recvSrc,
    /navigator\.canShare\(\{ files:/,
    'probes navigator.canShare with a file before offering Share',
);

// --- buttons ---------------------------------------------------------

assert.match(recvSrc, /Copy QR/, 'Copy QR button');
assert.match(recvSrc, /Share QR/, 'Share QR button (shown when file-share is supported)');

// --- CSS hooks -------------------------------------------------------

for (const cls of ['qrBox', 'qr', 'qrActions', 'assetCard']) {
    assert.match(recvCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('receive-request-share smoke OK');
