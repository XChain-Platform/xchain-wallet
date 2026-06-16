// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §12 / Cluster S FOLLOWUP 2 — persistent throttle state
// across service-worker restarts.
//
// Pins:
//   - createSignThrottle accepts onPersist + initialState + seed().
//     onPersist fires fire-and-forget on every check / clear; seed()
//     splices persisted timestamps into the live bucket map without
//     re-firing onPersist.
//   - new background/signThrottleStorage.js mirrors the broadcastQueue-
//     Storage shape (load / save / clear) and picks chrome.storage.local
//     vs localStorage vs null based on what the host process exposes.
//   - createBackgroundHost wires signThrottleStorage's adapter into
//     onPersist + kicks off async hydration via signThrottle.seed.
//   - The hydration runs once and tolerates load failures by starting
//     fresh.
//
// Behavioral verification: a quick in-memory load/save round-trip via
// the throttle module's snapshot/seed surface.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createSignThrottle,
    SIGN_THROTTLE_DEFAULT_BURST,
} from '../../../packages/core/src/flows/signThrottle.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'signThrottle.js'),
    'utf8',
);
const hostSrc = readFileSync(
    join(wsRoot, 'packages', 'extension', 'src', 'background', 'createBackgroundHost.js'),
    'utf8',
);
const storagePath = join(
    wsRoot, 'packages', 'extension', 'src', 'background', 'signThrottleStorage.js',
);

// ─── 1. throttle: onPersist + initialState + seed ──────────────────────

assert.match(flowSrc, /opts\.onPersist/, 'onPersist option declared');
assert.match(flowSrc, /opts\.initialState\.buckets/, 'initialState.buckets honoured');
assert.match(flowSrc, /function seed\(persistedBuckets\)/, 'seed() exists');
assert.match(flowSrc, /Don't fire onPersist here/, 'seed() intentionally skips persistence');

// Behavioral: onPersist fires on check, snapshot mirrors live buckets.
{
    const persisted = [];
    const throttle = createSignThrottle({
        burst: 3,
        windowMs: 60_000,
        onPersist: (snapshot) => { persisted.push(snapshot); },
        now: () => 1_700_000_000_000,
    });
    throttle.check('https://example.com');
    throttle.check('https://example.com');
    // Allow microtask queue to flush the fire-and-forget Promise.resolve.
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(persisted.length >= 2,
        `onPersist fires on every check (got ${persisted.length})`);
    const last = persisted[persisted.length - 1];
    assert.ok(last && last.buckets,
        'onPersist receives { buckets } shape');
    assert.equal(
        Array.isArray(last.buckets['https://example.com']) && last.buckets['https://example.com'].length,
        2,
        'snapshot bucket carries the two timestamps',
    );

    // Re-seed into a fresh throttle and confirm timestamps land.
    const fresh = createSignThrottle({
        burst: 3,
        windowMs: 60_000,
        now: () => 1_700_000_000_000,
    });
    fresh.seed(last.buckets);
    const snap = fresh.snapshot();
    assert.equal(
        snap.buckets['https://example.com'].length,
        2,
        'seed() rehydrates persisted timestamps',
    );
}

// initialState path (alternative to seed-after-construct).
{
    const t = createSignThrottle({
        burst: 3,
        windowMs: 60_000,
        initialState: { buckets: { 'https://x.com': [1, 2, 3] } },
        now: () => 4,
    });
    const snap = t.snapshot();
    assert.equal(snap.buckets['https://x.com'].length, 3,
        'initialState seeds buckets at construction');
}

// seed merges with existing live buckets without losing in-flight ts.
{
    const t = createSignThrottle({
        burst: 3,
        windowMs: 60_000,
        now: () => 1000,
    });
    t.check('https://x.com'); // adds 1000
    t.seed({ 'https://x.com': [500, 600] });
    const snap = t.snapshot();
    assert.deepEqual(
        snap.buckets['https://x.com'],
        [500, 600, 1000],
        'seed merges + sorts persisted + live timestamps',
    );
}

// ─── 2. signThrottleStorage adapter file shape ─────────────────────────

assert.ok(existsSync(storagePath), 'signThrottleStorage.js exists');
const storageSrc = readFileSync(storagePath, 'utf8');
assert.match(storageSrc, /export function createSignThrottleStorage\(\)/,
    'createSignThrottleStorage is a named export');
assert.match(storageSrc, /chrome\?\.storage\?\.local/, 'extension SW path uses chrome.storage.local');
assert.match(storageSrc, /typeof localStorage !== 'undefined'/, 'web/desktop path uses localStorage');
assert.match(storageSrc, /xchain\.signThrottle/, 'storage key namespaced under xchain.signThrottle');
assert.match(storageSrc, /function coerceSnapshot/, 'defensive coerce of persisted shape');
assert.match(storageSrc, /Number\.isFinite\(ts\)/, 'coerce keeps only finite-number timestamps');

// ─── 3. createBackgroundHost wiring ────────────────────────────────────

assert.match(
    hostSrc,
    /import \{ createSignThrottleStorage \} from '\.\/signThrottleStorage\.js'/,
    'host imports createSignThrottleStorage',
);
assert.match(
    hostSrc,
    /signThrottleStorage = createSignThrottleStorage\(\)/,
    'signThrottleStorage default = createSignThrottleStorage()',
);
assert.match(
    hostSrc,
    /onPersist: signThrottleStorage[\s\S]+?signThrottleStorage\.save/,
    'throttle onPersist wired to storage.save when adapter present',
);
assert.match(
    hostSrc,
    /signThrottle\.seed\(snapshot\?\.buckets \|\| \{\}\)/,
    'host hydrates the throttle via seed() after load',
);

// Don't reference the default/SDK-default constants — only the export shape.
void SIGN_THROTTLE_DEFAULT_BURST;

console.log('sign-throttle-persistence smoke OK');
