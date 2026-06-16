// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 5 — G068 part 1 — panic-mode
// signing freeze foundation.

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
    '../../../packages/core/src/flows/panicMode.js'
);

const {
    DEFAULT_DURATION_MS,
    MIN_DURATION_MS,
    MAX_DURATION_MS,
    activatePanicMode,
    assertSigningAllowed,
    clearPanicModeState,
    deactivatePanicMode,
    emptyPanicModeState,
    getPanicModeState,
    getPanicRemainingMs,
    isSigningFrozen,
    PanicModeActiveError,
} = flow;

// --- defaults ---------------------------------------------------------

assert.equal(DEFAULT_DURATION_MS, 24 * 60 * 60 * 1000, 'default duration is 24h');
assert.equal(MIN_DURATION_MS, 60 * 1000, 'min duration is 1 minute');
assert.equal(MAX_DURATION_MS, 7 * 24 * 60 * 60 * 1000, 'max duration is 7 days');

// --- empty state -----------------------------------------------------

const empty = emptyPanicModeState();
assert.deepEqual(empty, { activatedAt: 0, expiresAt: 0, durationMs: 0 });
assert.deepEqual(getPanicModeState(), empty, 'fresh storage returns empty');
assert.equal(isSigningFrozen(), false, 'no freeze when inactive');
assert.equal(getPanicRemainingMs(empty), 0);

// assertSigningAllowed silently passes when inactive.
assertSigningAllowed();

// --- activate (default 24h) ------------------------------------------

const t0 = 1_700_000_000_000;
const active = activatePanicMode({ nowMs: t0 });
assert.equal(active.activatedAt, t0);
assert.equal(active.expiresAt, t0 + DEFAULT_DURATION_MS);
assert.equal(active.durationMs, DEFAULT_DURATION_MS);

assert.equal(isSigningFrozen(active, t0), true, 'frozen at t0');
assert.equal(isSigningFrozen(active, t0 + DEFAULT_DURATION_MS - 1), true, 'frozen 1ms before expiry');
assert.equal(isSigningFrozen(active, t0 + DEFAULT_DURATION_MS + 1), false, 'unfrozen 1ms after expiry');
assert.equal(getPanicRemainingMs(active, t0 + 1000), DEFAULT_DURATION_MS - 1000, 'countdown ticks');

// Persists via fake localStorage.
assert.deepEqual(getPanicModeState(), active, 'state survives reload');

// --- assertSigningAllowed throws while active ------------------------

assert.throws(
    () => assertSigningAllowed(t0 + 1000),
    (err) => err instanceof PanicModeActiveError && err.remainingMs > 0,
    'throws while active',
);

// --- duration clamp --------------------------------------------------

const tooShort = activatePanicMode({ durationMs: 100, nowMs: t0 });
assert.equal(tooShort.durationMs, MIN_DURATION_MS, 'sub-minute clamped up to 1m');

const tooLong = activatePanicMode({ durationMs: 30 * 24 * 60 * 60 * 1000, nowMs: t0 });
assert.equal(tooLong.durationMs, MAX_DURATION_MS, '30d clamped down to 7d');

const nan = activatePanicMode({ durationMs: NaN, nowMs: t0 });
assert.equal(nan.durationMs, DEFAULT_DURATION_MS, 'NaN falls back to default');

// --- deactivate clears -----------------------------------------------

deactivatePanicMode();
assert.deepEqual(getPanicModeState(), empty, 'deactivate wipes state');
assert.equal(fakeStore.getItem('xchain-wallet:panic'), null, 'localStorage entry removed');
assertSigningAllowed();

// --- corruption tolerance --------------------------------------------

fakeStore.setItem('xchain-wallet:panic', '{ not json');
assert.deepEqual(getPanicModeState(), empty, 'malformed JSON falls back to empty');

fakeStore.setItem('xchain-wallet:panic', JSON.stringify({ activatedAt: -1 }));
assert.deepEqual(getPanicModeState(), empty, 'rejects negative fields');

clearPanicModeState();

// --- assert auto-clears after expiry ---------------------------------

activatePanicMode({ durationMs: MIN_DURATION_MS, nowMs: t0 });
assert.equal(isSigningFrozen(undefined, t0), true);

// Calling assertSigningAllowed *after* the expiry should silently
// auto-clear and let signing proceed.
assertSigningAllowed(t0 + MIN_DURATION_MS + 1);
assert.deepEqual(getPanicModeState(), empty, 'expired state auto-cleared by assertSigningAllowed');

// --- memory fallback --------------------------------------------------

delete globalThis.localStorage;
clearPanicModeState();
const memActive = activatePanicMode({ nowMs: t0 });
assert.deepEqual(getPanicModeState(), memActive, 'memory fallback round-trips');

console.log('panic-mode smoke OK');
