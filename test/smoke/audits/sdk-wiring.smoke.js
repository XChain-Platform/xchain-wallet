// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke test for Batch 5 piece 19 (real SDK wiring).
//
// The real `xchain-sdk` isn't installable without pnpm, so this smoke
// exercises the fallback path deterministically:
//
//   - Both shells expose a `resolveSdkFactory` that tries to load
//     `xchain-sdk` via dynamic import + `adaptXChainSDK`.
//   - When the package isn't resolvable, the resolver falls back to a
//     dev-mock factory and emits a single console.warn so the state
//     is visibly cheap to spot.
//   - hostBridge (web) + background (extension) each export an
//     `sdkResolved` promise that settles with `'real'` or `'dev-mock'`
//     so callers can gate sign / broadcast work on real availability.
//   - package.json declares xchain-sdk as a runtime dep on both shells.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

// --- 1. Static surface ------------------------------------------------

const webFactory = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'sdkFactory.js'),
    'utf8',
);
assert.ok(
    /adaptXChainSDK/.test(webFactory),
    'web sdkFactory wraps via adaptXChainSDK',
);
assert.ok(
    /import\('xchain-sdk'\)/.test(webFactory),
    'web sdkFactory dynamic-imports xchain-sdk',
);
assert.ok(
    /console\.warn/.test(webFactory),
    'web sdkFactory warns on fallback',
);

const extFactory = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'sdkFactory.js'),
    'utf8',
);
assert.ok(
    /adaptXChainSDK/.test(extFactory),
    'extension sdkFactory wraps via adaptXChainSDK',
);
assert.ok(
    /import\('xchain-sdk'\)/.test(extFactory),
    'extension sdkFactory dynamic-imports xchain-sdk',
);
assert.ok(
    /export function createDevMockSdk/.test(extFactory),
    'extension sdkFactory exports createDevMockSdk for the background to use as fallback',
);

const hostBridge = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'hostBridge.js'),
    'utf8',
);
assert.ok(
    /export const sdkResolved/.test(hostBridge),
    'hostBridge exports sdkResolved promise',
);
assert.ok(
    /resolveSdkFactory\(\{ devMockFactory: createDevMockSdk \}\)/.test(hostBridge),
    'hostBridge wires dev mock as the resolver fallback',
);

const background = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background.js'),
    'utf8',
);
assert.ok(
    /export const sdkResolved/.test(background),
    'background.js exports sdkResolved promise',
);
assert.ok(
    /resolveSdkFactory\(\{ devMockFactory: createDevMockSdk \}\)/.test(background),
    'background wires dev mock as the resolver fallback',
);

// --- 2. Runtime xchain-sdk dep declarations -------------------------

const webPkg = JSON.parse(
    readFileSync(join(wsRoot, 'packages', 'web', 'package.json'), 'utf8'),
);
const extPkg = JSON.parse(
    readFileSync(join(wsRoot, 'packages', 'extension', 'package.json'), 'utf8'),
);
assert.ok(webPkg.dependencies?.['xchain-sdk'], 'web depends on xchain-sdk');
assert.ok(extPkg.dependencies?.['xchain-sdk'], 'extension depends on xchain-sdk');

// --- 3. resolveSdkFactory fallback behaviour -------------------------

// Load the web resolver directly. xchain-sdk isn't installed under the
// Node test harness, so the import fails and we should land on the dev
// mock. Capture the console.warn to verify the diagnostic hint fires.
const { resolveSdkFactory } = await import(
    '../../../packages/web/src/sdkFactory.js'
);
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

const devMock = () => ({ wallet: {}, auth: {} });
try {
    const resultA = await resolveSdkFactory({ devMockFactory: devMock });
    assert.equal(resultA.source, 'dev-mock');
    assert.equal(resultA.factory, devMock, 'returns the same devMock reference');

    // Second call: warn should NOT fire again (single-shot diagnostic).
    const warnCountAfterA = warnings.length;
    const resultB = await resolveSdkFactory({ devMockFactory: devMock });
    assert.equal(resultB.source, 'dev-mock');
    assert.equal(
        warnings.length,
        warnCountAfterA,
        'warn fires once across repeated fallbacks',
    );
} finally {
    console.warn = originalWarn;
}

assert.ok(
    warnings.some((w) => /xchain-sdk unavailable/.test(w)),
    'fallback warning mentions xchain-sdk unavailable',
);

// --- 4. Safety guard on missing devMockFactory ----------------------

let threw = false;
try {
    await resolveSdkFactory({});
} catch (err) {
    threw = true;
    assert.match(err.message, /devMockFactory is required/);
}
assert.ok(threw, 'resolveSdkFactory rejects when no devMockFactory passed');

console.log(
    'OK — sdk wiring smoke (web + extension factories, hostBridge + background sdkResolved, fallback warn once, dep declared)',
);
