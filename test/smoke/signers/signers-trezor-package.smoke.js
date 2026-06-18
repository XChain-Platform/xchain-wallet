// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §9 / G001 smoke: `@xchain-wallet/signers-trezor` standalone package.
//
// Asserts:
//   1. packages/signers-trezor/ exists with a workspace package.json
//      (name, type=module, main, exports map covering the package
//      entry + the two impl files).
//   2. TrezorSigner.js + trezorFormat.js live INSIDE the new package
//      and have been REMOVED from packages/core/src/signers/.
//   3. TrezorSigner.js reaches the shared Signer base via a relative
//      cross-package path (matches the established convention so Node
//      smokes resolve without pnpm workspace symlinks).
//   4. core/src/signers/index.js still exports TrezorSigner (back-compat
//      re-export) pointed at the new location via relative path.
//   5. The new package's `src/index.js` re-exports the canonical surface
//      so `import { TrezorSigner } from '@xchain-wallet/signers-trezor'`
//      is the new canonical path.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const trezorPkg = join(wsRoot, 'packages', 'signers-trezor');
const core = join(wsRoot, 'packages', 'core');

// --- 1. Workspace package layout --------------------------------------

assert.ok(existsSync(trezorPkg), 'packages/signers-trezor/ exists');
const pkgJsonPath = join(trezorPkg, 'package.json');
assert.ok(existsSync(pkgJsonPath), 'packages/signers-trezor/package.json exists');
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
assert.equal(pkg.name, '@xchain-wallet/signers-trezor', 'package name');
assert.equal(pkg.type, 'module', 'package is ESM');
assert.equal(pkg.main, './src/index.js', 'package main entry');
assert.deepEqual(
    pkg.exports,
    {
        '.': './src/index.js',
        './TrezorSigner.js': './src/TrezorSigner.js',
        './trezorFormat.js': './src/trezorFormat.js',
    },
    'exports map covers entry + the two impl files',
);
assert.equal(pkg.private, true, 'workspace package is private');

// --- 2. Files moved out of core ---------------------------------------

assert.ok(
    existsSync(join(trezorPkg, 'src', 'TrezorSigner.js')),
    'TrezorSigner.js lives in the new package',
);
assert.ok(
    existsSync(join(trezorPkg, 'src', 'trezorFormat.js')),
    'trezorFormat.js lives in the new package',
);
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'TrezorSigner.js')),
    'TrezorSigner.js no longer in @xchain-wallet/core',
);
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'trezorFormat.js')),
    'trezorFormat.js no longer in @xchain-wallet/core',
);

// --- 3. Cross-package Signer import via relative path -----------------

const trezorSrc = readFileSync(join(trezorPkg, 'src', 'TrezorSigner.js'), 'utf8');
assert.ok(
    /from\s+['"]\.\.\/\.\.\/core\/src\/signers\/Signer\.js['"]/.test(trezorSrc),
    'TrezorSigner imports the Signer base via ../../core/src/signers/Signer.js',
);
// JSDoc comments may reference `@xchain-wallet/core` for documentation;
// what matters is no runtime `import` resolves through the workspace
// specifier (which would need pnpm symlinks at smoke time).
assert.ok(
    !/^\s*import\b[^;]*['"]@xchain-wallet\/core/m.test(trezorSrc),
    'TrezorSigner has no runtime import via the workspace specifier (smokes resolve sans pnpm symlinks)',
);

// --- 4. core back-compat re-export -----------------------------------

const coreSignersIndex = readFileSync(join(core, 'src', 'signers', 'index.js'), 'utf8');
assert.ok(
    /from\s+['"]\.\.\/\.\.\/\.\.\/signers-trezor\/src\/TrezorSigner\.js['"]/.test(coreSignersIndex),
    'core/src/signers/index.js re-exports TrezorSigner from the new package via relative path',
);
for (const sym of [
    'TrezorSigner',
    'deviceIdentifierFromFeatures',
    'modelFromFeatures',
    'firmwareVersionFromFeatures',
]) {
    assert.ok(
        new RegExp(`\\b${sym}\\b`).test(coreSignersIndex),
        `core back-compat shim still surfaces ${sym}`,
    );
}

// --- 5. New package canonical entry -----------------------------------

const newIndex = readFileSync(join(trezorPkg, 'src', 'index.js'), 'utf8');
for (const sym of [
    'TrezorSigner',
    'deviceIdentifierFromFeatures',
    'chainIdToTrezorCoin',
    'toTrezorSignTransaction',
    'pathToAddressN',
]) {
    assert.ok(
        new RegExp(`\\b${sym}\\b`).test(newIndex),
        `signers-trezor canonical index re-exports ${sym}`,
    );
}

console.log(
    'OK: signers-trezor package smoke (§9 / G001 standalone workspace package; TrezorSigner.js + trezorFormat.js moved out of core; cross-package Signer import via relative path; core back-compat re-export; canonical entry exposes TrezorSigner + deviceIdentifierFromFeatures + format helpers)',
);
