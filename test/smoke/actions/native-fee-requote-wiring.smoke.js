// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for : the Approve-time native-coin fee re-quote must be wired
// END TO END, on every surface that can approve a composed action.
//
// The defect this guards is not subtle logic, it is a missing link: the fee
// output is sized at compose, the required amount moves inversely with the
// coin price, and the wallet re-ran its per-block pre-flight for months
// without ever re-checking the amount it was about to pay. A short native fee
// is not a retryable failure - it is a real payment to FEE_DESTINATION that
// the chain keeps while rejecting the action (measured on LTC regtest: 0.02
// LTC spent for nothing).
//
// The comparison itself is unit-tested (test/unit/flows/nativeFeeRequote.test.js)
// and the hook behaviour in test/unit/hooks/useConfirmAction.test.jsx. What
// those cannot see is a form that drives useConfirmAction and simply never
// passes the probe, which is how this rail would quietly come undone one
// route at a time. Hence a wiring assertion per link.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const wsRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// --- 1. the host route exists and quotes the COMPOSED bytes ------------

const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
assert.ok(host.includes("host.register('action.requoteNativeFee'"),
    'the host must register action.requoteNativeFee');
assert.match(host, /sdk\.quoteNativeFee\(actionString/,
    'the re-quote must price the composed action string, not a re-derived one');

// --- 2. every shell exposes it ----------------------------------------

for (const shell of [
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
]) {
    assert.ok(read(...shell).includes("'action.requoteNativeFee'"),
        `${shell.join('/')} must expose action.requoteNativeFee`);
}

// --- 3. the hook refuses rather than signing --------------------------

const hook = read('packages', 'core', 'src', 'shared', 'hooks', 'useConfirmAction.js');
assert.match(hook, /args\.requoteNativeFee/,
    'the confirm hook must call the re-quote at Approve');
assert.match(hook, /reason: 'fee-changed'/,
    'a fee outside the band must interrupt, like spent inputs do');
// The refusal has to happen BEFORE onApprove, which is where signing and
// broadcasting live. Ordering is the entire guarantee.
const approveBody = hook.slice(hook.indexOf('const approve = useCallback'));
assert.ok(approveBody.indexOf('requoteNativeFee') < approveBody.indexOf('args.onApprove'),
    'the re-quote must run before onApprove, or it guards nothing');

// --- 4. every approving surface passes the probe ----------------------
//
// A form that owns its own useConfirmAction call has to pass it explicitly;
// the ones migrated to useActionConfirmFlow inherit it from that hook.

const routesDir = join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes');
// Two surfaces have nothing to re-quote, and say why here rather than by
// omission. PsbtSignForm signs a PSBT handed to it by a dApp: the wallet
// composed nothing and quoted nothing, so there is no attached fee output.
// SignMessageForm signs a message off-chain, with no transaction at all. The
// hook's own guard is a no-op on both either way.
const EXEMPT = new Set(['PsbtSignForm.jsx', 'SignMessageForm.jsx']);

const unwired = readdirSync(routesDir)
    .filter((f) => f.endsWith('.jsx') && !EXEMPT.has(f))
    .filter((f) => {
        const src = readFileSync(join(routesDir, f), 'utf8');
        return src.includes('confirmAction.confirm({') && !src.includes('requoteNativeFee');
    });
assert.deepEqual(unwired, [],
    `these forms approve a composed action without re-quoting its native fee: ${unwired.join(', ')}`);

const flow = read('packages', 'core', 'src', 'shared', 'hooks', 'useActionConfirmFlow.js');
assert.match(flow, /requoteNativeFee: \(\{ actionString, source \}\)/,
    'every migrated form must inherit the re-quote from useActionConfirmFlow');

console.log('native-fee re-quote wiring smoke: OK');
