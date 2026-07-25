// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for PC-18 SWAP completeness: SwapForm (same-chain) gains the rest
// of the SWAP v0 field set (Unix EXPIRATION, allow/block lists,
// GET_ADDRESS); CrossChainSwapForm's EXPIRATION is fixed from block counts
// to a Unix timestamp and gains ownership flags; the swap query wrappers
// backing MySwapsView are wired.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const read = (...p) => readFileSync(join(wsRoot, ...p), 'utf8');

// ---- Same-chain SwapForm: full v0 field set ----
const sf = read('packages', 'core', 'src', 'shared', 'routes', 'SwapForm.jsx');
assert.match(sf, /ALLOW_LIST: allowListIdx/, 'SwapForm emits ALLOW_LIST');
assert.match(sf, /BLOCK_LIST: blockListIdx/, 'SwapForm emits BLOCK_LIST');
assert.match(sf, /GET_ADDRESS: getAddress\.trim\(\)/, 'SwapForm emits GET_ADDRESS');
assert.match(sf, /EXPIRATION: String\(Math\.floor\(ms \/ 1000\)\)/, 'SwapForm emits EXPIRATION as a Unix timestamp');
assert.match(sf, /ListPickerScreen/, 'SwapForm uses the shared list picker for allow/block');

// ---- Cross-chain SwapForm: EXPIRATION fix + ownership flags ----
const xf = read('packages', 'core', 'src', 'shared', 'routes', 'CrossChainSwapForm.jsx');
assert.ok(!/expirationBlocks/.test(xf), 'CrossChainSwapForm no longer uses a block-count expiration');
assert.ok(!/Expiration \(blocks\)/.test(xf), 'CrossChainSwapForm drops the "Expiration (blocks)" input');
assert.match(xf, /EXPIRATION: String\(Math\.floor\(ms \/ 1000\)\)/, 'CrossChainSwapForm emits EXPIRATION as a Unix timestamp');
assert.match(xf, /GIVE_OWNERSHIP: '1'/, 'CrossChainSwapForm can give ownership');
assert.match(xf, /GET_OWNERSHIP: '1'/, 'CrossChainSwapForm can require get ownership');
assert.match(xf, /type="datetime-local"/, 'CrossChainSwapForm uses a datetime expiration picker');

// ---- swapAction wire (all versions through one flow) ----
const flow = read('packages', 'core', 'src', 'flows', 'swapAction.js');
assert.match(flow, /action: 'SWAP'/, 'swapAction composes SWAP for every version');
assert.match(flow, /SWAP_ACTION_INDEX/, 'swapAction handles v1 cancel / v2 edit by index');

// ---- Query wrappers + host + 3-shell messaging ----
const mq = read('packages', 'core', 'src', 'flows', 'marketQueries.js');
for (const fn of ['swapsForAddress', 'swapCancelsForAddress', 'swapDetail']) {
    assert.ok(mq.includes(`export async function ${fn}`), `marketQueries exports ${fn}`);
}
const host = read('packages', 'extension', 'src', 'background', 'createBackgroundHost.js');
for (const route of ["'swaps.forAddress'", "'swaps.cancelsForAddress'", "'swaps.detail'"]) {
    assert.ok(host.includes(route), `host registers ${route}`);
}
for (const shell of [
    ['packages', 'web', 'src', 'messaging.js'],
    ['packages', 'desktop', 'renderer', 'messaging.js'],
    ['packages', 'extension', 'src', 'popup', 'messaging.js'],
]) {
    const src = read(...shell);
    for (const route of ["'swaps.forAddress'", "'swaps.cancelsForAddress'", "'swaps.detail'"]) {
        assert.ok(src.includes(route), `${shell.join('/')} exposes ${route}`);
    }
}

console.log('swap-completeness smoke: all assertions passed');
