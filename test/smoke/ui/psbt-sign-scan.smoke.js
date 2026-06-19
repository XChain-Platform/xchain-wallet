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
//   - BBQr frames append newline-separated to the paste textarea so
//     the existing paste pipeline assembles them.
//   - Single hex / base64 frames close the scanner immediately.
//   - The XCW progress label surfaces receivedCount / total once the
//     first frame lands.

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
    /setPasted\(hex\);[\s\S]+?setScannerOpen\(false\)/,
    'on completion, hex flows into setPasted and scanner closes',
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
    /setPasted\(\(cur\) => \(cur\.length > 0 \? `\$\{cur\}\\n\$\{text\}` : text\)\)/,
    'BBQr frames append newline-separated to the paste textarea',
);
assert.match(
    formSrc,
    /if \(fmt === 'hex' \|\| fmt === 'base64'\)/,
    'single-frame hex/base64 has its own branch',
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
    /XCW frames received: \{xcwCollector\.receivedCount\} of \{xcwCollector\.total\}/,
    'XCW progress label surfaces receivedCount / total',
);

// ─── 4. open-scanner reset ──────────────────────────────────────────────

assert.match(
    formSrc,
    /if \(scannerOpen\) setXcwCollector\(createXcwCollector\(\)\)/,
    'opening the scanner resets the XCW collector',
);

console.log('psbt-sign-scan smoke OK');
