// §12 / Cluster S FOLLOWUP 5 smoke — test-dapp surfaces BLOCKED_BY_USER
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
//      ("Blocked by user — un-block in wallet Settings.").
//   6. example.ts exports `signActionWithRetry` that loops on THROTTLED
//      results up to `maxRetries`, sleeping `retryAfterMs` between
//      attempts.
//   7. example.ts exports `runErrorScenarios` walking both branches
//      against MockXChainProvider with the new options.
//   8. index.ts re-exports the new symbols + types.

import { strict as assert } from 'node:assert';
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
    /Blocked by user — un-block in wallet Settings/.test(example),
    'blocked message exact',
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

console.log(
    'OK — test-dapp-error-scenarios smoke (Cluster S FOLLOWUP 5 — MockProviderOptions.blockedSite + .throttle short-circuit connect/signMessage/signAction/signPsbt/signIn; example.ts adds handleSignActionResult tagged outcome with 7 branches incl. blocked/throttled; signActionWithRetry loops on THROTTLED with maxRetries + injectable sleep; runErrorScenarios + ErrorScenarioReport demonstrate both branches; index.ts re-exports the new surface)',
);
