// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §49.3 / §49.5: StalenessLabel (G155) + QueuedBroadcastBanner
// (G154 partial: UI + storage shipped; auto-enqueue is a Cluster G
// FOLLOWUP). Cluster G Step 2 of 2.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const components = join(core, 'src', 'shared', 'components');

// --- 1. StalenessLabel exports + tolerates missing data -----------------

const slPath = join(components, 'StalenessLabel.jsx');
assert.ok(existsSync(slPath), 'StalenessLabel.jsx exists');
assert.ok(existsSync(join(components, 'StalenessLabel.module.css')),
    'StalenessLabel.module.css exists');
const sl = readFileSync(slPath, 'utf8');
assert.ok(/export function StalenessLabel\b/.test(sl),
    'StalenessLabel is a named export');
assert.ok(/export function formatAgo\b/.test(sl),
    'formatAgo is a named export (reusable + smoke-testable)');
// §49.3: never fabricate data; if lastSyncedAt is null, render nothing.
assert.ok(/lastSyncedAt === null \|\| lastSyncedAt === undefined/.test(sl),
    'StalenessLabel renders nothing when lastSyncedAt is null/undefined');
// Self-refreshing tick so "30s ago" doesn't sit stale forever.
assert.ok(/setInterval/.test(sl),
    'StalenessLabel ticks itself on a setInterval');
assert.ok(/clearInterval/.test(sl),
    'StalenessLabel clears its tick interval on unmount');

// --- 2. QueuedBroadcastBanner exports + hides when empty ----------------

const qbPath = join(components, 'QueuedBroadcastBanner.jsx');
assert.ok(existsSync(qbPath), 'QueuedBroadcastBanner.jsx exists');
const qb = readFileSync(qbPath, 'utf8');
assert.ok(/export function QueuedBroadcastBanner\b/.test(qb),
    'QueuedBroadcastBanner is a named export');
assert.ok(/queue\.length === 0/.test(qb),
    'QueuedBroadcastBanner returns null when the queue is empty');
assert.ok(/listQueuedBroadcasts\(/.test(qb)
    && /broadcastQueuedRequest\(/.test(qb)
    && /discardQueuedRequest\(/.test(qb),
    'QueuedBroadcastBanner uses all three messaging endpoints');
// Per-row Broadcast/Discard buttons.
assert.ok(/Broadcast now/.test(qb),
    'QueuedBroadcastBanner exposes Broadcast now action');
assert.ok(/Discard/.test(qb),
    'QueuedBroadcastBanner exposes Discard action');

// --- 3. Background handlers register the queue routes -------------------

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
for (const route of ['broadcast.queue.list', 'broadcast.queue.broadcast', 'broadcast.queue.discard']) {
    assert.ok(
        new RegExp(`host\\.register\\(\\s*['"]${route.replace(/\./g, '\\.')}['"]`).test(bg),
        `background registers ${route}`,
    );
}

// --- 4. Both messaging shims expose the three endpoints -----------------

for (const file of [
    join(ext, 'src', 'popup', 'messaging.js'),
    join(web, 'src', 'messaging.js'),
]) {
    const src = readFileSync(file, 'utf8');
    for (const fn of ['listQueuedBroadcasts', 'broadcastQueuedRequest', 'discardQueuedRequest']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(src),
            `${file.includes('extension') ? 'extension' : 'web'} messaging exports ${fn}`,
        );
    }
}

// --- 5. Both shells mount QueuedBroadcastBanner above Home --------------

for (const [name, file] of [
    ['extension', join(ext, 'src', 'popup', 'App.jsx')],
    ['web', join(web, 'src', 'App.jsx')],
]) {
    const src = readFileSync(file, 'utf8');
    assert.ok(/from ['"]@xchain-wallet\/core\/shared\/components\/QueuedBroadcastBanner\.jsx['"]/.test(src),
        `${name} App imports QueuedBroadcastBanner`);
    assert.ok(/<QueuedBroadcastBanner walletId=\{activeWalletId\}/.test(src),
        `${name} App renders <QueuedBroadcastBanner walletId={activeWalletId}>`);
}

console.log('queued-broadcast-staleness smoke OK');
