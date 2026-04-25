// Smoke for §56.3 Pre-launch Step 1 of 7 — Camera scanner for the
// multisig paste-inbox (Phase 4 FOLLOWUP 2 from 2026-04-24_phase4-close.md).

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const sharedRoutes = join(core, 'src', 'shared', 'routes');
const ui = join(core, 'src', 'ui');

// ─── QrScanner — exports + shape ──────────────────────────────

const barrel = readFileSync(join(ui, 'index.js'), 'utf8');
assert.ok(/export\s*\{\s*QrScanner\s*\}\s*from\s*['"]\.\/QrScanner\.jsx['"]/.test(barrel),
    'core/ui barrel exports QrScanner from QrScanner.jsx');

const src = readFileSync(join(ui, 'QrScanner.jsx'), 'utf8');
assert.ok(/export function QrScanner\b/.test(src),
    'QrScanner.jsx defines the named component');
assert.ok(/BarcodeDetector/.test(src),
    'QrScanner uses the native BarcodeDetector API');
assert.ok(/formats:\s*\[['"]qr_code['"]\]/.test(src),
    'QrScanner requests the qr_code format');
assert.ok(/navigator\.mediaDevices\?\.getUserMedia|navigator\.mediaDevices\.getUserMedia/.test(src),
    'QrScanner requests a video MediaStream via getUserMedia');
assert.ok(/facingMode:\s*['"]environment['"]/.test(src),
    'QrScanner defaults to the environment-facing camera for QR capture');
assert.ok(/requestAnimationFrame/.test(src),
    'QrScanner drives detection on a RAF loop');
assert.ok(/stream\.getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/.test(src),
    'QrScanner stops every MediaStreamTrack on unmount (prevents dangling camera LED)');
assert.ok(/data-testid="qr-scanner-unsupported"/.test(src),
    'QrScanner renders a fallback surface when BarcodeDetector is unavailable');
assert.ok(/data-testid="qr-scanner"/.test(src),
    'QrScanner carries a stable test id on the supported render path');
assert.ok(/onFrame\(r\.rawValue\)/.test(src),
    'QrScanner emits each detected QR string via the onFrame callback');

// ─── MultisigSigningSession integration ──────────────────────

const route = readFileSync(join(sharedRoutes, 'MultisigSigningSession.jsx'), 'utf8');
assert.ok(/QrScanner/.test(route),
    'MultisigSigningSession imports QrScanner');
assert.ok(/Scan with camera/.test(route),
    'sign-screen exposes a "Scan with camera" button in the paste-inbox view');
assert.ok(/scannerOpen/.test(route),
    'sign-screen tracks scanner open state');
assert.ok(/<QrScanner[\s\S]*?onFrame=\{handleScannerFrame\}/.test(route),
    'sign-screen wires QrScanner onFrame to the scanner handler');
assert.ok(/handleScannerFrame/.test(route),
    'sign-screen defines handleScannerFrame');
assert.ok(/addChunkToCollector\(collectorState,\s*text\)/.test(route),
    'scanner handler routes each frame through the existing XCW collector');

// ─── Old copy removed — spec text no longer promises Step 21 ─

assert.ok(!/Step 21 will wire the camera scanner/.test(route),
    'legacy "Step 21 will wire the camera scanner" comment has been removed');

console.log(
    'OK — qr scanner smoke (QrScanner exports + BarcodeDetector + environment camera + RAF loop + track-cleanup on unmount + supported + unsupported data-testids + onFrame emission; MultisigSigningSession Scan-with-camera button + scannerOpen state + QrScanner mount in paste-inbox + handleScannerFrame routes through XCW collector + legacy Step-21 copy removed)',
);
