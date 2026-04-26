// Smoke for Piece 1b — real xchain-sdk browser-bundle pass.
//
// Asserts the static bits a browser bundle of xchain-sdk needs to
// resolve cleanly:
//
//   1. The `ws` browser shim exists at packages/core/src/shims/
//      ws-browser.js with the surface xchain-sdk's websocket.js
//      consumes (.on / .send / .close / readyState + WebSocket.OPEN
//      constant).
//   2. Both shell Vite configs import vite-plugin-node-polyfills and
//      resolve `ws` through the shim via resolve.alias.
//   3. Both shells declare xchain-sdk as a runtime dep (pinned major)
//      and vite-plugin-node-polyfills as a devDep.
//   4. Both sdkFactory.js files still dynamic-import xchain-sdk and
//      wrap it with adaptXChainSDK.
//   5. The core exports map surfaces shims via `./shims/*`.
//
// The full "does it actually build" check is `pnpm -C packages/web
// build && pnpm -C packages/extension build` + running
// `tools/build-reproduce/check-no-dev-mock.sh` against dist/ — those
// gates run in CI and before a release, not in this smoke.

import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const web = join(wsRoot, 'packages', 'web');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. The ws shim --------------------------------------------------

const shimPath = join(core, 'src', 'shims', 'ws-browser.js');
assert.ok(existsSync(shimPath), 'ws-browser.js shim exists');

const shim = readFileSync(shimPath, 'utf8');
for (const member of [
    'export default',       // default export for `require('ws')`
    'export { BrowserWsShim as WebSocket }',  // named for `{ WebSocket }`
    "_handlers = {",        // event registry
    "'open'",
    "'message'",
    "'close'",
    "'error'",
    'send(',
    'close(',
    'get readyState',
]) {
    assert.ok(
        shim.includes(member),
        `ws-browser shim implements ${member}`,
    );
}
for (const constant of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
    assert.ok(
        new RegExp(`BrowserWsShim\\.${constant}\\s*=`).test(shim),
        `ws-browser shim exposes static constant ${constant}`,
    );
}
// Shim must not pull Node built-ins — if it did, we'd still need the
// polyfills to load it. The shim's whole job is to stay browser-pure.
// Look only at non-comment lines so the JSDoc example at the top of
// the shim (which cites `require('ws')` as the consumer call site)
// doesn't trip the check.
const shimCodeOnly = shim
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
    .join('\n');
for (const forbidden of ["require('ws')", "require('net')", "require('tls')"]) {
    assert.ok(
        !shimCodeOnly.includes(forbidden),
        `ws-browser shim does NOT re-import ${forbidden}`,
    );
}

// --- 2. http + repl shims exist too ---------------------------------

for (const [name, members] of [
    ['http-browser.js', ['class Agent', 'export { Agent }']],
    ['repl-browser.js', ['function start', 'export { start }']],
]) {
    const path = join(core, 'src', 'shims', name);
    assert.ok(existsSync(path), `${name} shim exists`);
    const src = readFileSync(path, 'utf8');
    for (const m of members) {
        assert.ok(src.includes(m), `${name} includes "${m}"`);
    }
}

// --- 3. Both Vite configs wire the shims + node polyfills ------------

for (const [shell, viteConfigPath, pkgPath] of [
    ['web', join(web, 'vite.config.js'), join(web, 'package.json')],
    ['extension', join(ext, 'vite.config.js'), join(ext, 'package.json')],
]) {
    const cfg = readFileSync(viteConfigPath, 'utf8');
    assert.ok(
        cfg.includes('vite-plugin-node-polyfills'),
        `${shell} vite.config imports vite-plugin-node-polyfills`,
    );
    assert.ok(
        /nodePolyfills\s*\(/.test(cfg),
        `${shell} vite.config calls nodePolyfills()`,
    );
    for (const mod of ['buffer', 'crypto', 'process']) {
        assert.ok(
            cfg.includes(`'${mod}'`),
            `${shell} vite.config polyfills ${mod}`,
        );
    }
    assert.ok(
        /Buffer:\s*true/.test(cfg),
        `${shell} vite.config installs global Buffer`,
    );
    for (const [mod, shim] of [
        ['ws', 'ws-browser.js'],
        ['http', 'http-browser.js'],
        ['repl', 'repl-browser.js'],
    ]) {
        assert.ok(
            new RegExp(`\\b${mod}:\\s*${mod}BrowserShim`).test(cfg),
            `${shell} vite.config aliases ${mod} -> ${mod}BrowserShim`,
        );
        assert.ok(
            cfg.includes(`src/shims/${shim}`),
            `${shell} vite.config references ${shim}`,
        );
    }

    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.match(
        pkg.dependencies?.['xchain-sdk'] || '',
        /^\^1\.(?:1[1-9]|[2-9]\d)\.0$/,
        `${shell} pins xchain-sdk ≥ ^1.11.0 (Phase 4 Step 18 baseline)`,
    );
    assert.match(
        pkg.devDependencies?.['vite-plugin-node-polyfills'] || '',
        /^\^0\.\d+/,
        `${shell} declares vite-plugin-node-polyfills devDep`,
    );
}

// --- 4. sdkFactory.js still dynamic-imports xchain-sdk --------------

for (const [shell, path] of [
    ['web', join(web, 'src', 'sdkFactory.js')],
    ['extension', join(ext, 'src', 'background', 'sdkFactory.js')],
]) {
    const src = readFileSync(path, 'utf8');
    assert.ok(
        /await import\(['"]xchain-sdk['"]\)/.test(src),
        `${shell} sdkFactory dynamic-imports xchain-sdk`,
    );
    assert.ok(
        /adaptXChainSDK/.test(src),
        `${shell} sdkFactory wraps with adaptXChainSDK`,
    );
    assert.ok(
        src.includes("'dev-mock'"),
        `${shell} sdkFactory returns a 'dev-mock' source string on fallback`,
    );
    assert.ok(
        /falling back to dev-mock SDK/.test(src),
        `${shell} sdkFactory emits the console.warn the release gate greps for`,
    );
}

// --- 5. core exports map surfaces shims -----------------------------

const corePkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
assert.equal(
    corePkg.exports['./shims/*'],
    './src/shims/*',
    'core exports "./shims/*" so shells can reach the ws shim',
);

// --- 6. check-no-dev-mock.sh still names the fallback markers -------

const gate = readFileSync(
    join(wsRoot, 'tools', 'build-reproduce', 'check-no-dev-mock.sh'),
    'utf8',
);
for (const marker of [
    'xchain-sdk unavailable',
    'falling back to dev-mock SDK',
    'DO NOT USE FOR MAINNET',
]) {
    assert.ok(
        gate.includes(marker),
        `check-no-dev-mock.sh greps for "${marker}"`,
    );
}

console.log(
    'OK — sdk-bundle smoke (ws shim, polyfills wired in both Vite configs, '
        + 'xchain-sdk pinned, sdkFactory wiring intact, release gate unchanged)',
);
