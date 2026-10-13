// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { FIRMWARE_MANIFEST } from '../../../packages/core/src/signers/firmware-manifest.js';
import {
    FIRMWARE_MANIFEST_CACHE_KEY,
    createInMemoryFirmwareManifestCache,
    refreshFirmwareManifest,
    resolveActiveFirmwareManifest,
} from '../../../packages/core/src/flows/firmwareManifestRefresh.js';

const manifest = {
    schema: 'firmware-manifest/1',
    generatedAt: '2026-10-13',
    vendors: {},
};

describe('refreshFirmwareManifest', () => {
    it('verifies the fetched envelope before committing it to the cache', async () => {
        const envelope = { manifest, signature: 'signed-payload' };
        const fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => envelope,
        });
        const verify = vi.fn().mockResolvedValue(true);
        const cache = createInMemoryFirmwareManifestCache();

        await expect(refreshFirmwareManifest({
            fetch,
            verify,
            cache,
            url: 'https://example.test/manifest.json',
            publicKey: 'public-key',
            now: () => 1234,
        })).resolves.toEqual({ ok: true, manifest, source: 'fetched' });

        expect(fetch).toHaveBeenCalledWith('https://example.test/manifest.json', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        expect(verify).toHaveBeenCalledWith(envelope, 'public-key');
        await expect(cache.get(FIRMWARE_MANIFEST_CACHE_KEY)).resolves.toEqual({
            manifest,
            signature: 'signed-payload',
            fetchedAt: 1234,
        });
    });

    it.each([
        [{ manifest: { schema: 'firmware-manifest/2' }, signature: 'sig' }, 'schema'],
        [{ manifest, signature: '' }, 'schema'],
    ])('rejects malformed envelope %# without writing cache', async (envelope, reason) => {
        const cache = { put: vi.fn() };

        const result = await refreshFirmwareManifest({
            fetch: async () => ({ ok: true, json: async () => envelope }),
            verify: vi.fn().mockResolvedValue(true),
            cache,
            url: 'https://example.test/manifest.json',
            publicKey: 'public-key',
        });

        expect(result).toEqual({ ok: false, reason });
        expect(cache.put).not.toHaveBeenCalled();
    });

    it('treats a verifier exception as a signature failure and preserves cache', async () => {
        const cache = { put: vi.fn() };

        const result = await refreshFirmwareManifest({
            fetch: async () => ({
                ok: true,
                json: async () => ({ manifest, signature: 'sig' }),
            }),
            verify: async () => { throw new Error('crypto unavailable'); },
            cache,
            url: 'https://example.test/manifest.json',
            publicKey: 'public-key',
        });

        expect(result).toEqual({ ok: false, reason: 'signature' });
        expect(cache.put).not.toHaveBeenCalled();
    });
});

describe('resolveActiveFirmwareManifest', () => {
    it('accepts a cache entry at the TTL boundary', async () => {
        const cache = createInMemoryFirmwareManifestCache();
        await cache.put(FIRMWARE_MANIFEST_CACHE_KEY, {
            manifest,
            signature: 'sig',
            fetchedAt: 1000,
        });

        await expect(resolveActiveFirmwareManifest({
            cache,
            now: () => 2000,
            ttlMs: 1000,
        })).resolves.toEqual({
            manifest,
            source: 'cache',
            fetchedAt: 1000,
            ageMs: 1000,
            fresh: true,
        });
    });

    it.each([
        ['future entry', { get: async () => ({ manifest, fetchedAt: 2001 }) }],
        ['cache read failure', { get: async () => { throw new Error('cache unavailable'); } }],
    ])('falls back to the bundled manifest for a %s', async (_scenario, cache) => {
        await expect(resolveActiveFirmwareManifest({
            cache,
            now: () => 2000,
            ttlMs: 1000,
        })).resolves.toEqual({
            manifest: FIRMWARE_MANIFEST,
            source: 'bundled',
            fetchedAt: null,
            ageMs: null,
            fresh: false,
        });
    });
});
