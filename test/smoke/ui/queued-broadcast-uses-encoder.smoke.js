// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §49.5 / G154: "Broadcast now" must call the ENCODER.
//
// The SDK's `wallet.broadcastTx(txHex, encoder)` refuses without its
// second argument - it throws ENCODER_REQUIRED, "Encoder client is
// required for broadcasting. Use sdk.broadcastTx() instead of
// sdk.wallet.broadcastTx()." The queue route called it with one
// argument, so EVERY retry of a signed-but-unbroadcast transaction
// failed with that developer string and the transaction stayed queued
// with no way out. Measured on an Android emulator against the LTC
// regtest venue (SSC-6): the signed tx survived process death
// exactly as designed, and then could not be broadcast at all.
//
// It survived every existing gate because the wallet's own suites stub
// the SDK, and the stub happily answers a one-argument call. Only a real
// encoder rejects it. So the assertion here is on the CALL SHAPE: this
// route, and its sibling `broadcast.signedTx`, both go through
// `sdk.encoder.broadcastTx`, the same way core's `drainQueuedBroadcast`
// does. Three call sites, one pattern.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const hostPath = join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.ok(existsSync(hostPath), 'createBackgroundHost.js exists');
const host = readFileSync(hostPath, 'utf8');

// --- 1. the queue retry route broadcasts through the encoder ------------

const queueRoute = sliceRouteBody(host, 'broadcast.queue.broadcast');
assert.ok(queueRoute, 'broadcast.queue.broadcast route found');

assert.ok(
    /await sdk\.encoder\.broadcastTx\(entry\.signedTxHex\)/.test(queueRoute),
    'broadcast.queue.broadcast broadcasts via sdk.encoder.broadcastTx',
);
assert.ok(
    !/sdk\.wallet\.broadcastTx\(/.test(queueRoute),
    'broadcast.queue.broadcast never calls sdk.wallet.broadcastTx (it requires an encoder argument '
    + 'this call site does not have, so every retry throws ENCODER_REQUIRED)',
);
assert.ok(
    /typeof sdk\?\.encoder\?\.broadcastTx !== 'function'/.test(queueRoute),
    'the pre-flight guard checks the same method the route actually calls',
);

// --- 2. the sibling raw-broadcast route is on the same pattern ----------

const signedRoute = sliceRouteBody(host, 'broadcast.signedTx');
assert.ok(signedRoute, 'broadcast.signedTx route found');
assert.ok(
    /await sdk\.encoder\.broadcastTx\(/.test(signedRoute),
    'broadcast.signedTx broadcasts via sdk.encoder.broadcastTx',
);

// --- 3. core's queue drain, the third call site -------------------------

const drainPath = join(wsRoot, 'packages', 'core', 'src', 'flows', 'queuedBroadcast.js');
const drain = readFileSync(drainPath, 'utf8');
assert.ok(
    /await sdk\.encoder\.broadcastTx\(existing\.txHex\)/.test(drain),
    'core drainQueuedBroadcast broadcasts via sdk.encoder.broadcastTx',
);

// --- 4. the retry route returns a normalized txid -----------------------
//
// Encoder result shapes differ by chain (some return { txid }, some the
// bare string), which `broadcast.signedTx` already normalizes. A caller
// that reads `.txid` off the queue route's answer should not have to know
// which chain it was.

assert.ok(
    /result\?\.txid \?\? result\?\.tx_hash/.test(queueRoute),
    'broadcast.queue.broadcast normalizes the encoder result to { txid }',
);

console.log('queued-broadcast-uses-encoder smoke OK');

/**
 * Pull out the body of a host.register('<route>', ...) call so assertions
 * bind to the route under test rather than to some other route's code.
 * Walks past the `=>` token before counting braces so destructured params
 * don't confuse the brace-depth tracker.
 */
function sliceRouteBody(src, route) {
    // Escapes every regex metacharacter (not just '.') so a literal string
    // can be embedded in `new RegExp()` without a stray backslash in the
    // input changing how the following character is interpreted.
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = new RegExp(`host\\.register\\(\\s*['"]${escaped}['"]`, 'g').exec(src);
    if (!m) return null;
    const arrowIdx = src.indexOf('=>', m.index);
    if (arrowIdx < 0) return null;
    const bodyOpen = src.indexOf('{', arrowIdx);
    if (bodyOpen < 0) return null;
    let i = bodyOpen;
    let depth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return src.slice(m.index, i + 1);
}
