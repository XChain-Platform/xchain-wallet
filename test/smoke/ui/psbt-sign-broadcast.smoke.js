// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for §20 / G040 FOLLOWUP 1 (Cluster D Step 1) — PsbtSignForm
// in-wallet broadcast.
//
// Pins:
//   - createBackgroundHost registers `broadcast.signedTx` (sdkRegistry-only,
//     no vault), validates inputs, calls sdk.encoder.broadcastTx, and
//     normalizes the result to `{ txid }`.
//   - All three messaging shims expose `broadcastSignedTxRequest`.
//   - PsbtSignForm captures `signedTxHex` from the sign result, exposes
//     a `broadcast` state machine, renders a Broadcast button gated on
//     `signedTxHex`, and replaces the "Broadcast from inside the wallet
//     will arrive in a later release" copy with the live status block.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const popupShim = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'popup', 'messaging.js'),
    'utf8',
);
const webShim = readFileSync(
    join(wsRoot, 'packages', 'web', 'src', 'messaging.js'),
    'utf8',
);
const desktopShim = readFileSync(
    join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js'),
    'utf8',
);
const formSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'routes', 'PsbtSignForm.jsx'),
    'utf8',
);

// ─── 1. host handler -------------------------------------------------

const handlerIdx = hostSrc.indexOf("host.register('broadcast.signedTx'");
assert.notEqual(handlerIdx, -1, 'broadcast.signedTx handler registered');
const handlerBlock = hostSrc.slice(handlerIdx, handlerIdx + 800);
assert.match(handlerBlock, /chainId is required/, 'validates chainId presence');
assert.match(handlerBlock, /txHex is required/, 'validates txHex presence');
assert.match(handlerBlock, /sdkRegistry\.get\(chainId\)/, 'looks up SDK by chainId');
assert.match(handlerBlock, /sdk\?\.encoder\?\.broadcastTx/, 'guards against missing encoder.broadcastTx');
assert.match(handlerBlock, /await sdk\.encoder\.broadcastTx\(txHex\)/, 'calls broadcastTx with txHex');
assert.match(handlerBlock, /return \{ txid \}/, 'normalizes return to { txid }');
// Vault should NOT appear — broadcast is read-only-ish, no unlock required.
assert.doesNotMatch(handlerBlock, /\bvault\b/, 'handler does not require vault');

// ─── 2. messaging shims ---------------------------------------------

for (const [name, src] of [
    ['popup', popupShim],
    ['web', webShim],
    ['desktop', desktopShim],
]) {
    assert.match(
        src,
        /export function broadcastSignedTxRequest\(opts\)/,
        `${name} shim exports broadcastSignedTxRequest`,
    );
    assert.match(
        src,
        /sendMessage\('broadcast\.signedTx', opts\)/,
        `${name} shim routes to broadcast.signedTx`,
    );
}

// ─── 3. PsbtSignForm wiring -----------------------------------------

assert.match(
    formSrc,
    /const \[signedTxHex, setSignedTxHex\] = useState/,
    'PsbtSignForm tracks signedTxHex state',
);
assert.match(
    formSrc,
    /const \[broadcastState, setBroadcastState\] = useState\(/,
    'PsbtSignForm tracks broadcastState',
);
assert.match(
    formSrc,
    /const \[broadcastTxid, setBroadcastTxid\] = useState/,
    'PsbtSignForm tracks broadcastTxid',
);
assert.match(
    formSrc,
    /const \[broadcastError, setBroadcastError\] = useState/,
    'PsbtSignForm tracks broadcastError',
);
assert.match(
    formSrc,
    /setSignedTxHex\(typeof result\?\.txHex === 'string' \? result\.txHex : ''\)/,
    'sign-success path captures txHex from auth.signPsbt result',
);
assert.match(
    formSrc,
    /messaging\.broadcastSignedTxRequest\(\{[\s\S]+?chainId,[\s\S]+?txHex: signedTxHex,/,
    'Broadcast button calls broadcastSignedTxRequest with chainId + txHex',
);
assert.match(
    formSrc,
    /disabled=\{!signedTxHex \|\| broadcastState === 'broadcasting'\}/,
    'Broadcast button gated on signedTxHex + busy state',
);
// Old "later release" copy must be gone — replaced by the new status block.
assert.doesNotMatch(
    formSrc,
    /Broadcast from inside the wallet will arrive in a later release/,
    'old "later release" placeholder copy removed',
);
assert.match(
    formSrc,
    /Broadcast directly from this wallet/,
    'new "broadcast directly" copy present',
);
// Sign-another reset clears all the new state.
assert.match(formSrc, /setSignedTxHex\(''\)/, 'reset clears signedTxHex');
assert.match(formSrc, /setBroadcastState\('idle'\)/, 'reset clears broadcastState');
assert.match(formSrc, /setBroadcastTxid\(''\)/, 'reset clears broadcastTxid');
assert.match(formSrc, /setBroadcastError\(null\)/, 'reset clears broadcastError');

console.log('psbt-sign-broadcast smoke OK');
