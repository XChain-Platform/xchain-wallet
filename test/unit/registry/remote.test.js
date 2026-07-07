// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Remote chain-registry sync (§9.7 / G007): signature verification against
// the pinned federation key, fail-closed rejection paths, and the additive
// hot-swap into ChainRegistry. Signatures are produced with node:crypto
// exactly the way the hub's ValidatorIdentity does (crypto.sign(null, utf8,
// ed25519Key) -> hex), so these tests also prove noble<->node interop.

import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
    verifyChainRegistry,
    syncChainRegistryFromHub,
    REGISTRY_SIGNING_DOMAIN,
} from '../../../packages/core/src/registry/remote.js';
import {
    ChainRegistry,
    defaultRegistry,
    BUNDLED_DESCRIPTORS,
} from '../../../packages/core/src/registry/index.js';

// A hub-style Ed25519 identity: raw 32-byte hex pubkey, hex signature over
// the utf8 payload (mirrors xchain-hub src/ValidatorIdentity.js).
function makeIdentity() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const pubkeyHex = spki.subarray(spki.length - 32).toString('hex');
    const sign = (payload) =>
        crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('hex');
    return { pubkeyHex, sign };
}

function signedBody(identity, descriptors, generatedAt = '2026-07-06T00:00:00.000Z') {
    const digest = crypto.createHash('sha256')
        .update(JSON.stringify(descriptors)).digest('hex');
    return {
        schema_version: 1,
        generatedAt,
        descriptors,
        signer_pubkey: identity.pubkeyHex,
        signature: identity.sign(`${REGISTRY_SIGNING_DOMAIN}|${generatedAt}|${digest}`),
    };
}

const fetchReturning = (body, status = 200) => async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
});

describe('registry/remote verifyChainRegistry', () => {
    const identity = makeIdentity();
    const descriptors = JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS));

    it('accepts a correctly signed payload from the pinned key', () => {
        const body = signedBody(identity, descriptors);
        const r = verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex });
        expect(r.ok).toBe(true);
    });

    it('pin check is case-insensitive on both sides', () => {
        const body = signedBody(identity, descriptors);
        body.signer_pubkey = body.signer_pubkey.toUpperCase();
        const r = verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex.toUpperCase() });
        expect(r.ok).toBe(true);
    });

    it('rejects a tampered descriptor set (signature no longer covers it)', () => {
        const body = signedBody(identity, descriptors);
        body.descriptors = JSON.parse(JSON.stringify(body.descriptors));
        body.descriptors[0].hub = { defaultUrl: 'https://evil.example', defaultPort: 443 };
        const r = verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex });
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/does not verify/);
    });

    it('rejects a tampered generatedAt (it is signed)', () => {
        const body = signedBody(identity, descriptors);
        body.generatedAt = '2027-01-01T00:00:00.000Z';
        expect(verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex }).ok).toBe(false);
    });

    it('rejects a valid signature from a NON-pinned key', () => {
        const rogue = makeIdentity();
        const body = signedBody(rogue, descriptors);   // internally consistent, wrong signer
        const r = verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex });
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/pinned/);
    });

    it('rejects an unsigned payload (fail closed, standalone hubs serve unsigned)', () => {
        const body = signedBody(identity, descriptors);
        delete body.signature;
        delete body.signer_pubkey;
        const r = verifyChainRegistry(body, { pinnedPubkeyHex: identity.pubkeyHex });
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/signature/);
    });

    it('rejects empty and malformed bodies', () => {
        expect(verifyChainRegistry(null).ok).toBe(false);
        expect(verifyChainRegistry({}).ok).toBe(false);
        expect(verifyChainRegistry({ descriptors: [] }).ok).toBe(false);
    });
});

describe('registry/remote syncChainRegistryFromHub', () => {
    const identity = makeIdentity();

    it('applies a verified registry: updates existing ids, adds new ones', async () => {
        const registry = new ChainRegistry();
        const descriptors = JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS));
        descriptors[0].explorer = { defaultUrl: 'https://explorer2.xchain.io/BTC', defaultPort: 443 };
        const extra = { ...descriptors.find((d) => d.id === 'bitcoin-mainnet'), id: 'bitcoin-mainnet-2', displayName: 'Bitcoin Alt' };
        descriptors.push(extra);

        const r = await syncChainRegistryFromHub({
            registry,
            pinnedPubkeyHex: identity.pubkeyHex,
            fetchImpl: fetchReturning(signedBody(identity, descriptors)),
        });
        expect(r.ok).toBe(true);
        expect(r.added).toEqual(['bitcoin-mainnet-2']);
        expect(r.updated).toContain(descriptors[0].id);
        expect(registry.get(descriptors[0].id).explorer.defaultUrl).toBe('https://explorer2.xchain.io/BTC');
        expect(registry.has('bitcoin-mainnet-2')).toBe(true);
        // The verified batch rides the ok result so multi-realm shells
        // (Electron main -> renderer) can re-apply it over IPC.
        expect(r.descriptors).toEqual(descriptors);
    });

    it('a failed verification leaves the registry untouched', async () => {
        const registry = new ChainRegistry();
        const before = registry.supportedChains().length;
        const rogue = makeIdentity();
        const descriptors = JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS));
        descriptors[0].displayName = 'Tampered';

        const r = await syncChainRegistryFromHub({
            registry,
            pinnedPubkeyHex: identity.pubkeyHex,
            fetchImpl: fetchReturning(signedBody(rogue, descriptors)),
        });
        expect(r.ok).toBe(false);
        expect(registry.supportedChains().length).toBe(before);
        expect(registry.get(descriptors[0].id).displayName).not.toBe('Tampered');
        // A rejected batch must not leak descriptors to IPC re-appliers.
        expect(r.descriptors).toBeUndefined();
    });

    it('rejects a signed batch containing an invalid descriptor (all-or-nothing)', async () => {
        const registry = new ChainRegistry();
        const descriptors = JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS));
        descriptors.push({ id: 'broken-chain' });      // fails validateChainDescriptor
        const r = await syncChainRegistryFromHub({
            registry,
            pinnedPubkeyHex: identity.pubkeyHex,
            fetchImpl: fetchReturning(signedBody(identity, descriptors)),
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/invalid descriptor/);
        expect(registry.has('broken-chain')).toBe(false);
    });

    it('HTTP errors and fetch failures fail soft', async () => {
        const registry = new ChainRegistry();
        expect((await syncChainRegistryFromHub({
            registry, fetchImpl: fetchReturning({}, 503),
        })).ok).toBe(false);
        expect((await syncChainRegistryFromHub({
            registry, fetchImpl: async () => { throw new Error('offline'); },
        })).ok).toBe(false);
    });
});

describe('ChainRegistry.applyRemoteDescriptors', () => {
    it('never clobbers a user-added custom chain on id collision', () => {
        const registry = new ChainRegistry();
        const custom = { ...BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest'), id: 'my-custom-chain', displayName: 'Mine' };
        registry.addCustom(custom);

        const remote = { ...custom, displayName: 'Remote Impostor' };
        const summary = registry.applyRemoteDescriptors([remote]);
        expect(summary.skipped).toEqual(['my-custom-chain']);
        expect(registry.get('my-custom-chain').displayName).toBe('Mine');
        expect(registry.get('my-custom-chain').isUserAdded).toBe(true);
    });

    it('is additive-only: nothing is ever removed', () => {
        const registry = new ChainRegistry();
        const before = registry.supportedChains().map((d) => d.id);
        registry.applyRemoteDescriptors([JSON.parse(JSON.stringify(BUNDLED_DESCRIPTORS[0]))]);
        const after = registry.supportedChains().map((d) => d.id);
        expect(after).toEqual(expect.arrayContaining(before));
    });
});

describe('defaultRegistry hot-swap', () => {
    it('is a shared singleton so applied descriptors reach every consumer', () => {
        const a = defaultRegistry();
        const b = defaultRegistry();
        expect(a).toBe(b);

        const patched = JSON.parse(JSON.stringify(
            BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet')));
        patched.explorer = { defaultUrl: 'https://swap-test.invalid/BTC', defaultPort: 443 };
        a.applyRemoteDescriptors([patched]);
        expect(b.get('bitcoin-mainnet').explorer.defaultUrl).toBe('https://swap-test.invalid/BTC');

        // Restore the shared instance for any suite that runs after this one.
        a.applyRemoteDescriptors([JSON.parse(JSON.stringify(
            BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet')))]);
    });
});
