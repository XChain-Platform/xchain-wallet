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

// --- imports ----------------------------------------------------------

assert.match(recvSrc, /useMemo/, 'useMemo imported');

// --- request payment state -------------------------------------------

for (const s of ['reqOpen', 'reqAmount', 'reqTick', 'reqMemo', 'reqExpiryMinutes', 'reqQrDataUrl']) {
    assert.match(recvSrc, new RegExp(`\\b${s}\\b`), `state: ${s}`);
}

// --- request URI memo ------------------------------------------------

assert.match(recvSrc, /requestUri = useMemo/, 'requestUri memo');
assert.match(
    recvSrc,
    /uriLib\.encodeBip21Uri\(\{[\s\S]*amount:\s*reqAmount\.trim\(\)/,
    'request URI uses entered amount',
);
assert.match(
    recvSrc,
    /params\.tick\s*=\s*reqTick\.trim\(\)\.toUpperCase\(\)/,
    'tick param uppercased',
);
assert.match(
    recvSrc,
    /params\.expiry\s*=\s*expiresAt/,
    'expiry param computed from minutes',
);

// --- QR generation for the request URI ------------------------------

assert.match(recvSrc, /QRCode\.toDataURL\(requestUri/, 'request URI rendered to QR');

// --- Share button + handler -----------------------------------------

assert.match(recvSrc, /onShare = useCallback/, 'share callback memoized');
assert.match(recvSrc, /navigator\.share\(/, 'attempts Web Share API');
assert.match(recvSrc, /navigator\.clipboard\?\.writeText/, 'falls back to clipboard');
assert.match(recvSrc, /shareStatus/, 'inline status state');

// Share button rendered next to the bare-address Copy button (always
// present on a loaded address).
assert.match(
    recvSrc,
    /<Button[\s\S]*onClick=\{\(\) => onShare\(uriLib\.encodeBip21Uri/,
    'bare-address share button wired',
);

// --- request panel UI ------------------------------------------------

assert.match(recvSrc, /styles\.requestPanel/, 'panel CSS hook');
assert.match(recvSrc, /styles\.requestToggle/);
assert.match(recvSrc, /styles\.requestForm/);
assert.match(recvSrc, /styles\.requestUri/);
assert.match(recvSrc, /styles\.requestActions/);
assert.match(recvSrc, /aria-expanded=\{reqOpen\}/, 'accordion aria-expanded');
assert.match(recvSrc, /Request payment/i, 'panel toggle label');

// CSS hooks
for (const cls of ['requestPanel', 'requestToggle', 'requestForm', 'requestUri', 'requestActions']) {
    assert.match(recvCss, new RegExp(`\\.${cls}\\s*\\{`), `CSS hook .${cls}`);
}

console.log('receive-request-share smoke OK');
