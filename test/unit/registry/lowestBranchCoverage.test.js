// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActionDataOfferedInBuild } from '../../../packages/core/src/registry/actions.js';
import {
    nativeDecimalsFor,
    tickerForDescriptor,
} from '../../../packages/core/src/registry/coinTicker.js';
import { bitcoinDescriptors } from '../../../packages/core/src/registry/descriptors/bitcoin.js';
import { hydrateCustomChainsFromSettings } from '../../../packages/core/src/registry/hydrateCustomChains.js';
import {
    REGISTRY_SIGNING_DOMAIN,
    syncChainRegistryFromHub,
    verifyChainRegistry,
} from '../../../packages/core/src/registry/remote.js';
import { validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

function identity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    return {
        privateKey,
        pubkeyHex: spki.subarray(spki.length - 32).toString('hex'),
    };
}

function signedBody(signer, descriptors) {
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

function fetchReturning(body) {
    return vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('lowest registry branch coverage', () => {
    it('rejects a top-level DEX action when the build omits the DEX surface', () => {
        expect(isActionDataOfferedInBuild(
            { action: 'swap', params: {} },
            { hasDexSurface: false },
        )).toBe(false);
    });

    it('uses safe ticker defaults for absent descriptor metadata', () => {
        expect(nativeDecimalsFor({})).toBe(8);
        expect(nativeDecimalsFor(null)).toBe(8);
        expect(tickerForDescriptor(null)).toBe('');
    });

    it('preserves primitive signature verification errors', () => {
        const signer = identity();
        const body = signedBody(signer, [structuredClone(bitcoinDescriptors[0])]);
        vi.spyOn(ed25519, 'verify').mockImplementationOnce(() => {
            throw 'primitive verification failure';
        });

        expect(verifyChainRegistry(body, { pinnedPubkeyHex: signer.pubkeyHex })).toEqual({
            ok: false,
            reason: 'signature verification error: primitive verification failure',
        });
    });

    it('uses global fetch when no implementation is supplied', async () => {
        const signer = identity();
        const descriptors = [structuredClone(bitcoinDescriptors[0])];
        const fetchMock = fetchReturning(signedBody(signer, descriptors));
        const registry = {
            applyRemoteDescriptors: vi.fn(() => ({ added: [], updated: ['bitcoin-mainnet'], skipped: [] })),
        };
        vi.stubGlobal('fetch', fetchMock);

        const result = await syncChainRegistryFromHub({
            registry,
            pinnedPubkeyHex: signer.pubkeyHex,
        });

        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('reports primitive fetch failures and descriptors without ids', async () => {
        expect(await syncChainRegistryFromHub({
            registry: {},
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                json: async () => { throw 'offline'; },
            }),
        })).toEqual({ ok: false, reason: 'registry fetch failed: offline' });

        const signer = identity();
        const result = await syncChainRegistryFromHub({
            registry: {},
            pinnedPubkeyHex: signer.pubkeyHex,
            fetchImpl: fetchReturning(signedBody(signer, [null])),
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/^invalid descriptor "\?":/);
    });

    it('rejects empty derivation keys, non-string templates, and empty ids', () => {
        const base = structuredClone(bitcoinDescriptors[0]);
        const emptyKey = validateChainDescriptor({
            ...base,
            derivationPaths: { '': "m/44'/0'/A'/C/I" },
        });
        expect(emptyKey.errors).toContain('derivationPaths: malformed');

        const nonStringTemplate = validateChainDescriptor({
            ...base,
            derivationPaths: { p2pkh: null },
        });
        expect(nonStringTemplate.errors).toContain('derivationPaths: malformed');

        const emptyId = validateChainDescriptor({ ...base, id: '' });
        expect(emptyId.errors).toContain('id: must be a non-empty string');
    });

    it('continues hydrating after a registry adapter rejects one row', () => {
        const registry = {
            has: vi.fn(() => false),
            addCustom: vi.fn()
                .mockImplementationOnce(() => { throw new Error('rejected'); })
                .mockImplementationOnce(() => undefined),
        };

        expect(hydrateCustomChainsFromSettings(registry, {
            customChains: [{ id: 'rejected' }, { id: 'accepted' }],
        })).toEqual({ added: ['accepted'] });
        expect(registry.addCustom).toHaveBeenCalledTimes(2);
    });
});
