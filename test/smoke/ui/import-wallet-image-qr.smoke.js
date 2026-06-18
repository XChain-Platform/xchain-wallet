// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Cluster H FOLLOWUP 2: image-QR decode for the ImportWallet
// drop-zone. v0.173.0's mnemonic dropzone rejected anything that
// wasn't `text/*` or `.txt` / `.asc`. This sweep extends the dropzone
// to recognise PNG / JPEG image drops, render them to an off-screen
// canvas, and feed the QR rawValue through the existing
// `handleQrFrame`. PDFs remain rejected (need a third-party PDF
// render layer); browsers without `BarcodeDetector` (Safari, Firefox)
// surface a friendly hint instead of failing silently.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const importSrc = read('packages/core/src/shared/routes/ImportWallet.jsx');

// 1. The drop handler tags the FOLLOWUP id and detects image files
//    by both MIME type and extension fallback (PNG / JPG / JPEG).
assert.ok(/Cluster H FOLLOWUP 2/.test(importSrc),
    'ImportWallet tags Cluster H FOLLOWUP 2');
assert.ok(/file\.type\.startsWith\('image\/'\)/.test(importSrc),
    'image branch detects MIME type starting with image/');
assert.ok(/\/\\\.\(png\|jpe\?g\)\$\/i\.test\(file\.name\)/.test(importSrc),
    'image branch falls back to .png / .jpg / .jpeg extension when MIME is missing');

// 2. Browsers without BarcodeDetector get a friendly hint, not a
//    silent failure.
assert.ok(/typeof globalThis\.BarcodeDetector !== 'function'/.test(importSrc),
    'image branch feature-checks BarcodeDetector before decoding');
assert.ok(/Image-QR decoding requires a browser with BarcodeDetector support/.test(importSrc),
    'image branch surfaces a friendly hint for unsupported browsers');

// 3. On a successful decode the rawValue is fed into handleQrFrame
//    (which strips an optional bip39: prefix and seeds the textarea).
assert.ok(/decodeImageQrFile\(file\)[\s\S]{0,200}handleQrFrame\(text\)/.test(importSrc),
    'decoded QR text is routed through handleQrFrame');
assert.ok(/'No QR code found in the dropped image\.'/.test(importSrc),
    'empty decode result surfaces a "No QR code found" error');

// 4. Plain-text rejection copy mentions the new image case so the
//    user knows what's accepted.
assert.ok(/Only plain-text files \(\.txt \/ \.asc\) or QR images \(\.png \/ \.jpg\) can be dropped here\./.test(importSrc),
    'plain-text rejection copy mentions PNG / JPG image drops');

// 5. The decodeImageQrFile helper exists with the documented
//    signature, paints to canvas, instantiates BarcodeDetector
//    requesting 'qr_code', and revokes the object URL in finally.
assert.ok(/async function decodeImageQrFile\(file\)/.test(importSrc),
    'decodeImageQrFile helper is defined with the documented signature');
assert.ok(/document\.createElement\('canvas'\)/.test(importSrc),
    'decodeImageQrFile renders the image to a canvas');
assert.ok(/new globalThis\.BarcodeDetector\(\{ formats: \['qr_code'\] \}\)/.test(importSrc),
    'decodeImageQrFile asks BarcodeDetector for qr_code format only');
assert.ok(/URL\.revokeObjectURL\(url\)/.test(importSrc),
    'decodeImageQrFile releases the object URL in finally');

// 6. Image dimensions are guarded: a 0x0 PNG would otherwise raise
//    InvalidStateError on the canvas paint.
assert.ok(/canvas\.width === 0 \|\| canvas\.height === 0/.test(importSrc),
    'decodeImageQrFile rejects 0×0 images before painting');

console.log('OK: ImportWallet image-QR drop branch (PNG / JPEG)');
