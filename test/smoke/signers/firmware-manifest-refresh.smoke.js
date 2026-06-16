// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §18.4 / Cluster N FOLLOWUP 1 smoke — runtime-fetched firmware
// manifest with bundled fallback.
//
// Asserts:
//   1. Without a configured URL / public key, refreshFirmwareManifest
//      returns `{ ok: false, reason: 'not-configured' }` — no fetch,
//      no cache write.
//   2. A network failure returns `{ ok: false, reason: 'network' }`
//      and leaves the cache untouched (no downgrade-to-no-advisories
//      from a CDN outage).
//   3. A schema mismatch returns `{ ok: false, reason: 'schema' }` and
//      doesn't write the cache.
//   4. A signature failure returns `{ ok: false, reason: 'signature' }`
//      and doesn't write the cache.
//   5. A successful fetch + verify writes the manifest into the cache
//      backend with a `fetchedAt` timestamp.
//   6. resolveActiveFirmwareManifest prefers cache when fresh
//      (within TTL), reports source = 'cache' + ageMs.
//   7. resolveActiveFirmwareManifest falls back to the bundled
//      manifest when the cache is empty, source = 'bundled'.
//   8. resolveActiveFirmwareManifest falls back to bundled when the
//      cache is older than TTL — stale cache does NOT silently
//      downgrade safety.
//   9. checkFirmware accepts an optional manifest arg (so callers can
//      pass the resolver's output) and stays back-compat without it.

import { strict as assert } from 'node:assert';
import {
    refreshFirmwareManifest,
    resolveActiveFirmwareManifest,
    createInMemoryFirmwareManifestCache,
    FIRMWARE_MANIFEST_CACHE_KEY,
} from '../../../packages/core/src/flows/firmwareManifestRefresh.js';
import { FIRMWARE_MANIFEST } from '../../../packages/core/src/signers/firmware-manifest.js';
import { checkFirmware } from '../../../packages/core/src/signers/checkFirmware.js';

const URL = 'https://wallet.example/firmware-manifest.json';
const PUBKEY = 'ed25519:public-key-bytes-as-hex';
const TTL_MS = 24 * 60 * 60 * 1000;

const validManifest = {
    schema: 'firmware-manifest/1',
    generatedAt: '2026-04-29',
    walletVersion: '0.281.0',
    vendors: {
        trezor: {
            updateUrl: 'https://trezor.io/start',
            models: {
                T1B1: {
                    displayName: 'Trezor Model One',
                    minimum: '1.10.0',
                    recommended: '1.13.0',
                    knownVulnerable: ['1.11.2'],
                    unsupported: [],
                },
            },
        },
    },
};

const validEnvelope = { manifest: validManifest, signature: 'base64-sig-here' };

function fetchOk(envelope) {
    return async () => ({
        ok: true,
        async json() { return envelope; },
    });
}

function fetchFailing() {
    return async () => { throw new Error('network unreachable'); };
}

function fetchHttpErr() {
    return async () => ({ ok: false, status: 503, async json() { return null; } });
}

const verifyAlwaysTrue = async () => true;
const verifyAlwaysFalse = async () => false;

// --- 1. Not configured (empty URL or pubkey) ---------------------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk(validEnvelope),
        verify: verifyAlwaysTrue,
        cache,
        url: '',
        publicKey: PUBKEY,
    });
    assert.deepEqual(r, { ok: false, reason: 'not-configured' });
    assert.equal(await cache.get(FIRMWARE_MANIFEST_CACHE_KEY), null);
}
{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk(validEnvelope),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: '',
    });
    assert.deepEqual(r, { ok: false, reason: 'not-configured' });
}

// --- 2. Network failure ------------------------------------------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchFailing(),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'network');
    assert.ok(r.error instanceof Error);
    assert.equal(await cache.get(FIRMWARE_MANIFEST_CACHE_KEY), null);
}
{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchHttpErr(),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'network');
    assert.match(r.error.message, /HTTP 503/);
}

// --- 3. Schema mismatch ------------------------------------------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk({ manifest: { schema: 'wrong/2' }, signature: 'x' }),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.deepEqual(r, { ok: false, reason: 'schema' });
    assert.equal(await cache.get(FIRMWARE_MANIFEST_CACHE_KEY), null);
}
{
    // Missing manifest body
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk({ signature: 'x' }),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.equal(r.reason, 'schema');
}

// --- 4. Signature failure ----------------------------------------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk(validEnvelope),
        verify: verifyAlwaysFalse,
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.deepEqual(r, { ok: false, reason: 'signature' });
    assert.equal(await cache.get(FIRMWARE_MANIFEST_CACHE_KEY), null);
}
{
    // Verifier throws → still reads as signature failure
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk(validEnvelope),
        verify: async () => { throw new Error('crypto subsystem unavailable'); },
        cache,
        url: URL,
        publicKey: PUBKEY,
    });
    assert.equal(r.reason, 'signature');
}

// --- 5. Happy path: fetch + verify + cache write ----------------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const r = await refreshFirmwareManifest({
        fetch: fetchOk(validEnvelope),
        verify: verifyAlwaysTrue,
        cache,
        url: URL,
        publicKey: PUBKEY,
        now: () => 1700000000000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'fetched');
    assert.deepEqual(r.manifest, validManifest);
    const entry = await cache.get(FIRMWARE_MANIFEST_CACHE_KEY);
    assert.ok(entry, 'cache populated');
    assert.equal(entry.fetchedAt, 1700000000000);
    assert.equal(entry.signature, 'base64-sig-here');
    assert.deepEqual(entry.manifest, validManifest);
}

// --- 6. Resolver prefers fresh cache ----------------------------------

{
    const now = 1700000000000;
    const cache = createInMemoryFirmwareManifestCache();
    await cache.put(FIRMWARE_MANIFEST_CACHE_KEY, {
        manifest: validManifest,
        signature: 'sig',
        fetchedAt: now - 60_000,                   // 1 minute ago
    });
    const v = await resolveActiveFirmwareManifest({
        cache,
        now: () => now,
        ttlMs: TTL_MS,
    });
    assert.equal(v.source, 'cache');
    assert.equal(v.fresh, true);
    assert.equal(v.fetchedAt, now - 60_000);
    assert.equal(v.ageMs, 60_000);
    assert.deepEqual(v.manifest, validManifest);
}

// --- 7. Resolver falls back to bundled when cache empty ---------------

{
    const cache = createInMemoryFirmwareManifestCache();
    const v = await resolveActiveFirmwareManifest({ cache, ttlMs: TTL_MS });
    assert.equal(v.source, 'bundled');
    assert.equal(v.fresh, false);
    assert.equal(v.fetchedAt, null);
    assert.equal(v.ageMs, null);
    assert.deepEqual(v.manifest, FIRMWARE_MANIFEST);
}

// --- 8. Resolver falls back to bundled when cache is stale -----------

{
    const now = 1700000000000;
    const cache = createInMemoryFirmwareManifestCache();
    await cache.put(FIRMWARE_MANIFEST_CACHE_KEY, {
        manifest: validManifest,
        signature: 'sig',
        fetchedAt: now - (TTL_MS + 1),             // 1ms past TTL
    });
    const v = await resolveActiveFirmwareManifest({
        cache,
        now: () => now,
        ttlMs: TTL_MS,
    });
    assert.equal(v.source, 'bundled', 'stale cache → bundled, no silent downgrade');
}

// --- 9. checkFirmware accepts optional manifest arg ------------------

{
    // Default (no manifest arg) → uses bundled, back-compat.
    const v = checkFirmware({ vendor: 'trezor', model: 'T1B1', version: '1.13.0' });
    assert.ok(['ok', 'outdated'].includes(v.status), 'bundled lookup works');

    // Explicit manifest arg with a knownVulnerable hit.
    const v2 = checkFirmware({
        vendor: 'trezor',
        model: 'T1B1',
        version: '1.11.2',
        manifest: validManifest,
    });
    assert.equal(v2.status, 'vulnerable');
    assert.match(v2.detail, /1\.11\.2/);

    // Manifest with no vendor → unknown.
    const v3 = checkFirmware({
        vendor: 'apple',
        model: 'whatever',
        version: '1.0',
        manifest: validManifest,
    });
    assert.equal(v3.status, 'unknown');
}

console.log(
    'OK — firmware-manifest-refresh smoke (Cluster N FOLLOWUP 1 — refreshFirmwareManifest no-ops on empty URL/key, surfaces network/schema/signature failures without writing cache; happy path verifies + writes cache; resolveActiveFirmwareManifest prefers fresh cache, falls back to bundled on empty/stale cache (no silent downgrade); checkFirmware accepts optional manifest arg)',
);
