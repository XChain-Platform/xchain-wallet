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
//   - : WHICH SDK runs is read off the environment before anything is
//     imported. Dev/test run the dev-mock factory (one console.warn, naming
//     the opt-in flag); production, and dev with VITE_XCHAIN_REAL_SDK=1, run
//     the real one and REFUSE to substitute the mock if it fails to load.
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
    'web sdkFactory warns when it serves the dev mock',
);
// : the venue must be decided from the environment BEFORE anything is
// imported. It used to be decided by catching the import failure, so the day
// Vite learned to pre-bundle the linked CJS SDK the dev shell silently moved
// to the real SDK (against unreachable mainnet explorers) and five e2e specs
// went red. A catch block must never hand back the mock again.
assert.ok(
    /export function selectSdkVenue/.test(webFactory),
    'web sdkFactory selects its venue from the environment ',
);
const webCatchBody = webFactory.slice(webFactory.indexOf('} catch (err) {'));
assert.ok(
    webCatchBody.length > 0 && !/devMockFactory/.test(webCatchBody),
    'web sdkFactory never resolves to the dev mock from a catch branch ',
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

// --- 3. resolveSdkFactory venue selection  --------------------

// The resolver runs whichever SDK the ENVIRONMENT names, and the SDK import
// is injectable here so the two venues can be exercised without an installed
// xchain-sdk (and so "did it even try to import?" is observable).
const { resolveSdkFactory, selectSdkVenue, REAL_SDK_ENV_FLAG } = await import(
    '../../../packages/web/src/sdkFactory.js'
);

assert.equal(REAL_SDK_ENV_FLAG, 'VITE_XCHAIN_REAL_SDK');
assert.equal(selectSdkVenue({ PROD: true }), 'real', 'a production build always runs the real SDK');
assert.equal(selectSdkVenue({ PROD: false }), 'dev-mock', 'dev defaults to the mock');
assert.equal(
    selectSdkVenue({ PROD: false, [REAL_SDK_ENV_FLAG]: '1' }),
    'real',
    `${REAL_SDK_ENV_FLAG}=1 opts dev into the real SDK`,
);
assert.equal(
    selectSdkVenue({ PROD: true, [REAL_SDK_ENV_FLAG]: '0' }),
    'real',
    'the dev flag cannot talk a production build into the mock',
);

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args.join(' ')); };

const devMock = () => ({ wallet: {}, auth: {} });
let importAttempts = 0;
const importSdk = async () => {
    importAttempts += 1;
    return { XChainSDK: class FakeXChainSDK {} };
};
try {
    // dev-mock venue: the mock is handed back WITHOUT touching xchain-sdk, so
    // no change in how (or how well) the SDK bundles can move the venue.
    const resultA = await resolveSdkFactory({
        devMockFactory: devMock, venue: 'dev-mock', importSdk,
    });
    assert.equal(resultA.source, 'dev-mock');
    assert.equal(resultA.factory, devMock, 'returns the same devMock reference');
    assert.equal(
        importAttempts,
        0,
        'the dev-mock venue never imports xchain-sdk (the venue is chosen, not caught)',
    );

    // Second call: warn should NOT fire again (single-shot diagnostic).
    const warnCountAfterA = warnings.length;
    const resultB = await resolveSdkFactory({
        devMockFactory: devMock, venue: 'dev-mock', importSdk,
    });
    assert.equal(resultB.source, 'dev-mock');
    assert.equal(warnings.length, warnCountAfterA, 'warn fires once across repeated calls');
    assert.ok(
        warnings.some((w) => /dev-mock SDK selected/.test(w)),
        'the dev-mock warning says the mock was selected, and names the flag that turns it off',
    );
    assert.ok(
        warnings.some((w) => w.includes(REAL_SDK_ENV_FLAG)),
        'the dev-mock warning names the opt-in flag',
    );

    // real venue: the injected import is used and adapted.
    const resultReal = await resolveSdkFactory({
        devMockFactory: devMock, venue: 'real', importSdk,
    });
    assert.equal(resultReal.source, 'real');
    assert.equal(importAttempts, 1, 'the real venue imports the SDK exactly once per call');
    assert.notEqual(resultReal.factory, devMock, 'real factory is not the dev mock');
    assert.equal(typeof resultReal.factory, 'function', 'real source yields a factory');
} finally {
    console.warn = originalWarn;
}

// A failed load on the REAL venue is a hard failure in every build. Falling
// back here is what made the venue an accident: whoever asked for the real SDK
// would silently get fabricated balances that cannot sign.
let refused = false;
try {
    await resolveSdkFactory({
        devMockFactory: devMock,
        venue: 'real',
        importSdk: async () => { throw new Error('bundle broke'); },
    });
} catch (err) {
    refused = true;
    assert.match(err.message, /refusing to fall back to the dev-mock SDK/);
    assert.match(err.message, /bundle broke/, 'the refusal names the underlying reason');
}
assert.ok(refused, 'a failed real-SDK load rejects instead of returning the mock');

// --- 4. Safety guard on missing devMockFactory ----------------------

let threw = false;
try {
    await resolveSdkFactory({ venue: 'dev-mock' });
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
for (const marker of ['Dev SDK stub', 'devmockpsbt']) {
    assert.ok(
        gate.includes(`"${marker}"`),
        `check-no-dev-mock.sh checks mock-implementation marker: ${marker}`,
    );
}
//  §6: the positive SDK-unique markers moved into a per-target
// table, because the desktop renderer imports xchain-sdk/src/wallet.js
// directly and never pulls in the package index, so the index-only
// literals below are legitimately absent there. Asserted per target
// rather than as bare strings, so the shells that DO route through the
// index cannot quietly lose their positive check.
for (const shell of ['web', 'extension']) {
    const row = gate.split('\n').find((l) => l.includes(`"packages/${shell}/dist|`));
    assert.ok(row, `check-no-dev-mock.sh scans packages/${shell}/dist`);
    for (const marker of ['CONTRACT_LINT_FAILED', 'ENCODER_NOT_CONFIGURED']) {
        assert.ok(row.includes(marker),
            `packages/${shell}/dist requires SDK-unique marker: ${marker}`);
    }
}
const desktopRow = gate.split('\n').find((l) => l.includes('"packages/desktop/renderer/dist|'));
assert.ok(desktopRow, 'check-no-dev-mock.sh scans the desktop renderer bundle');
assert.ok(/SDKWalletError/.test(desktopRow),
    'desktop renderer requires a wallet-module SDK marker (it has no package index)');

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

// : the dev server's pre-bundling must hang off the SAME flag as the
// venue, in BOTH directions. Vite's scanner finds the bare import('xchain-sdk')
// by itself, so without an explicit `exclude` the dev shell acquires a working
// real SDK (aimed at mainnet explorers) whether anyone asked for it or not.
const webCfg = readFileSync(
    join(wsRoot, 'packages', 'web', 'vite.config.js'),
    'utf8',
);
// Asserted on the PACKAGE specifier rather than on the whole array literal,
// because the include list legitimately carries a second entry (below) and the
// invariant  protects is only about `xchain-sdk` itself: pre-bundled when
// the flag is set, explicitly excluded when it is not.
const optimizeDepsBlock = /optimizeDeps:[\s\S]*?,\n    build:/.exec(webCfg)?.[0] || '';
assert.ok(optimizeDepsBlock, 'web vite config has an optimizeDeps block');
const flagOnBranch = /\?\s*\{([\s\S]*?)\}/.exec(optimizeDepsBlock)?.[1] || '';
const flagOffBranch = /:\s*\{([\s\S]*?)\}\s*,\s*$/m.exec(optimizeDepsBlock)?.[1] || '';
assert.ok(flagOnBranch && flagOffBranch, 'web vite config optimizeDeps has both flag branches');
assert.ok(
    /include:\s*\[[^\]]*'xchain-sdk'/.test(flagOnBranch),
    'web vite config pre-bundles the xchain-sdk package when the flag is set',
);
assert.ok(
    /exclude:\s*\[[^\]]*'xchain-sdk'/.test(flagOffBranch),
    'web vite config excludes the xchain-sdk package when the flag is not set',
);
assert.ok(
    !/include:\s*\[[^\]]*'xchain-sdk'\s*[,\]]/.test(flagOffBranch),
    'web vite config never pre-bundles the xchain-sdk PACKAGE off the flag ',
);
assert.ok(
    /VITE_XCHAIN_REAL_SDK/.test(webCfg),
    'web vite config gates SDK pre-bundling on VITE_XCHAIN_REAL_SDK',
);
// D-88 /  (wallet E2E session 19): ledgerFactory.js imports
// `xchain-sdk/src/wallet.js` directly (, keeping the SDK index out of the
// popup graph) and the web shell pulls it in through createBackgroundHost.
// Vite pre-bundles per ENTRY, so naming only the package leaves that CJS file
// served raw over /@fs and it throws `require is not defined` before React
// mounts - a blank page in BOTH flag directions, which is how it survived a
// full day undetected. It carries only WalletUtils, so it is safe on either
// branch and must be on both.
for (const [label, branch] of [['flag-on', flagOnBranch], ['flag-off', flagOffBranch]]) {
    assert.ok(
        /include:\s*\[[^\]]*'xchain-sdk\/src\/wallet\.js'/.test(branch),
        `web vite config pre-bundles the deep xchain-sdk/src/wallet.js entry (${label} branch)`,
    );
}

// The dev-server e2e config states its venue rather than inheriting whatever
// the bundler happens to do that week.
const e2eCfg = readFileSync(
    join(wsRoot, 'test', 'e2e', 'playwright.config.js'),
    'utf8',
);
assert.ok(
    /VITE_XCHAIN_REAL_SDK:\s*'0'/.test(e2eCfg),
    'the dev-server e2e config pins the dev-mock venue explicitly ',
);

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
    'OK: sdk wiring smoke (web + extension factories, hostBridge + background sdkResolved,  venue chosen from the env + warn once + no silent fallback, dep declared, PROD refuses dev-mock: DCE gate + loud catch + commonjs transform of linked SDK,  static worker SDK)',
);
