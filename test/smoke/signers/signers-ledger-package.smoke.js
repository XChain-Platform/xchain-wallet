// §9 / G002 smoke — `@xchain-wallet/signers-ledger` standalone package.
//
// Mirrors signers-trezor-package.smoke.js. Asserts:
//   1. packages/signers-ledger/ exists with a workspace package.json
//      (name, type=module, main, exports map, @noble/hashes dep).
//   2. LedgerSigner.js + ledgerFormat.js live INSIDE the new package
//      and have been REMOVED from packages/core/src/signers/.
//   3. LedgerSigner.js reaches the shared Signer base via a relative
//      cross-package path.
//   4. core/src/signers/index.js still exports LedgerSigner — back-compat
//      re-export — pointed at the new location via relative path.
//   5. The new package's `src/index.js` re-exports the canonical surface.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ledgerPkg = join(wsRoot, 'packages', 'signers-ledger');
const core = join(wsRoot, 'packages', 'core');

// --- 1. Workspace package layout --------------------------------------

assert.ok(existsSync(ledgerPkg), 'packages/signers-ledger/ exists');
const pkgJsonPath = join(ledgerPkg, 'package.json');
assert.ok(existsSync(pkgJsonPath), 'packages/signers-ledger/package.json exists');
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
assert.equal(pkg.name, '@xchain-wallet/signers-ledger', 'package name');
assert.equal(pkg.type, 'module', 'package is ESM');
assert.equal(pkg.main, './src/index.js', 'package main entry');
assert.deepEqual(
    pkg.exports,
    {
        '.': './src/index.js',
        './LedgerSigner.js': './src/LedgerSigner.js',
        './ledgerFormat.js': './src/ledgerFormat.js',
    },
    'exports map covers entry + the two impl files',
);
assert.equal(pkg.private, true, 'workspace package is private');
assert.ok(pkg.dependencies?.['@noble/hashes'],
    '@noble/hashes is declared as a runtime dep (sha256 used by deriveLedgerDeviceIdentifier)');

// --- 2. Files moved out of core ---------------------------------------

assert.ok(
    existsSync(join(ledgerPkg, 'src', 'LedgerSigner.js')),
    'LedgerSigner.js lives in the new package',
);
assert.ok(
    existsSync(join(ledgerPkg, 'src', 'ledgerFormat.js')),
    'ledgerFormat.js lives in the new package',
);
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'LedgerSigner.js')),
    'LedgerSigner.js no longer in @xchain-wallet/core',
);
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'ledgerFormat.js')),
    'ledgerFormat.js no longer in @xchain-wallet/core',
);

// --- 3. Cross-package Signer import via relative path -----------------

const ledgerSrc = readFileSync(join(ledgerPkg, 'src', 'LedgerSigner.js'), 'utf8');
assert.ok(
    /from\s+['"]\.\.\/\.\.\/core\/src\/signers\/Signer\.js['"]/.test(ledgerSrc),
    'LedgerSigner imports the Signer base via ../../core/src/signers/Signer.js',
);
assert.ok(
    !/^\s*import\b[^;]*['"]@xchain-wallet\/core/m.test(ledgerSrc),
    'LedgerSigner has no runtime import via the workspace specifier (smokes resolve sans pnpm symlinks)',
);

// --- 4. core back-compat re-export -----------------------------------

const coreSignersIndex = readFileSync(join(core, 'src', 'signers', 'index.js'), 'utf8');
assert.ok(
    /from\s+['"]\.\.\/\.\.\/\.\.\/signers-ledger\/src\/LedgerSigner\.js['"]/.test(coreSignersIndex),
    'core/src/signers/index.js re-exports LedgerSigner from the new package via relative path',
);
for (const sym of [
    'LedgerSigner',
    'deriveLedgerDeviceIdentifier',
    'modelFromLedgerTransport',
]) {
    assert.ok(
        new RegExp(`\\b${sym}\\b`).test(coreSignersIndex),
        `core back-compat shim still surfaces ${sym}`,
    );
}

// --- 5. New package canonical entry -----------------------------------

const newIndex = readFileSync(join(ledgerPkg, 'src', 'index.js'), 'utf8');
for (const sym of [
    'LedgerSigner',
    'deriveLedgerDeviceIdentifier',
    'modelFromLedgerTransport',
    'chainIdToLedgerCurrency',
    'toLedgerCreatePayment',
    'composeBitcoinCompactSignature',
]) {
    assert.ok(
        new RegExp(`\\b${sym}\\b`).test(newIndex),
        `signers-ledger canonical index re-exports ${sym}`,
    );
}

console.log(
    'OK — signers-ledger package smoke (§9 / G002 standalone workspace package; LedgerSigner.js + ledgerFormat.js moved out of core; cross-package Signer import via relative path; @noble/hashes declared as a runtime dep; core back-compat re-export; canonical entry exposes LedgerSigner + helpers + ledgerFormat builders)',
);
