// Smoke for §17.7 / Cluster E FOLLOWUP 5 — renderQR for ViewPrivateKey.
//
// Pins:
//   - shared/components/KeyQR.jsx exists, named export, lazy `qrcode`-backed
//     dataUrl rendering, degrades to null on encode failure.
//   - Both extension popup + web App.jsx import KeyQR and pass it through
//     ViewPrivateKey's renderQR render-prop.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

// --- 1. KeyQR component ---------------------------------------------------

const keyQrPath = join(core, 'src', 'shared', 'components', 'KeyQR.jsx');
assert.ok(existsSync(keyQrPath), 'KeyQR.jsx exists');
const keyQrSrc = readFileSync(keyQrPath, 'utf8');
assert.match(keyQrSrc, /export function KeyQR\(/, 'KeyQR is a named export');
assert.match(keyQrSrc, /import QRCode from 'qrcode'/, 'KeyQR imports qrcode lib');
assert.match(keyQrSrc, /QRCode\.toDataURL\(value/, 'KeyQR encodes the value via toDataURL');
assert.match(keyQrSrc, /errorCorrectionLevel: 'M'/, 'KeyQR uses ECC level M');
assert.match(keyQrSrc, /catch\(\(\) => \{ if \(!cancelled\) setDataUrl\(null\); \}\)/,
    'KeyQR degrades silently to null on encode error');
assert.match(keyQrSrc, /if \(!dataUrl\) return null/,
    'KeyQR renders nothing while/if no dataUrl');
assert.match(keyQrSrc, /<img[\s\S]+?src=\{dataUrl\}/, 'KeyQR renders the dataUrl in an <img>');
assert.match(keyQrSrc, /alt=\{alt\}/, 'KeyQR threads alt through for a11y');

// --- 2. Both shells wire renderQR to KeyQR --------------------------------

for (const [name, file] of [
    ['extension', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const src = readFileSync(file, 'utf8');
    assert.match(
        src,
        /import \{ KeyQR \} from '@xchain-wallet\/core\/shared\/components\/KeyQR\.jsx'/,
        `${name} App imports KeyQR`,
    );
    assert.match(
        src,
        /<ViewPrivateKey[\s\S]+?renderQR=\{\(\{ value \}\) => <KeyQR value=\{value\} alt="Private key QR" \/>\}/,
        `${name} App passes renderQR={KeyQR} to ViewPrivateKey`,
    );
}

console.log('view-private-key-qr smoke OK');
