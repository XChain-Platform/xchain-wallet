// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §12 / G012: Per-origin sign-request throttle.
//
// Verifies:
//   1. `flows/signThrottle.js` exists and exports `createSignThrottle`
//      + the documented defaults; the `flows` barrel re-exports it.
//   2. The throttle's check() returns { allowed: true } until `burst`
//      requests have landed within `windowMs`, then flips to
//      { allowed: false, retryAfterMs, burst, windowMs }.
//   3. Different origins maintain independent buckets.
//   4. clear(origin) drops a single bucket; clear() drops all.
//   5. Bridge handlers register a throttle and call assertNotThrottled
//      from each of the four sign methods (signMessage, signAction,
//      signPsbt, signIn); connect / disconnect / read methods do NOT.
//   6. The bridge-spec BridgeErrorCode union and docs/BRIDGE.md table
//      both list THROTTLED.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// 1. Module + barrel exports.
const flowPath = 'packages/core/src/flows/signThrottle.js';
assert.ok(existsSync(join(root, flowPath)), `${flowPath} exists`);

const flowSrc = read(flowPath);
assert.ok(/export function createSignThrottle\(/.test(flowSrc),
    'signThrottle exports createSignThrottle');
assert.ok(/export const SIGN_THROTTLE_DEFAULT_BURST/.test(flowSrc),
    'signThrottle exports SIGN_THROTTLE_DEFAULT_BURST');
assert.ok(/export const SIGN_THROTTLE_DEFAULT_WINDOW_MS/.test(flowSrc),
    'signThrottle exports SIGN_THROTTLE_DEFAULT_WINDOW_MS');

const barrelSrc = read('packages/core/src/flows/index.js');
assert.ok(/createSignThrottle/.test(barrelSrc) && /signThrottle\.js/.test(barrelSrc),
    'flows barrel re-exports createSignThrottle');

const { createSignThrottle, SIGN_THROTTLE_DEFAULT_BURST, SIGN_THROTTLE_DEFAULT_WINDOW_MS } =
    await import(join(root, flowPath));

assert.equal(typeof SIGN_THROTTLE_DEFAULT_BURST, 'number', 'burst default is numeric');
assert.equal(typeof SIGN_THROTTLE_DEFAULT_WINDOW_MS, 'number', 'window default is numeric');

let now = 1_000_000;
const t = createSignThrottle({ burst: 3, windowMs: 10_000, now: () => now });

const A = 'https://a.example';
const B = 'https://b.example';

assert.equal(t.check(A).allowed, true, 'A request 1 allowed');
assert.equal(t.check(A).allowed, true, 'A request 2 allowed');
assert.equal(t.check(A).allowed, true, 'A request 3 allowed');

const blocked = t.check(A);
assert.equal(blocked.allowed, false, 'A request 4 blocked');
assert.equal(typeof blocked.retryAfterMs, 'number', 'blocked result includes retryAfterMs');
assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 10_000,
    'retryAfterMs falls within the window');
assert.equal(blocked.burst, 3, 'blocked result echoes burst');
assert.equal(blocked.windowMs, 10_000, 'blocked result echoes windowMs');

assert.equal(t.check(B).allowed, true, 'B unaffected by A throttling');

// Advance the clock past the window; A's bucket recovers.
now += 11_000;
assert.equal(t.check(A).allowed, true, 'A recovers after window expires');

assert.equal(t.check(A).allowed, true, 'A second slot used');
assert.equal(t.check(A).allowed, true, 'A third slot used');
assert.equal(t.check(A).allowed, false, 'A blocked again');
t.clear(A);
assert.equal(t.check(A).allowed, true, 'clear(A) drops the bucket');

t.clear();
assert.equal(t.check(B).allowed, true, 'clear() resets B too');

// Empty origin short-circuits to allowed (the per-handler assertOrigin
// guard catches missing origins; the throttle stays out of the way).
assert.equal(t.check('').allowed, true, 'empty origin not throttled');
assert.equal(t.check(undefined).allowed, true, 'undefined origin not throttled');

// 5. Bridge handlers wire the throttle into the four sign methods.
const handlersSrc = read('packages/extension/src/bridge/handlers.js');
assert.ok(/createSignThrottle,?/.test(handlersSrc),
    'bridge handlers destructure createSignThrottle from flows');
assert.ok(/const signThrottle = opts\.signThrottle \?\? createSignThrottle\(\)/.test(handlersSrc),
    'bridge handlers construct or accept a signThrottle');

assert.ok(/function assertNotThrottled\(throttle, req\)/.test(handlersSrc),
    'assertNotThrottled helper defined');
assert.ok(/throttle\.check\(req\?\.origin\)/.test(handlersSrc),
    'assertNotThrottled calls throttle.check on the request origin');
assert.ok(/bridgeError\(\s*\n?\s*'THROTTLED'/.test(handlersSrc),
    'assertNotThrottled raises a THROTTLED bridge error');
assert.ok(/err\.retryAfterMs = result\.retryAfterMs/.test(handlersSrc),
    'THROTTLED error carries retryAfterMs for the dApp');

const signMethods = ['signMessage', 'signAction', 'signPsbt', 'signIn'];
for (const method of signMethods) {
    const re = new RegExp(
        `register\\('bridge\\.${method}',[\\s\\S]*?assertNotThrottled\\(signThrottle, req\\)`,
    );
    assert.ok(re.test(handlersSrc),
        `bridge.${method} calls assertNotThrottled before approvals`);
}

const noThrottleMethods = [
    'connect', 'disconnect',
    'getAccounts', 'getAddresses', 'getBalances',
    'getSupportedChains', 'getActiveChains',
];
for (const method of noThrottleMethods) {
    const block = handlersSrc.match(
        new RegExp(`register\\('bridge\\.${method}'[\\s\\S]*?\\n    \\}\\);`),
    );
    assert.ok(block, `bridge.${method} handler block found`);
    assert.ok(!/assertNotThrottled/.test(block[0]),
        `bridge.${method} does NOT call assertNotThrottled (read/connect path)`);
}

// 6. THROTTLED listed in bridge-spec union and docs error table.
const specSrc = read('packages/bridge-spec/src/index.ts');
assert.ok(/\|\s*'THROTTLED'/.test(specSrc),
    'BridgeErrorCode union includes THROTTLED');
assert.ok(/retryAfterMs\?: number/.test(specSrc),
    'BridgeErrorResult declares optional retryAfterMs');

const bridgeDocSrc = read('docs/BRIDGE.md');
assert.ok(/`THROTTLED`/.test(bridgeDocSrc),
    'docs/BRIDGE.md error table mentions THROTTLED');
assert.ok(/per-origin sign-request rate limit/.test(bridgeDocSrc),
    'docs/BRIDGE.md describes the throttle');

console.log('OK: sign-throttle flow + bridge wiring + spec + docs smoke');
