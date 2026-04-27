// Smoke for Cluster B Step 5 — Seed-phrase reveal flow.
// Exercises the pure flow shape; the cryptographic decryption itself
// is exercised by the existing wallet-blob unit tests.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'revealMnemonic.js'),
    'utf8',
);
const flowsIndex = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);

assert.match(flowSrc, /export async function revealMnemonic/, 'exports revealMnemonic');
assert.match(flowSrc, /class NoMnemonicForWifOnlyError/, 'wif-only error');
assert.match(
    flowSrc,
    /format === 'wif-only'/,
    'rejects wif-only wallets',
);
assert.match(
    flowSrc,
    /decryptWalletSeed/,
    'decrypts seed via shared crypto helper',
);
assert.match(
    flowSrc,
    /plaintext\.fill\(0\)/,
    'zeros plaintext buffer in finally',
);
assert.match(
    flowsIndex,
    /export \{[\s\S]*?revealMnemonic[\s\S]*?\} from '\.\/revealMnemonic\.js'/,
    'flows/index re-exports revealMnemonic',
);
assert.match(
    flowsIndex,
    /NoMnemonicForWifOnlyError/,
    'flows/index re-exports the error',
);

console.log('reveal-mnemonic smoke OK');
