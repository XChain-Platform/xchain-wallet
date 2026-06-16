// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §26 Lock & Panic — Step 6 — G068 part 2 — duress passphrase
// flow. Exercises the hash/verify round-trip + the trip-and-arm
// integration with panicMode.

import { strict as assert } from 'node:assert';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

class FakeStorage {
    constructor() { this.map = new Map(); }
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
    setItem(k, v) { this.map.set(k, String(v)); }
    removeItem(k) { this.map.delete(k); }
}

const fakeStore = new FakeStorage();
globalThis.localStorage = fakeStore;

const duress = await import(
    '../../../packages/core/src/flows/duressPassphrase.js'
);
const panic = await import(
    '../../../packages/core/src/flows/panicMode.js'
);

const {
    isDuressConfigured,
    setDuressPassphrase,
    clearDuressPassphrase,
    isDuressMatch,
    tripDuressIfMatch,
} = duress;

const { getPanicModeState, clearPanicModeState, isSigningFrozen } = panic;

// --- not-configured initial state ------------------------------------

assert.equal(isDuressConfigured(), false);
assert.equal(isDuressMatch('anything'), false, 'no match without configuration');
assert.equal(tripDuressIfMatch('anything'), false, 'no trip without configuration');
assert.equal(isSigningFrozen(getPanicModeState()), false, 'panic untouched');

// --- set + verify ----------------------------------------------------

setDuressPassphrase('emergency-escape');
assert.equal(isDuressConfigured(), true);
assert.equal(isDuressMatch('emergency-escape'), true, 'match round-trips');
assert.equal(isDuressMatch('emergency-escapr'), false, 'one-char delta rejected');
assert.equal(isDuressMatch(''), false, 'empty rejected');
assert.equal(isDuressMatch(null), false, 'null rejected');

// --- persisted shape never includes plaintext ------------------------

const raw = fakeStore.getItem('xchain-wallet:duress');
assert.ok(raw);
assert.equal(raw.includes('emergency-escape'), false, 'plaintext never written');
const parsed = JSON.parse(raw);
assert.ok(parsed.salt && parsed.hash, 'salt + hash present');
assert.equal(typeof parsed.createdAt, 'number');

// --- different salts produce different hashes for same passphrase ---

setDuressPassphrase('emergency-escape');
const second = JSON.parse(fakeStore.getItem('xchain-wallet:duress'));
assert.notEqual(second.salt, parsed.salt, 'fresh salt on each set');
assert.notEqual(second.hash, parsed.hash, 'hash differs across salts');

// --- trip arms panic mode silently -----------------------------------

clearPanicModeState();
assert.equal(isSigningFrozen(getPanicModeState()), false);
assert.equal(tripDuressIfMatch('emergency-escape'), true, 'matches and trips');
const armed = getPanicModeState();
assert.ok(armed.expiresAt > Date.now(), 'panic mode armed by trip');
assert.equal(isSigningFrozen(armed), true, 'signing frozen after trip');

// --- non-match does not arm ------------------------------------------

clearPanicModeState();
assert.equal(tripDuressIfMatch('wrong'), false);
assert.equal(isSigningFrozen(getPanicModeState()), false, 'no arm on miss');

// --- clear wipes record ----------------------------------------------

clearDuressPassphrase();
assert.equal(isDuressConfigured(), false);
assert.equal(fakeStore.getItem('xchain-wallet:duress'), null);
assert.equal(isDuressMatch('emergency-escape'), false, 'no match after clear');

// --- corruption tolerance --------------------------------------------

fakeStore.setItem('xchain-wallet:duress', '{ not json');
assert.equal(isDuressConfigured(), false, 'malformed JSON → not configured');
assert.equal(isDuressMatch('emergency-escape'), false);

fakeStore.setItem('xchain-wallet:duress', JSON.stringify({ salt: 1, hash: 'x' }));
assert.equal(isDuressConfigured(), false, 'rejects bad shape');

clearDuressPassphrase();

// --- memory fallback when no localStorage ----------------------------

delete globalThis.localStorage;
clearDuressPassphrase();
setDuressPassphrase('memory-mode');
assert.equal(isDuressMatch('memory-mode'), true, 'memory fallback verifies');
assert.equal(isDuressMatch('mismatch'), false);

console.log('duress-passphrase smoke OK');
