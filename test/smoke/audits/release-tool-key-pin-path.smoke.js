// The release tools' key pin must name a public key that exists.
//
// verify.sh resolves the pin's publicKey against the pin file's own directory
// and refuses every publish when the file is missing. When the pin moved from
// docs/ to tools/release/pins/ its relative path came along unchanged, so every
// staging and production publish refused while every other check stayed green.
// This reads the path exactly the way verify.sh does.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const pinPath = join(root, 'tools', 'release', 'pins', 'release-key-pin.json');
const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
const writer = readFileSync(join(root, 'tools', 'release', 'verify-release-key.sh'), 'utf8');
const verifier = readFileSync(join(root, 'tools', 'release', 'verify.sh'), 'utf8');

const heredocMatch = /<<PINEOF\n([\s\S]*?)\nPINEOF/.exec(writer);
assert.ok(heredocMatch, 'verify-release-key.sh no longer has a recognizable pin heredoc.');
for (const field of ['fingerprint', 'signingSubkey', 'publicKey']) {
    assert.ok(heredocMatch[1].includes(`"${field}"`),
        `verify-release-key.sh omits ${field}, so its next run writes a pin verify.sh refuses.`);
    assert.ok(verifier.includes(`"${field}"`),
        `verify.sh no longer reads ${field}; update the writer-reader contract together.`);
}

const relMatch = /^\s*PIN_PUBLIC_KEY_REL="([^"]+)"$/m.exec(writer);
assert.ok(relMatch, 'verify-release-key.sh names no relative public-key path for the pin.');
assert.equal(relMatch[1], pin.publicKey,
    'verify-release-key.sh would overwrite the observed pin with a different publicKey path.');

const checkStart = writer.indexOf('PIN_PUBLIC_KEY_INFO=');
const writeStart = writer.indexOf('cat > "$PIN_PATH"');
assert.ok(checkStart > 0 && writeStart > checkStart,
    'verify-release-key.sh must inspect the public key before writing the pin.');
const keyCheck = writer.slice(checkStart, writeStart);
assert.match(keyCheck, /--import-options show-only --import/,
    'verify-release-key.sh must read the exported public key fingerprint without importing it.');
assert.match(keyCheck, /GNUPGHOME="\$PIN_PUBLIC_KEY_GNUPGHOME"/,
    'verify-release-key.sh must inspect the public key outside the operator keyring.');
assert.match(keyCheck, /\[ "\$PIN_PUBLIC_KEY_FPR" = "\$PIN_KEY_FPR" \] \\\n+\s*\|\| die/,
    'verify-release-key.sh must refuse a public key whose fingerprint differs from the signing key.');

assert.ok(pin.publicKey, 'tools/release/pins/release-key-pin.json names no publicKey, so '
    + 'verify.sh refuses every publish.');

const keyPath = join(dirname(pinPath), pin.publicKey);
let armored = '';
try {
    armored = readFileSync(keyPath, 'utf8');
} catch {
    assert.fail(`tools/release/pins/release-key-pin.json points publicKey at ${pin.publicKey}, `
        + 'which resolves to no file beside the pin, so verify.sh refuses every publish.');
}
assert.ok(armored.includes('BEGIN PGP PUBLIC KEY BLOCK'),
    `${pin.publicKey} is not an armored public key, so verify.sh has nothing to import.`);

console.log(`PASS release-tool-key-pin-path.smoke.js (writer emits checked publicKey ${pin.publicKey})`);
