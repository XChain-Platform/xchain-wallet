// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §49.5 / G154 / Cluster G FOLLOWUP 2: broadcast-queue
// persistence across reload. The queue lives in-memory inside
// createBackgroundHost; v0.293.0 adds a pluggable storage adapter that
// rehydrates the in-memory map at host construction and writes back on
// every mutation, so a service-worker restart (extension), a tab refresh
// (web), or an Electron app relaunch (desktop) doesn't lose the user's
// signed-but-unbroadcast txs.
//
// Verifies:
//   1. broadcastQueueStorage.js exports createBroadcastQueueStorage;
//      the picker prefers chrome.storage.local when available, falls
//      back to localStorage, and returns null when neither is present.
//   2. createBackgroundHost imports the picker, accepts a
//      `broadcastQueueStorage` dep (default = picker output), and
//      tracks `queueLoaded`/`queueLoadPromise` so concurrent callers
//      share one rehydrate.
//   3. ensureQueueLoaded fires before every broadcast.queue.* route.
//   4. persistQueue runs after every mutating route AND after
//      pushQueueEntry (the auto-enqueue path).
//   5. Auto-enqueue callbacks await ensureQueueLoaded so a fast Send
//      after a worker restart can't race the rehydrate and orphan
//      prior items.
//   6. Eager `void ensureQueueLoaded()` fires at host construction so
//      the queue is typically warm by the time the renderer mounts.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. broadcastQueueStorage adapter picker ----------------------------

const storagePath = join(ext, 'src', 'background', 'broadcastQueueStorage.js');
assert.ok(existsSync(storagePath), 'broadcastQueueStorage.js exists');
const storage = readFileSync(storagePath, 'utf8');
assert.ok(
    /export function createBroadcastQueueStorage\(\)/.test(storage),
    'createBroadcastQueueStorage is a named export',
);
assert.ok(
    /typeof chrome !== 'undefined' && chrome\?\.storage\?\.local/.test(storage),
    'picker checks for chrome.storage.local first',
);
assert.ok(
    /typeof localStorage !== 'undefined'/.test(storage),
    'picker falls back to localStorage when chrome.storage is unavailable',
);
assert.ok(
    /return null/.test(storage),
    'picker returns null when neither API is reachable (in-memory only)',
);
assert.ok(
    /function coerceSnapshot\(v\)/.test(storage),
    'broadcastQueueStorage ships a defensive coerceSnapshot helper',
);
assert.ok(
    /typeof e\.id === 'string'[\s\S]+?typeof e\.chainId === 'string'[\s\S]+?typeof e\.signedTxHex === 'string'/.test(storage),
    'coerceSnapshot filters entries by id/chainId/signedTxHex shape',
);

// --- 2. createBackgroundHost wires the storage --------------------------

const bgPath = join(ext, 'src', 'background', 'createBackgroundHost.js');
const bg = readFileSync(bgPath, 'utf8');
assert.ok(
    /import \{ createBroadcastQueueStorage \} from '\.\/broadcastQueueStorage\.js'/.test(bg),
    'createBackgroundHost imports the storage picker',
);
assert.ok(
    /broadcastQueueStorage = createBroadcastQueueStorage\(\)/.test(bg),
    'createBackgroundHost destructures broadcastQueueStorage with the picker as default',
);
assert.ok(
    /let queueLoaded = false/.test(bg),
    'createBackgroundHost tracks queueLoaded state',
);
assert.ok(
    /async function ensureQueueLoaded\(\)/.test(bg),
    'createBackgroundHost defines ensureQueueLoaded',
);
assert.ok(
    /async function persistQueue\(\)/.test(bg),
    'createBackgroundHost defines persistQueue',
);
assert.ok(
    /let queueLoadPromise = /.test(bg) && /if \(!queueLoadPromise\)/.test(bg),
    'ensureQueueLoaded uses a single-flight queueLoadPromise so concurrent callers share one rehydrate',
);

// --- 3. Every broadcast.queue.* route awaits ensureQueueLoaded ---------

for (const route of ['broadcast.queue.list', 'broadcast.queue.enqueue', 'broadcast.queue.broadcast', 'broadcast.queue.discard']) {
    const block = sliceRouteBody(bg, route);
    assert.ok(
        block && /await ensureQueueLoaded\(\)/.test(block),
        `${route} awaits ensureQueueLoaded`,
    );
}

// --- 4. Mutating routes persist after the change -----------------------

const broadcastBlock = sliceRouteBody(bg, 'broadcast.queue.broadcast');
// Removal re-resolves the entry by id AFTER the network await: `q` is the
// live shared array, and a discard or a second broadcast can shift it while
// this handler waits, so the index captured before the await may point at a
// different signed tx by the time the splice runs.
const REMOVE_BY_ID = /const cur = q\.findIndex\(\(e\) => e\.id === id\);\s*\n\s*if \(cur >= 0\) q\.splice\(cur, 1\);\s*\n\s*await persistQueue\(\);/;
assert.ok(
    broadcastBlock && REMOVE_BY_ID.test(broadcastBlock),
    'broadcast.queue.broadcast removes by re-resolved id, then persists',
);
assert.ok(
    broadcastBlock && !/q\.splice\(idx, 1\)/.test(broadcastBlock),
    'broadcast.queue.broadcast never splices by the pre-await index',
);
// The in-flight claim is taken synchronously, before the first await, so a
// second call for the same entry fails before broadcastTx runs.
{
    const firstAwait = broadcastBlock.indexOf('await ');
    const claim = broadcastBlock.indexOf('inFlightQueueBroadcasts.add(');
    assert.ok(claim > 0 && claim < firstAwait, 'the entry is claimed in-flight before the first await');
    assert.ok(
        /finally \{\s*\n\s*inFlightQueueBroadcasts\.delete\(claim\);/.test(broadcastBlock),
        'the in-flight claim is released in a finally',
    );
}
// This queue retries on demand, so it needs the same permanence
// verdict the core drain applies. A signed transaction whose inputs are gone
// can never confirm; leaving it listed invites the user to press "Broadcast
// now" forever on dead bytes, and the recovery is a fresh compose. Transient
// failures must still stay queued, which is the whole point of the surface.
assert.ok(
    broadcastBlock && /flows\.classifyBroadcastFailure\(err\) === 'permanent'/.test(broadcastBlock),
    'broadcast.queue.broadcast classifies a failed retry',
);
assert.ok(
    broadcastBlock
        && /=== 'permanent'\)\s*\{\s*\n\s*const cur = q\.findIndex\(\(e\) => e\.id === id\);\s*\n\s*if \(cur >= 0\) q\.splice\(cur, 1\);\s*\n\s*await persistQueue\(\);/.test(broadcastBlock),
    'a PERMANENT failure drops the entry from the queue and persists that',
);
assert.ok(
    broadcastBlock && /\}\s*\n\s*throw err;/.test(broadcastBlock),
    'the failure still propagates to the caller, permanent or not',
);
{
    // The transient path must NOT splice: a still-valid signed tx that hit a
    // dead node has to remain retryable, and losing it loses its fee.
    const catchBlock = broadcastBlock.slice(
        broadcastBlock.indexOf('} catch (err)'),
        broadcastBlock.indexOf('throw err;'),
    );
    const splices = (catchBlock.match(/q\.splice/g) || []).length;
    assert.equal(splices, 1, 'only the permanent branch removes the entry');
}

const discardBlock = sliceRouteBody(bg, 'broadcast.queue.discard');
assert.ok(
    discardBlock && /if \(idx >= 0\) q\.splice\(idx, 1\);\s*\n\s*await persistQueue\(\);/.test(discardBlock),
    'broadcast.queue.discard persists after the splice',
);
// pushQueueEntry persists too (fire-and-forget so auto-enqueue paths
// stay non-async).
const pushBodyMatch = /function pushQueueEntry\([^)]*\)\s*\{([\s\S]+?)\n\s{4}\}\s*\n\s{4}host\.register/.exec(bg);
assert.ok(pushBodyMatch, 'pushQueueEntry body parses');
assert.ok(
    /getQueue\(walletId\)\.push\(stored\);/.test(pushBodyMatch[1])
        && /void persistQueue\(\)/.test(pushBodyMatch[1]),
    'pushQueueEntry fires void persistQueue() after the in-memory push',
);

// --- 5. Auto-enqueue callbacks await ensureQueueLoaded -----------------

assert.ok(
    /onBroadcastFailure: walletId\s*\?\s*async \(entry\) => \{ await ensureQueueLoaded\(\); pushQueueEntry\(walletId, entry\); \}/.test(bg),
    'action.send onBroadcastFailure awaits ensureQueueLoaded before pushing',
);
assert.ok(
    /const onBroadcastFailure = walletId\s*\?\s*async \(entry\) => \{ await ensureQueueLoaded\(\); pushQueueEntry\(walletId, entry\); \}/.test(bg),
    'registerHwHandler injects an ensureQueueLoaded-awaiting onBroadcastFailure',
);

// --- 6. Eager load at construction -------------------------------------

assert.ok(
    /void ensureQueueLoaded\(\)/.test(bg),
    'createBackgroundHost kicks off ensureQueueLoaded eagerly',
);

console.log('broadcast-queue-persistence smoke OK');

/**
 * Pull out the body of a host.register('<route>', ...) call so we can
 * assert against the route-specific code without false positives from
 * unrelated awaits / persists elsewhere in the file. Walks past the
 * `=>` token before counting braces so destructured params don't
 * confuse the brace-depth tracker.
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
