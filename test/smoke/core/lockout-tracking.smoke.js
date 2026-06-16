// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 2 — G066 — failed-attempts
// escalating delay. Exercises the pure flow logic with a mock
// localStorage so cross-shell behaviour stays consistent.

import { strict as assert } from 'node:assert';

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

const fakeStore = new FakeStorage();
globalThis.localStorage = fakeStore;

const flow = await import(
    '../../../packages/core/src/flows/lockoutTracking.js'
);

const {
    delayForAttempts,
    emptyLockoutState,
    getLockoutState,
    getRemainingMs,
    recordFailure,
    recordSuccess,
    clearLockoutState,
} = flow;

// --- delay schedule ---------------------------------------------------

assert.equal(delayForAttempts(0), 0, 'N=0 no delay');
assert.equal(delayForAttempts(1), 0, 'N=1 no delay');
assert.equal(delayForAttempts(2), 0, 'N=2 no delay');
assert.equal(delayForAttempts(3), 5, 'N=3 → 5s');
assert.equal(delayForAttempts(4), 15, 'N=4 → 15s');
assert.equal(delayForAttempts(5), 60, 'N=5 → 60s');
assert.equal(delayForAttempts(6), 300, 'N=6 → 5min');
assert.equal(delayForAttempts(7), 900, 'N=7 → 15min cap');
assert.equal(delayForAttempts(20), 900, 'N=20 → 15min cap');
assert.equal(delayForAttempts(-1), 0, 'negatives clamped');
assert.equal(delayForAttempts(NaN), 0, 'NaN clamped');

// --- empty state ------------------------------------------------------

const empty = emptyLockoutState();
assert.deepEqual(empty, { failedAttempts: 0, lockedUntilMs: 0 });
assert.deepEqual(getLockoutState(), empty, 'fresh storage returns empty');

// --- record + persist -------------------------------------------------

const t0 = 1_700_000_000_000;
const after1 = recordFailure(t0);
assert.equal(after1.failedAttempts, 1);
assert.equal(after1.lockedUntilMs, 0, 'no delay until N=3');

const after2 = recordFailure(t0 + 1000);
assert.equal(after2.failedAttempts, 2);
assert.equal(after2.lockedUntilMs, 0);

const after3 = recordFailure(t0 + 2000);
assert.equal(after3.failedAttempts, 3);
assert.equal(after3.lockedUntilMs, t0 + 2000 + 5000, 'N=3 → 5s lockout');

const after4 = recordFailure(t0 + 8000);
assert.equal(after4.failedAttempts, 4);
assert.equal(after4.lockedUntilMs, t0 + 8000 + 15000, 'N=4 → 15s lockout');

// Persisted across reads.
const restored = getLockoutState();
assert.deepEqual(restored, after4, 'state survives reload via localStorage');

// --- remaining-ms calculation ----------------------------------------

assert.equal(getRemainingMs(after4, t0 + 8000), 15000, 'just-locked');
assert.equal(getRemainingMs(after4, t0 + 8000 + 15001), 0, 'past expiry');
assert.equal(getRemainingMs(after4, t0 + 10000), 13000, 'mid-countdown');
assert.equal(getRemainingMs(empty), 0, 'empty state never locks');
assert.equal(getRemainingMs(null), 0, 'null state safe');

// --- success clears state --------------------------------------------

recordSuccess();
assert.deepEqual(getLockoutState(), empty, 'success wipes counter + lockout');
assert.equal(fakeStore.getItem('xchain-wallet:lockout'), null, 'localStorage entry removed');

// --- corruption-tolerant reads ---------------------------------------

fakeStore.setItem('xchain-wallet:lockout', '{ not json');
assert.deepEqual(getLockoutState(), empty, 'malformed JSON falls back to empty');

fakeStore.setItem('xchain-wallet:lockout', JSON.stringify({ failedAttempts: -3, lockedUntilMs: 5 }));
assert.deepEqual(getLockoutState(), empty, 'rejects negative counters');

fakeStore.setItem('xchain-wallet:lockout', JSON.stringify({ failedAttempts: 'x' }));
assert.deepEqual(getLockoutState(), empty, 'rejects non-number fields');

clearLockoutState();
assert.deepEqual(getLockoutState(), empty, 'clear() resets cleanly');

// --- memory fallback when no localStorage ----------------------------

delete globalThis.localStorage;
clearLockoutState();
const memAfter1 = recordFailure(t0);
const memAfter2 = recordFailure(t0 + 100);
const memAfter3 = recordFailure(t0 + 200);
assert.equal(memAfter3.failedAttempts, 3, 'memory fallback counts');
assert.equal(memAfter3.lockedUntilMs, t0 + 200 + 5000);
assert.deepEqual(getLockoutState(), memAfter3, 'memory fallback round-trips');

console.log('lockout-tracking smoke OK');
