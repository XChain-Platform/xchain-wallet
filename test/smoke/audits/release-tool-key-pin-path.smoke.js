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

console.log(`PASS release-tool-key-pin-path.smoke.js (publicKey ${pin.publicKey} resolves to an armored key)`);
