// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    REGISTRY_SIGNING_DOMAIN,
    syncChainRegistryFromHub,
    verifyChainRegistry,
} from '../../../packages/core/src/registry/remote.js';
import {
    BUNDLED_DESCRIPTORS,
    ChainRegistry,
} from '../../../packages/core/src/registry/index.js';

function identity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    return {
        privateKey,
        pubkeyHex: spki.subarray(spki.length - 32).toString('hex'),
    };
}

function signedBody(signer, descriptors = structuredClone(BUNDLED_DESCRIPTORS)) {
    const generatedAt = '2026-10-13T12:00:00.000Z';
    const digest = crypto.createHash('sha256').update(JSON.stringify(descriptors)).digest('hex');
    const payload = `${REGISTRY_SIGNING_DOMAIN}|${generatedAt}|${digest}`;
    return {
        schema_version: 1,
        generatedAt,
        descriptors,
        signer_pubkey: signer.pubkeyHex,
        signature: crypto.sign(null, Buffer.from(payload), signer.privateKey).toString('hex'),
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('remote registry error and edge branches', () => {
    it('rejects each malformed signed-envelope field', () => {
        const signer = identity();
        const valid = signedBody(signer);
        for (const [change, reason] of [
            [{ descriptors: 'not-an-array' }, 'no descriptors in response'],
            [{ descriptors: [] }, 'no descriptors in response'],
            [{ generatedAt: '2026-99-99T12:00:00.000Z' }, 'missing or malformed generatedAt'],
            [{ signature: 42 }, 'missing or malformed signature'],
            [{ signature: 'aa' }, 'missing or malformed signature'],
            [{ signer_pubkey: 42 }, 'signer is not the pinned federation key'],
        ]) {
            expect(verifyChainRegistry({ ...valid, ...change }, { pinnedPubkeyHex: signer.pubkeyHex }))
                .toEqual({ ok: false, reason });
        }
    });

    it('returns a verification error when hex decoding throws', () => {
        const signer = identity();
        const body = signedBody(signer);
        body.signer_pubkey = 'zz';
        const result = verifyChainRegistry(body, { pinnedPubkeyHex: 'zz' });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/^signature verification error:/);
    });

    it('fails before fetching when registry or fetch support is absent', async () => {
        const fetchImpl = vi.fn();
        expect(await syncChainRegistryFromHub({ fetchImpl }))
            .toEqual({ ok: false, reason: 'no registry instance' });
        expect(fetchImpl).not.toHaveBeenCalled();

        vi.stubGlobal('fetch', undefined);
        expect(await syncChainRegistryFromHub({ registry: new ChainRegistry() }))
            .toEqual({ ok: false, reason: 'no fetch implementation available' });
    });

    it('reports response parsing failures without mutating the registry', async () => {
        const registry = new ChainRegistry();
        const before = registry.supportedChains();
        const result = await syncChainRegistryFromHub({
            registry,
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => { throw new SyntaxError('invalid json'); },
            }),
        });
        expect(result).toEqual({ ok: false, reason: 'registry fetch failed: invalid json' });
        expect(registry.supportedChains()).toEqual(before);
    });

    it('returns exact HTTP and verification failures without applying a batch', async () => {
        const registry = new ChainRegistry();
        expect(await syncChainRegistryFromHub({
            registry,
            fetchImpl: async () => ({ ok: false, status: 400 }),
        })).toEqual({ ok: false, reason: 'registry endpoint returned HTTP 400' });

        expect(await syncChainRegistryFromHub({
            registry,
            fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
        })).toEqual({ ok: false, reason: 'unsupported registry schema version' });
        expect(registry.getVersion()).toBe(0);
    });
});
