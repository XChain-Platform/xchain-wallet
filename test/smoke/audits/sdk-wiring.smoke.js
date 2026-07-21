// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
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

// Load the web resolver directly. `xchain-sdk` is linked into the
// monorepo (package.json `link:../../../xchain-sdk`), so under the Node
// harness the resolver's `import('xchain-sdk')` may now succeed and
// return the real factory. (A bare probe here would resolve from a
// different module context, so branch on the resolver's actual result.)
// Either way the resolver must behave consistently: the real factory
// when xchain-sdk loads, or the dev-mock fallback + one-shot warn.
const { resolveSdkFactory } = await import(
    '../../../packages/web/src/sdkFactory.js'
);
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

const devMock = () => ({ wallet: {}, auth: {} });
try {
    const resultA = await resolveSdkFactory({ devMockFactory: devMock });
    if (resultA.source === 'real') {
        assert.notEqual(resultA.factory, devMock, 'real factory is not the dev mock');
        assert.ok(typeof resultA.factory === 'function', 'real source yields a factory');
    } else {
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
        assert.ok(
            warnings.some((w) => /xchain-sdk unavailable/.test(w)),
            'fallback warning mentions xchain-sdk unavailable',
        );
    }
} finally {
    console.warn = originalWarn;
}

// --- 4. Safety guard on missing devMockFactory ----------------------

let threw = false;
try {
    await resolveSdkFactory({});
} catch (err) {
    threw = true;
    assert.match(err.message, /devMockFactory is required/);
}
assert.ok(threw, 'resolveSdkFactory rejects when no devMockFactory passed');

// --- 5. /556/557 production-safety invariants -------------------

// : the dev-mock implementations must be gated on import.meta.env
// PROD so a production build dead-code-eliminates them; otherwise
// check-no-dev-mock.sh's implementation grep is a false green.
assert.ok(
    /createDevMockSdk = import\.meta\.env\?\.PROD \? null :/.test(hostBridge),
    'hostBridge PROD-gates createDevMockSdk for dead-code elimination',
);
assert.ok(
    /createDevMockSdk = import\.meta\.env\?\.PROD \? null : createDevMockSdkImpl/.test(background),
    'background PROD-gates createDevMockSdk for dead-code elimination',
);

// : sdkResolved must NOT swallow the production refusal thrown by
// resolveSdkFactory; the old `.catch(() => 'dev-mock')` left the registry
// silently on the mock. The catch must re-throw under PROD.
for (const [name, src] of [['hostBridge', hostBridge], ['background', background]]) {
    // Comment lines may cite the old pattern; test code lines only.
    const codeOnly = src
        .split('\n')
        .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
        .join('\n');
    assert.ok(
        !/\.catch\(\(\)\s*=>\s*'dev-mock'\)/.test(codeOnly),
        `${name} no longer discards SDK-resolution failures outright`,
    );
    assert.ok(
        /SDK resolution failed/.test(src) && /throw err;/.test(src),
        `${name} re-throws the production SDK-resolution refusal`,
    );
    // Both shells boot the registry off a throwing placeholder in PROD
    // (where the mock does not exist) rather than crashing on null.
    assert.ok(
        /createDevMockSdk \?\? createLoadingSdk/.test(src),
        `${name} falls back to the throwing loading-surface factory in PROD`,
    );
}

// : the release gate must grep for the mock IMPLEMENTATION, not just
// the fallback warning strings, and  positively require SDK-unique
// literals so "SDK failed to bundle at all" cannot pass either.
const gate = readFileSync(
    join(wsRoot, 'tools', 'build-reproduce', 'check-no-dev-mock.sh'),
    'utf8',
);
for (const marker of ['Dev SDK stub', 'devmockpsbt', 'CONTRACT_LINT_FAILED', 'ENCODER_NOT_CONFIGURED']) {
    assert.ok(
        gate.includes(`"${marker}"`),
        `check-no-dev-mock.sh checks marker: ${marker}`,
    );
}

// : both shell Vite configs must give the link:-resolved SDK the CJS
// transform (commonjsOptions.include) and resolve the polyfill shim +
// SDK-repl specifiers the transform surfaces.
for (const shell of ['web', 'extension']) {
    const cfg = readFileSync(
        join(wsRoot, 'packages', shell, 'vite.config.js'),
        'utf8',
    );
    assert.ok(
        /commonjsOptions:\s*\{[^}]*include:\s*\[\/node_modules\/,\s*\/xchain-sdk\/\]/.test(cfg),
        `${shell} vite config includes xchain-sdk in the commonjs transform`,
    );
    assert.ok(
        cfg.includes("vite-plugin-node-polyfills/shims/"),
        `${shell} vite config resolves the bare polyfill-shim specifiers`,
    );
    assert.ok(
        /repl\\\.js\$/.test(cfg),
        `${shell} vite config routes xchain-sdk's repl.js to the browser shim`,
    );
}

console.log(
    'OK: sdk wiring smoke (web + extension factories, hostBridge + background sdkResolved, fallback warn once, dep declared, PROD refuses dev-mock: DCE gate + loud catch + commonjs transform of linked SDK)',
);
