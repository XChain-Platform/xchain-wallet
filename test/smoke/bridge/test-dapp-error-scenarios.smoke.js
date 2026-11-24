// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §12 / Cluster S FOLLOWUP 5 smoke: test-dapp surfaces BLOCKED_BY_USER
// + THROTTLED branches.
//
// The test-dapp under `packages/test-dapp/` is the developer's reference
// for branching on `result.error`. v0.220.0 added the `BLOCKED_BY_USER`
// + `THROTTLED` codes to bridge-spec; this FOLLOWUP teaches the mock
// provider how to emit them and gives example.ts a copy-pasteable
// branching helper + retry-with-backoff helper.
//
// Asserts:
//   1. mock-provider.ts MockProviderOptions exposes `blockedSite` and
//      `throttle: { retryAfterMs, burst?, windowMs? }`.
//   2. mock-provider.ts has a maybeBlockedOrThrottled helper short-
//      circuiting connect / signMessage / signAction / signPsbt /
//      signIn before any other work.
//   3. example.ts exports `handleSignActionResult` returning a tagged
//      `SignActionUiOutcome` with branches for every BridgeErrorCode
//      the FOLLOWUP names (rejected, walletLocked, panic, unsupported,
//      blocked, throttled, error).
//   4. The throttled branch produces the "Retry in {seconds}s" message
//      and forwards retryAfterMs / burst / windowMs.
//   5. The blocked branch produces a static no-retry message
//      ("Blocked by user" message, no retry surface).
//   6. example.ts exports `signActionWithRetry` that loops on THROTTLED
//      results up to `maxRetries`, sleeping `retryAfterMs` between
//      attempts.
//   7. example.ts exports `runErrorScenarios` walking both branches
//      against MockXChainProvider with the new options.
//   8. index.ts re-exports the new symbols + types.

import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const mock = readFileSync(
    join(wsRoot, 'packages', 'test-dapp', 'src', 'mock-provider.ts'),
    'utf8',
);
const example = readFileSync(
    join(wsRoot, 'packages', 'test-dapp', 'src', 'example.ts'),
    'utf8',
);
const idx = readFileSync(
    join(wsRoot, 'packages', 'test-dapp', 'src', 'index.ts'),
    'utf8',
);
const page = readFileSync(
    join(wsRoot, 'packages', 'test-dapp', 'public', 'index.html'),
    'utf8',
);
const {
    createCallbackStore,
    createTestDappServer,
} = await import('../../../packages/test-dapp/server.js');

async function executeServedModuleGraph(entryUrl) {
    const entry = JSON.stringify(entryUrl);
    const evaluator = `
        import { SourceTextModule } from 'node:vm';

        const entryUrl = new URL(${entry});
        const modules = new Map();

        async function load(url) {
            if (modules.has(url)) return modules.get(url);
            const response = await fetch(url);
            if (!response.ok) throw new Error(\`\${url} returned HTTP \${response.status}\`);
            if (!/^text\\/javascript(?:;|$)/.test(response.headers.get('content-type') ?? '')) {
                throw new Error(\`\${url} was not served as JavaScript\`);
            }
            const module = new SourceTextModule(await response.text(), { identifier: url });
            modules.set(url, module);
            return module;
        }

        const root = await load(entryUrl.href);
        await root.link(async (specifier, referencingModule) => {
            const dependency = new URL(specifier, referencingModule.identifier);
            if (dependency.origin !== entryUrl.origin) {
                throw new Error(\`cross-origin module import: \${dependency.href}\`);
            }
            return load(dependency.href);
        });
        await root.evaluate();
        process.stdout.write(JSON.stringify(Array.from(modules.keys()).sort()));
    `;
    const child = spawn(process.execPath, [
        '--no-warnings',
        '--experimental-vm-modules',
        '--input-type=module',
        '--eval',
        evaluator,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
    });
    assert.equal(code, 0, Buffer.concat(stderr).toString('utf8'));
    return JSON.parse(Buffer.concat(stdout).toString('utf8'));
}

// --- 1. Mock provider options ------------------------------------------

assert.ok(/blockedSite\?:\s*boolean/.test(mock), 'MockProviderOptions.blockedSite');
assert.ok(
    /throttle\?:\s*\{\s*retryAfterMs:\s*number;\s*burst\?:\s*number;\s*windowMs\?:\s*number\s*\}/.test(mock),
    'MockProviderOptions.throttle shape',
);
assert.ok(
    /blockedSite:\s*opts\.blockedSite\s*\?\?\s*false/.test(mock),
    'constructor defaults blockedSite to false',
);
assert.ok(
    /throttle:\s*opts\.throttle\s*\?\?\s*null/.test(mock),
    'constructor defaults throttle to null',
);

// --- 2. Short-circuit helper threaded through every sign* path --------

assert.ok(/maybeBlockedOrThrottled/.test(mock), 'helper present');
assert.ok(
    /BLOCKED_BY_USER[\s\S]*THROTTLED/.test(mock),
    'helper covers both error codes',
);
const sites = [
    'async connect',
    'async signMessage',
    'async signAction',
    'async signPsbt',
    'async signIn',
];
for (const site of sites) {
    const re = new RegExp(`${site}[\\s\\S]{0,300}?maybeBlockedOrThrottled`);
    assert.ok(re.test(mock), `${site} short-circuits via maybeBlockedOrThrottled`);
}

// --- 3. handleSignActionResult export + every branch ------------------

assert.ok(/export function handleSignActionResult/.test(example),
    'handleSignActionResult exported');
for (const branch of [
    "case 'USER_REJECTED'",
    "case 'WALLET_LOCKED'",
    "case 'PANIC_MODE'",
    "case 'UNSUPPORTED_ACTION'",
    "case 'BLOCKED_BY_USER'",
    "case 'THROTTLED'",
]) {
    assert.ok(
        example.includes(branch),
        `handleSignActionResult branches on ${branch}`,
    );
}
assert.ok(/SignActionUiOutcome/.test(example),
    'tagged outcome type declared');

// --- 4. Throttled branch produces the "Retry in {seconds}s" message ---

assert.ok(
    /Math\.ceil\(retryAfterMs \/ 1000\)/.test(example),
    'seconds rounded up via Math.ceil',
);
assert.ok(
    /retry in \$\{seconds\}s/i.test(example),
    'throttled message includes "retry in {seconds}s"',
);
assert.ok(
    /typeof err\.burst === 'number'[\s\S]*?out\.burst = err\.burst/.test(example),
    'burst forwarded when present',
);
assert.ok(
    /typeof err\.windowMs === 'number'[\s\S]*?out\.windowMs = err\.windowMs/.test(example),
    'windowMs forwarded when present',
);

// --- 5. Blocked branch is static, no retry surface --------------------

assert.ok(
    /Blocked by user[\s\S]{1,10}un-block in wallet Settings/.test(example),
    'blocked message present',
);

// --- 6. signActionWithRetry helper ------------------------------------

assert.ok(/export async function signActionWithRetry/.test(example),
    'signActionWithRetry exported');
assert.ok(/maxRetries/.test(example), 'helper accepts maxRetries');
assert.ok(/sleep/.test(example), 'helper accepts a sleep injection');
assert.ok(
    /err\.error !== 'THROTTLED'/.test(example),
    'helper only retries on THROTTLED',
);
assert.ok(
    /err\.retryAfterMs/.test(example),
    'helper waits err.retryAfterMs between attempts',
);

// --- 7. runErrorScenarios walks both branches -------------------------

assert.ok(/export async function runErrorScenarios/.test(example));
assert.ok(/blockedSite:\s*true/.test(example),
    'runErrorScenarios constructs a blocked mock');
assert.ok(
    /throttle:\s*\{\s*retryAfterMs:\s*5/.test(example),
    'runErrorScenarios constructs a throttled mock',
);
assert.ok(/ErrorScenarioReport/.test(example),
    'report type declared');

// --- 8. index.ts re-exports ------------------------------------------

// --- 9. descriptor protocol set vs wallet signable set ----------------
//
// The live bridge keeps two contracts apart: ChainDescriptor.supportedActions
// is the registry's PROTOCOL set (handlers.js getSupportedChains passes it
// through verbatim) while signAction refuses anything outside the much
// smaller SIGNABLE set (SUPPORTED_BRIDGE_ACTIONS). A reference mock that puts
// the signable pair into the descriptor teaches integrators that
// descriptor.supportedActions == "actions this wallet signs". Pin the split,
// and pin the literal protocol list to the core registry so it cannot drift.

function literalList(name) {
    const m = mock.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
    assert.ok(m, `mock-provider.ts declares ${name}`);
    return Array.from(m[1].matchAll(/'([A-Z_]+)'/g), (x) => x[1]);
}
const protocolSet = literalList('DEFAULT_PROTOCOL_ACTIONS');
const signableSet = literalList('DEFAULT_SIGNABLE_ACTIONS');
assert.deepEqual(signableSet, ['SEND', 'SWEEP'], 'signable default is the bridge pair');
for (const a of signableSet) {
    assert.ok(protocolSet.includes(a), `signable action ${a} is inside the protocol set`);
}
assert.ok(protocolSet.length > signableSet.length,
    'descriptor protocol set is a strict superset of the signable set');
assert.ok(
    /supportedActions:\s*\[\.\.\.DEFAULT_PROTOCOL_ACTIONS\]/.test(mock),
    'DEFAULT_CHAIN advertises the protocol set, not the signable set',
);
assert.ok(
    /supportedActions:\s*opts\.supportedActions\s*\?\?\s*\[\.\.\.DEFAULT_SIGNABLE_ACTIONS\]/.test(mock),
    'signAction defaults to the signable set',
);
const { BITCOIN_ACTIONS } = await import(
    '../../../packages/core/src/registry/actions.js'
);
assert.deepEqual(
    protocolSet.slice().sort(),
    BITCOIN_ACTIONS.slice().sort(),
    'mock protocol set mirrors core registry BITCOIN_ACTIONS (update the literal when actions.js changes)',
);

for (const symbol of [
    'runErrorScenarios',
    'handleSignActionResult',
    'signActionWithRetry',
    'ErrorScenarioReport',
    'SignActionUiOutcome',
]) {
    assert.ok(
        idx.includes(symbol),
        `index.ts re-exports ${symbol}`,
    );
}

assert.match(page, /createClient/);
assert.match(page, /data-method="login"/);
assert.match(page, /data-method="signMessage"/);
assert.match(page, /data-method="signAction"/);
assert.match(page, /data-method="signPsbt"/);
assert.match(page, /\/callback/);
assert.match(page, /\/claim\/\$\{envelope\.id\}/);

const store = createCallbackStore();
const callbackCalls = [];
const auth = {
    async receiveCallback(body, options) {
        callbackCalls.push({ body, options });
        const nonce = body.result.challenge.split(':').at(-1);
        const issued = options.store.takeNonce(nonce);
        if (!issued) {
            return { accepted: false, id: body.id, status: 'rejected', error: 'bad nonce' };
        }
        const claimed = body.claim === undefined && issued.mode === 'cross-device';
        const record = {
            body,
            verified: { address: body.result.address },
            nonceMode: issued.mode,
            claim: body.claim ?? null,
            claimed,
            status: claimed ? 'approved' : 'approved-unclaimed',
        };
        options.store.put(body.id, record);
        return {
            accepted: true,
            id: body.id,
            status: record.status,
            claimed,
            verified: record.verified,
        };
    },
};
const server = createTestDappServer({ auth, store });
await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});

try {
    const address = server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const post = (path, body) => fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

    const rootResponse = await fetch(`${base}/`);
    assert.equal(rootResponse.status, 200);
    assert.match(rootResponse.headers.get('content-type'), /^text\/html/);
    assert.match(await rootResponse.text(), /XChain test dApp/);

    const servedModules = await executeServedModuleGraph(`${base}/connect/client.js`);
    assert.deepEqual(servedModules.map((url) => new URL(url).pathname), [
        '/connect/chooserPick.js',
        '/connect/client.js',
        '/connect/pendingStore.js',
        '/connect/qr.js',
        '/connect/request.js',
        '/connect/transportPick.js',
    ]);

    const traversalResponse = await fetch(`${base}/connect/%252e%252e/server.js`);
    assert.equal(traversalResponse.status, 404);

    const nonceResponse = await post('/nonce', { mode: 'same-device' });
    assert.equal(nonceResponse.status, 201);
    const { nonce } = await nonceResponse.json();
    assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);

    const id = 'A'.repeat(22);
    const claim = 'B'.repeat(22);
    const result = {
        address: 'bcrt1qclaimant',
        challenge: `test-login:${nonce}`,
        signature: 'signed-test-login',
    };
    const callback = await post('/callback', {
        v: 1,
        id,
        method: 'login',
        ok: true,
        result,
        claim,
    });
    assert.equal(callback.status, 202);
    assert.equal((await callback.json()).status, 'approved-unclaimed');
    assert.equal(callbackCalls.length, 1);
    assert.equal(callbackCalls[0].options.store, store);
    assert.equal(callbackCalls[0].options.appId, 'xchain-test-dapp');
    assert.equal(callbackCalls[0].options.origin, base);

    const pending = await fetch(`${base}/result/${id}`);
    assert.deepEqual(await pending.json(), {
        ok: true,
        status: 'approved-unclaimed',
        claimed: false,
    });

    const wrongClaim = await post(`/claim/${id}`, { claim: 'C'.repeat(22) });
    assert.equal(wrongClaim.status, 400);
    assert.deepEqual(await wrongClaim.json(), { ok: false, reason: 'NO_MATCH' });

    const acceptedClaim = await post(`/claim/${id}`, { claim });
    assert.equal(acceptedClaim.status, 200);
    assert.deepEqual(await acceptedClaim.json(), { ok: true, address: result.address });

    const replayedClaim = await post(`/claim/${id}`, { claim });
    assert.equal(replayedClaim.status, 409);
    assert.deepEqual(await replayedClaim.json(), {
        ok: false,
        reason: 'ALREADY_CLAIMED',
    });

    const secondNonceResponse = await post('/nonce', { mode: 'same-device' });
    const { nonce: secondNonce } = await secondNonceResponse.json();
    const callbackOnlyId = 'D'.repeat(22);
    const callbackOnly = await post('/callback', {
        v: 1,
        id: callbackOnlyId,
        method: 'login',
        ok: true,
        result: {
            address: 'bcrt1qcallback',
            challenge: `test-login:${secondNonce}`,
            signature: 'signed-callback-login',
        },
    });
    assert.equal(callbackOnly.status, 202);
    const noBrowserResult = await post(`/claim/${callbackOnlyId}`, {});
    assert.equal(noBrowserResult.status, 400);
    assert.deepEqual(await noBrowserResult.json(), { ok: false, reason: 'NO_MATCH' });
} finally {
    await new Promise((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
    )));
}

console.log(
    'OK: test-dapp error scenarios, served module graph execution, callback receiver, claim match, replay refusal, and callback-only no-result rule',
);
