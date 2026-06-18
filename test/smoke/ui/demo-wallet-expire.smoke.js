// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for §25.2 / Cluster J FOLLOWUP 6: demo wallet auto-expire.
//
// Pins:
//   - flows/demoMode.js exports getDemoWalletExpiry, isDemoWalletExpired,
//     DEMO_DEFAULT_TTL_MS, plus a markDemoWallet(walletId, opts) signature.
//   - markDemoWallet records both a created-at timestamp and a TTL in
//     localStorage; default TTL is 24 hours.
//   - isDemoWalletExpired flips true once now >= createdAt + ttl.
//   - clearDemoWalletId wipes all three storage keys (id + created-at + ttl).
//   - DemoBanner mounts an interval-based auto-exit when isDemoWalletExpired
//     reports true, and surfaces an "Auto-wipes in …" hint.
//   - flows/index.js re-exports the new symbols.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    markDemoWallet,
    getDemoWalletId,
    getDemoWalletExpiry,
    isDemoWallet,
    isDemoWalletExpired,
    clearDemoWalletId,
    DEMO_DEFAULT_TTL_MS,
} from '../../../packages/core/src/flows/demoMode.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');

const flowSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'demoMode.js'),
    'utf8',
);
const flowIndexSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'flows', 'index.js'),
    'utf8',
);
const bannerSrc = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'components', 'DemoBanner.jsx'),
    'utf8',
);

// ─── 1. exports ─────────────────────────────────────────────────────────

assert.equal(typeof markDemoWallet, 'function', 'markDemoWallet exported');
assert.equal(typeof getDemoWalletExpiry, 'function', 'getDemoWalletExpiry exported');
assert.equal(typeof isDemoWalletExpired, 'function', 'isDemoWalletExpired exported');
assert.equal(typeof clearDemoWalletId, 'function', 'clearDemoWalletId exported');
assert.equal(DEMO_DEFAULT_TTL_MS, 24 * 60 * 60 * 1000,
    'default TTL = 24 hours');

assert.match(
    flowIndexSrc,
    /getDemoWalletExpiry,[\s\S]+?isDemoWalletExpired,[\s\S]+?DEMO_DEFAULT_TTL_MS,/,
    'flows/index.js re-exports the new symbols',
);

// ─── 2. localStorage round-trip ────────────────────────────────────────

class FakeLocalStorage {
    constructor() { this.data = new Map(); }
    getItem(k) { return this.data.has(k) ? this.data.get(k) : null; }
    setItem(k, v) { this.data.set(k, String(v)); }
    removeItem(k) { this.data.delete(k); }
}
globalThis.localStorage = new FakeLocalStorage();

// Mark with default TTL.
markDemoWallet('demo-123', { now: 1_700_000_000_000 });
assert.equal(getDemoWalletId(), 'demo-123', 'walletId stored');
assert.equal(isDemoWallet('demo-123'), true);
const expiry = getDemoWalletExpiry();
assert.ok(expiry, 'expiry record retrievable');
assert.equal(expiry.createdAt, 1_700_000_000_000, 'createdAt round-trips');
assert.equal(expiry.ttlMs, DEMO_DEFAULT_TTL_MS, 'TTL defaults to 24h');
assert.equal(expiry.expiresAt, 1_700_000_000_000 + DEMO_DEFAULT_TTL_MS,
    'expiresAt = createdAt + ttlMs');

// Not expired yet.
assert.equal(isDemoWalletExpired({ now: 1_700_000_000_000 + 1_000 }), false,
    'not expired right after creation');
assert.equal(isDemoWalletExpired({ now: 1_700_000_000_000 + DEMO_DEFAULT_TTL_MS - 1 }), false,
    'still not expired one ms before expiry');
assert.equal(isDemoWalletExpired({ now: 1_700_000_000_000 + DEMO_DEFAULT_TTL_MS }), true,
    'expired exactly at expiry instant');
assert.equal(isDemoWalletExpired({ now: 1_700_000_000_000 + DEMO_DEFAULT_TTL_MS + 1 }), true,
    'expired strictly after');

// Custom TTL override.
markDemoWallet('demo-456', { ttlMs: 60_000, now: 1_700_000_000_000 });
const customExpiry = getDemoWalletExpiry();
assert.equal(customExpiry.ttlMs, 60_000, 'custom TTL applied');

// Negative / non-finite TTL falls back to default.
markDemoWallet('demo-789', { ttlMs: -1, now: 1_700_000_000_000 });
const fallbackExpiry = getDemoWalletExpiry();
assert.equal(fallbackExpiry.ttlMs, DEMO_DEFAULT_TTL_MS,
    'invalid TTL falls back to default');

// clearDemoWalletId wipes all three keys.
clearDemoWalletId();
assert.equal(getDemoWalletId(), null, 'walletId cleared');
assert.equal(getDemoWalletExpiry(), null, 'expiry cleared');

// isDemoWalletExpired requires both presence + expiry.
assert.equal(isDemoWalletExpired({ now: Date.now() + 100 * DEMO_DEFAULT_TTL_MS }), false,
    'no demo → not expired');

// ─── 3. DemoBanner auto-exit wiring ────────────────────────────────────

assert.match(bannerSrc, /flowsLib\.getDemoWalletExpiry\(\)/,
    'banner reads the expiry record on mount');
assert.match(bannerSrc, /flowsLib\.isDemoWalletExpired\(\)/,
    'banner consults isDemoWalletExpired');
assert.match(bannerSrc, /setInterval\(tick, 60_000\)/,
    'banner re-checks expiry on a 60-second interval');
assert.match(bannerSrc, /Auto-wipes in/,
    'banner copy mentions auto-wipe countdown');
assert.match(bannerSrc, /Auto-wipe imminent\./,
    'banner copy covers the past-expiry edge case');
assert.match(bannerSrc, /function formatExpiryHint/,
    'banner has formatExpiryHint helper for countdown copy');

console.log('demo-wallet-expire smoke OK');
