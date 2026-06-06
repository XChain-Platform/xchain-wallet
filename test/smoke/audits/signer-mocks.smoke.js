// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §52 / G162 — Trezor / Ledger signer mocks.
//
// Pins:
//   - test/unit/signers/MockHardwareSigner.js exists, exports
//     MockHardwareSigner + makeMockTrezorSigner + makeMockLedgerSigner.
//   - The mock extends the abstract Signer base so any test using it
//     against `signPsbtFlow` / `submitWithSigner` won't hit
//     AbstractMethodError.
//   - The mock implements the four method-shaped contract points
//     (getStatus / getAddresses / signPsbt / signMessage / getPublicKey)
//     and exposes a `setStatus` helper for driving transitions.
//   - The vitest unit suite at test/unit/signers/MockHardwareSigner.test.js
//     references the mock and uses Vitest's describe / it / expect API.
//
// The unit suite itself runs under `pnpm test:unit` (vitest); this smoke
// only verifies the structural shape so an accidental rename / unexport
// doesn't ship under the radar.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const mockPath = join(wsRoot, 'test', 'unit', 'signers', 'MockHardwareSigner.js');
const testPath = join(wsRoot, 'test', 'unit', 'signers', 'MockHardwareSigner.test.js');

assert.ok(existsSync(mockPath), 'MockHardwareSigner.js exists under test/unit/signers/');
assert.ok(existsSync(testPath), 'MockHardwareSigner.test.js exists under test/unit/signers/');

const mockSrc = readFileSync(mockPath, 'utf8');
const testSrc = readFileSync(testPath, 'utf8');

// ─── 1. Mock surface --------------------------------------------------

assert.match(
    mockSrc,
    /import \{ Signer \} from '\.\.\/\.\.\/\.\.\/packages\/core\/src\/signers\/Signer\.js';/,
    'mock imports Signer base from core',
);
assert.match(mockSrc, /export class MockHardwareSigner extends Signer/, 'extends Signer');
assert.match(mockSrc, /export function makeMockTrezorSigner/, 'exports makeMockTrezorSigner factory');
assert.match(mockSrc, /export function makeMockLedgerSigner/, 'exports makeMockLedgerSigner factory');
// Each abstract method has a non-throwing override.
for (const method of ['getStatus', 'getAddresses', 'signPsbt', 'signMessage', 'getPublicKey']) {
    assert.ok(
        new RegExp(`async ${method}\\(`).test(mockSrc),
        `mock overrides async ${method}`,
    );
}
assert.match(mockSrc, /setStatus\(status, detail\)/, 'mock exposes setStatus for transitions');
assert.match(mockSrc, /this\._emitStatus\(status, detail\)/, 'setStatus emits via base _emitStatus');
assert.match(mockSrc, /this\.calls = \{/, 'mock exposes call counters for assertions');

// ─── 2. Vitest test suite --------------------------------------------

assert.match(
    testSrc,
    /import \{ describe, expect, it, vi \} from 'vitest';/,
    'test suite imports vitest helpers',
);
assert.match(
    testSrc,
    /import \{[\s\S]+?MockHardwareSigner,[\s\S]+?makeMockTrezorSigner,[\s\S]+?makeMockLedgerSigner/,
    'test suite imports the three named exports',
);
assert.match(testSrc, /describe\('MockHardwareSigner'/, 'has a top-level describe block');
// At least one test per public method shape.
for (const fragment of [
    /extends the abstract Signer base/,
    /getStatus returns the configured status/,
    /setStatus drives transitions/,
    /getAddresses synthesizes deterministic rows/,
    /signPsbt returns the canned envelope shape/,
    /signMessage returns canned signature hex/,
    /getPublicKey returns canned triple/,
]) {
    assert.match(testSrc, fragment, `test suite covers ${fragment}`);
}

console.log('signer-mocks smoke OK');
