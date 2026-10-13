// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §20.4 / Cluster E FOLLOWUP 4: QR scan for PsbtSignForm.
//
// Pins:
//   - PsbtSignForm imports QrScanner from core/ui and the XCW collector
//     primitives from core/uri/psbtQr.js.
//   - A `scannerOpen` state toggles via a "Scan PSBT" button mounted
//     next to "Browse for .psbt file".
//   - `handleScannerFrame` routes XCW frames through the collector,
//     emits the assembled hex into setPasted on completion, and
//     auto-closes the scanner.
//   - BBQr frames collect by index so repeated camera reads do not inflate
//     progress, then the existing paste pipeline assembles them.
//   - Single hex / base64 frames close the scanner immediately.
//   - XCW, BBQr, and UR scans surface progress after the first frame.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'PsbtSignForm.jsx'),
    'utf8',
);

// ─── 1. imports ─────────────────────────────────────────────────────────

assert.match(
    formSrc,
    /QrScanner,?\s*\n[\s\S]*?\}\s*from '@xchain-wallet\/core\/ui'/,
    'PsbtSignForm imports QrScanner from core/ui',
);
assert.match(
    formSrc,
    /import \{[\s\S]+?createXcwCollector,[\s\S]+?addChunkToCollector,[\s\S]+?XCW_PREFIX,?\s*\} from '\.\.\/\.\.\/uri\/psbtQr\.js'/,
    'PsbtSignForm imports XCW collector primitives',
);

// ─── 2. state + handler ─────────────────────────────────────────────────

assert.match(
    formSrc,
    /const \[scannerOpen, setScannerOpen\] = useState\(false\)/,
    'PsbtSignForm tracks scannerOpen',
);
assert.match(
    formSrc,
    /const \[xcwCollector, setXcwCollector\] = useState\(\(\) => createXcwCollector\(\)\)/,
    'PsbtSignForm seeds the XCW collector via lazy init',
);
assert.match(
    formSrc,
    /const handleScannerFrame = useCallback\(/,
    'PsbtSignForm declares a handleScannerFrame callback',
);
assert.match(
    formSrc,
    /text\.startsWith\(XCW_PREFIX\)/,
    'XCW frames are recognized via the XCW_PREFIX constant',
);
assert.match(
    formSrc,
    /addChunkToCollector\(\{\s*\.\.\.prev\s*\}, text\)/,
    'XCW frame routes through addChunkToCollector with a fresh state copy',
);
assert.match(
    formSrc,
    /if \(next\.complete && next\.psbt\)/,
    'completion branch emits the assembled PSBT',
);
assert.match(
    formSrc,
    /const decoded = normalizePsbtInput\(hex\);[\s\S]+?setPasted\(decoded\);[\s\S]+?setScannerOpen\(false\)/,
    'on completion, validated hex flows into setPasted and scanner closes',
);
assert.match(
    formSrc,
    /detectQrFrameFormat\(text\)/,
    'non-XCW frames go through the format detector',
);
assert.match(
    formSrc,
    /if \(fmt === 'bbqr'\)/,
    'BBQr frames have a dedicated branch',
);
assert.match(
    formSrc,
    /bbqrFramesRef\.current\.set\(parsed\.index, trimmedFrame\)/,
    'BBQr progress counts unique frame indexes',
);
assert.match(
    formSrc,
    /if \(received === parsed\.total\)[\s\S]+?normalizePsbtInput\(frames\.join\('\\n'\)\)/,
    'a complete BBQr frame set is assembled through the normal input decoder',
);
assert.match(
    formSrc,
    /const decoded = normalizePsbtInput\(text\)/,
    'single-frame hex/base64 routes through the normal input decoder',
);

// ─── 3. UI mount ────────────────────────────────────────────────────────

assert.match(
    formSrc,
    /\{scannerOpen \? 'Close scanner' : 'Scan transaction'\}/,
    'Scan-toggle button label flips on scannerOpen',
);
assert.match(
    formSrc,
    /<QrScanner onFrame=\{handleScannerFrame\} alt="Transaction QR scanner"/,
    'QrScanner is mounted with handleScannerFrame + alt label',
);
assert.match(
    formSrc,
    /`\$\{scanProgress\.format\} frames received: \$\{scanProgress\.received\} of \$\{scanProgress\.total\}`/,
    'XCW and BBQr progress labels surface received / total',
);
assert.match(
    formSrc,
    /`UR decoding progress: \$\{scanProgress\.percent\}%`/,
    'UR progress label surfaces decoder progress',
);

// ─── 4. open-scanner reset ──────────────────────────────────────────────

// Tolerate the braced form: a second reset (the UR fountain decoder) was added
// alongside this one, so the single-statement `if (x) f()` became a block. The
// property being pinned is the RESET ON OPEN, not the brace style.
assert.match(
    formSrc,
    /if \(scannerOpen\)[\s\S]{0,120}?setXcwCollector\(createXcwCollector\(\)\)/,
    'opening the scanner resets the XCW collector',
);

console.log('psbt-sign-scan smoke OK');
