// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §49.5 / G154 / Cluster G FOLLOWUP 1: auto-enqueue signed
// transactions on broadcast failure.
//
// Pins the wiring across four layers:
//   1. submitWithSigner exports BroadcastFailedError + wraps both
//      phase-1 and phase-2 broadcast rejections in it.
//   2. submitAction catches BroadcastFailedError, stamps the PendingTx
//      as `queued` with the signed txHex, and fires the optional
//      onBroadcastFailure callback.
//   3. createBackgroundHost ships a `pushQueueEntry` helper, registers
//      a `broadcast.queue.enqueue` route, and threads onBroadcastFailure
//      through every signing action route, software and hardware, and
//      every flow forwards it to submitAction.
//   4. All three messaging shims export `enqueueBroadcastRequest`
//      hitting the new route.

import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');

// --- 1. submitWithSigner -------------------------------------------------

const swsPath = join(core, 'src', 'sdk', 'submitWithSigner.js');
assert.ok(existsSync(swsPath), 'submitWithSigner.js exists');
const sws = readFileSync(swsPath, 'utf8');
assert.ok(
    /export class BroadcastFailedError extends Error/.test(sws),
    'submitWithSigner exports BroadcastFailedError class',
);
// Phase-1 broadcast wrap.
assert.ok(
    /try \{\s*await encoder\.broadcastTx\(signed\.txHex\);\s*\} catch[\s\S]+?throw new BroadcastFailedError\(\{[\s\S]+?phase: 'phase1'/.test(sws),
    'submitWithSigner wraps phase-1 broadcastTx rejection in BroadcastFailedError',
);
// Phase-2 broadcast wrap.
assert.ok(
    /try \{\s*await encoder\.broadcastTx\(phase2Signed\.txHex\);\s*\} catch[\s\S]+?throw new BroadcastFailedError\(\{[\s\S]+?phase: 'phase2'/.test(sws),
    'submitWithSigner wraps phase-2 broadcastTx rejection in BroadcastFailedError',
);
// Each error carries signedTxHex + txid + chainId so the queue can
// re-broadcast later.
for (const field of ['signedTxHex', 'txid', 'chainId', 'signedAt', 'encoding', 'phase']) {
    assert.ok(
        new RegExp(`this\\.${field} = ${field}`).test(sws),
        `BroadcastFailedError carries ${field}`,
    );
}

// --- 2. submitAction handles BroadcastFailedError ------------------------

const saPath = join(core, 'src', 'flows', 'submitAction.js');
assert.ok(existsSync(saPath), 'submitAction.js exists');
const sa = readFileSync(saPath, 'utf8');
assert.ok(
    /import \{ submitWithSigner, BroadcastFailedError \} from '\.\.\/sdk\/submitWithSigner\.js'/.test(sa),
    'submitAction imports BroadcastFailedError',
);
assert.ok(
    /onBroadcastFailure/.test(sa),
    'submitAction accepts an onBroadcastFailure callback',
);
assert.ok(
    /if \(err instanceof BroadcastFailedError\)/.test(sa),
    'submitAction branches on BroadcastFailedError',
);
// Status flips to 'queued' (not 'failed'), and txHex is populated so
// the queue + RBF UX have the signed bytes to work with.
assert.ok(
    /status: 'queued'[\s\S]+?txHex: err\.signedTxHex/.test(sa),
    'submitAction stamps PendingTx as queued with txHex on broadcast failure',
);
assert.ok(
    /onBroadcastFailure\(\{[\s\S]+?signedTxHex: err\.signedTxHex/.test(sa),
    'submitAction fires onBroadcastFailure with the queue-shaped entry',
);
// Non-BroadcastFailedError still goes to the failed branch.
assert.ok(
    /\} else if \(pending\) \{\s*await writePending\(\{\s*status: 'failed'/.test(sa),
    'submitAction still flips PendingTx to failed for non-broadcast errors',
);

// --- 3. Every flow passes onBroadcastFailure through ---------------------

// Every submitAction call site forwards the hook, so a failed broadcast on
// any action lands on the queue the confirm modal tells the user it is on.
// A file listed here is exempt on purpose and says why.
const FORWARD_EXEMPT = new Map([
    ['labelSync.js', 'label publish stamps no PendingTx and has no queued-result surface'],
]);
const flowsDir = join(core, 'src', 'flows');
const submitterNames = new Set();
let forwardingFiles = 0;
for (const file of readdirSync(flowsDir).filter((f) => f.endsWith('.js') && f !== 'submitAction.js')) {
    const src = readFileSync(join(flowsDir, file), 'utf8');
    const calls = (src.match(/\bsubmitAction\(\{/g) || []).length;
    if (calls === 0) continue;
    for (const m of src.matchAll(/export async function (\w+)/g)) submitterNames.add(m[1]);
    if (FORWARD_EXEMPT.has(file)) continue;
    const forwards = (src.match(/onBroadcastFailure: opts\.onBroadcastFailure,/g) || []).length;
    assert.equal(forwards, calls, `${file} forwards onBroadcastFailure from each of its ${calls} submitAction call(s)`);
    forwardingFiles += 1;
}
assert.ok(forwardingFiles >= 30, `the forward check reached ${forwardingFiles} flow files`);
for (const file of FORWARD_EXEMPT.keys()) {
    assert.ok(existsSync(join(flowsDir, file)), `exempt flow ${file} still exists`);
}

// --- 4. createBackgroundHost wires the queue + auto-enqueue --------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(
    /function pushQueueEntry\(walletId, entry\)/.test(bg),
    'createBackgroundHost defines a pushQueueEntry helper',
);
assert.ok(
    /host\.register\('broadcast\.queue\.enqueue'/.test(bg),
    'createBackgroundHost registers broadcast.queue.enqueue',
);
// One hook builder feeds every signing route, and it pushes onto the queue.
assert.ok(
    /function enqueueOnBroadcastFailure\(walletId\) \{[\s\S]+?return async \(entry\) => \{ await ensureQueueLoaded\(\); pushQueueEntry\(walletId, entry\); \};/.test(bg),
    'enqueueOnBroadcastFailure builds a hook that pushes onto the queue',
);
assert.ok(
    /host\.register\('action\.send'[^\n]*\n(?:(?!host\.register)[\s\S])*?onBroadcastFailure: enqueueOnBroadcastFailure\(req\?\.walletId\)/.test(bg),
    'action.send wires onBroadcastFailure through enqueueOnBroadcastFailure',
);
// Every registerHwHandler invocation gets the same wiring.
assert.ok(
    /function registerHwHandler\([\s\S]+?const onBroadcastFailure = enqueueOnBroadcastFailure\(req\?\.walletId\);[\s\S]+?return flow\(\{[^}]*onBroadcastFailure[^}]*\}\)/.test(bg),
    'registerHwHandler injects onBroadcastFailure into the flow call',
);
// Every software-signer route that runs a submitting flow wires it too.
let softwareRoutes = 0;
for (const m of bg.matchAll(/return (\w+)\(\{ \.\.\.req, signer: await sessionSigner\(req, vault, signerPool\)[^\n]*/g)) {
    if (!submitterNames.has(m[1])) continue;
    assert.ok(
        m[0].includes('onBroadcastFailure: enqueueOnBroadcastFailure(req?.walletId)'),
        `the ${m[1]} route wires onBroadcastFailure`,
    );
    softwareRoutes += 1;
}
assert.ok(softwareRoutes >= 40, `the route check reached ${softwareRoutes} software-signer routes`);

// --- 5. Messaging shims expose enqueueBroadcastRequest -------------------

for (const [name, file] of [
    ['extension', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(
        /export function enqueueBroadcastRequest\b/.test(src),
        `${name} messaging exports enqueueBroadcastRequest`,
    );
    assert.ok(
        /sendMessage\('broadcast\.queue\.enqueue'/.test(src),
        `${name} enqueueBroadcastRequest calls broadcast.queue.enqueue`,
    );
}

// Desktop also gets the prerequisite list/broadcast/discard shims it
// was previously missing. The QueuedBroadcastBanner mounted via
// FullLayoutWithNav.header (Cluster G FOLLOWUP 4) silently no-op'd on
// desktop until now.
const desktopMsg = readFileSync(join(desktop, 'renderer', 'messaging.js'), 'utf8');
for (const fn of ['listQueuedBroadcasts', 'broadcastQueuedRequest', 'discardQueuedRequest']) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(desktopMsg),
        `desktop messaging exports ${fn}`,
    );
}

console.log('auto-enqueue-on-offline-broadcast smoke OK');
