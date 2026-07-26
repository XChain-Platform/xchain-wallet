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
//   - Both shells expose a `resolveSdkFactory` that produces the real
//     factory via `adaptXChainSDK`. The web shell loads the SDK with a
//     dynamic import (legal in a page); the extension CANNOT (:
//     `import()` is disallowed on ServiceWorkerGlobalScope) and injects a
//     statically imported class instead.
//   - When the package isn't resolvable, the resolver falls back to a
//     dev-mock factory and emits a single console.warn so the state
//     is visibly cheap to spot.
//   - hostBridge (web) + background (extension) each export an
//     `sdkResolved` promise that settles with `'real'` or `'dev-mock'`
//     so callers can gate sign / broadcast work on real availability.
//   - package.json declares xchain-sdk as a runtime dep on both shells.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
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
    /export function createDevMockSdk/.test(extFactory),
    'extension sdkFactory exports createDevMockSdk for the background to use as fallback',
);

// : the extension resolver must NOT load the SDK itself. `import()` is
// disallowed on ServiceWorkerGlobalScope by the HTML specification, so the
// dynamic import that used to live here always rejected in the packaged
// extension and the wallet could not create, sign, or serve data at all.
// The class is injected by background.js from a STATIC import.
const extSdkStatic = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'sdkStatic.js'),
    'utf8',
);
assert.ok(
    /^import \* as sdkModule from 'xchain-sdk';$/m.test(extSdkStatic),
    'extension sdkStatic STATICALLY imports xchain-sdk (import() is illegal in a service worker)',
);
assert.ok(
    /export const XChainSDK/.test(extSdkStatic),
    'extension sdkStatic exports the XChainSDK class',
);
assert.ok(
    !/from '\.\/sdkStatic\.js'/.test(
        readFileSync(
            join(wsRoot, 'packages', 'extension', 'src', 'background', 'index.js'),
            'utf8',
        ),
    ),
    'sdkStatic stays OFF the background barrel, so Node smokes can import sdkFactory.js without an installed SDK',
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
    /resolveSdkFactory\(\{ devMockFactory: createDevMockSdk, XChainSDK \}\)/.test(background),
    'background wires dev mock as the resolver fallback AND injects the statically imported SDK ',
);
assert.ok(
    /^import \{ XChainSDK \} from '\.\/background\/sdkStatic\.js';$/m.test(background),
    'background statically imports the SDK class',
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

// --- 6. : the worker bundle must contain no dynamic import ------

// Behavioural half: an injected class is used verbatim and the dynamic
// import is never attempted. Passing the key as undefined must NOT silently
// fall through to `import()`, or a package-shape change in the extension
// would report itself as the service worker's `import()` rejection instead.
const { resolveSdkFactory: extResolve } = await import(
    '../../../packages/extension/src/background/sdkFactory.js'
);
class FakeSDK {}
const injectedResult = await extResolve({
    devMockFactory: devMock,
    XChainSDK: FakeSDK,
});
assert.equal(injectedResult.source, 'real', 'an injected SDK class yields the real factory');
assert.notEqual(injectedResult.factory, devMock, 'injected path does not return the dev mock');

console.warn = () => {};
const emptyInjection = await extResolve({ devMockFactory: devMock, XChainSDK: undefined });
console.warn = originalWarn;
assert.equal(
    emptyInjection.source,
    'dev-mock',
    'an explicitly empty injection falls back rather than dynamic-importing (the worker cannot)',
);

// Structural half: the BUILT service worker must load every dependency
// statically. This is the artifact-level pin - the source can look right
// while the bundler still emits an `import("./chunks/...")` the worker is
// forbidden to execute, which is exactly how  shipped. Skipped when
// dist/ is absent so the smoke stays runnable without a build.
const bgDist = join(wsRoot, 'packages', 'extension', 'dist', 'background.js');
if (existsSync(bgDist)) {
    const built = readFileSync(bgDist, 'utf8');
    // Block comments carry JSDoc `{import('./x.js').Type}` annotations, which
    // are not executable. The build runs unminified, so every real statement
    // is on its own line and stripping /* */ is enough to tell them apart.
    const code = built.replace(/\/\*[\s\S]*?\*\//g, '');
    const emittedDynamicImport = /(?<![\w."'])import\(\s*["']\.\//.exec(code);
    assert.ok(
        !emittedDynamicImport,
        'built service worker must not dynamic-import a chunk (import() is disallowed on '
        + `ServiceWorkerGlobalScope): found ${emittedDynamicImport?.[0]}`,
    );
    assert.ok(
        /^import [^\n]*from "\.\/chunks\//m.test(built),
        'built service worker still loads its chunks via static imports',
    );
    assert.ok(
        built.includes('CONTRACT_LINT_FAILED') || built.includes('ENCODER_NOT_CONFIGURED'),
        'the real SDK is bundled INTO the worker entry, not behind a chunk it cannot reach',
    );
} else {
    console.log('  (skip: packages/extension/dist not built; worker-bundle checks not run)');
}

console.log(
    'OK: sdk wiring smoke (web + extension factories, hostBridge + background sdkResolved, fallback warn once, dep declared, PROD refuses dev-mock: DCE gate + loud catch + commonjs transform of linked SDK,  static worker SDK)',
);
