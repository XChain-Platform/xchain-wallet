// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';

const state = vi.hoisted(() => ({
    /** @type {Uint8Array[]} every key the KDF handed out */
    issued: [],
}));

function fakeKey(password, params, base64ToBytes) {
    const h = createHash('sha256');
    h.update(password);
    h.update(base64ToBytes(params.salt));
    h.update(`${params.iterations}:${params.memory}:${params.parallelism}`);
    return new Uint8Array(h.digest());
}

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => {
    const actual = await importOriginal();
    const derive = (password, params) => {
        actual.validateKdfParams(params);
        const key = fakeKey(password, params, actual.base64ToBytes);
        state.issued.push(key);
        return key;
    };
    return {
        ...actual,
        deriveMasterKey: derive,
        deriveMasterKeyAsync: async (password, params) => derive(password, params),
    };
});

const core = await import('@xchain-wallet/core');
const { dispatchPreHost } = await import('../../../packages/extension/src/background/sessionMeta.js');

const PASSWORD = 'correct horse battery';
const zeroed = (key) => key.every((byte) => byte === 0);

describe('extension wallet creation derives the master key once', () => {
    it('shares the vault key with the wallet seal and signer pool, then zeros it', async () => {
        const storageBackend = new core.storage.InMemoryBackend();
        const chainRegistry = core.registry.defaultRegistry();
        const sdkRegistry = new core.sdk.SDKRegistry({
            chainRegistry,
            sdkFactory: ({ network }) => ({
                wallet: {
                    deriveAddress: (publicKeyHex, opts) => (
                        core.sdk.mockDeriveAddress(network, opts?.type, publicKeyHex)
                    ),
                },
            }),
        });
        const signerPool = new core.signers.SignerPool();
        let meta = null;
        let sessionKey = null;
        const onUnlocked = vi.fn(() => {
            expect(state.issued).toHaveLength(1);
            expect(state.issued.every(zeroed)).toBe(true);
            expect(signerPool.size()).toBe(1);
        });

        try {
            const result = await dispatchPreHost('wallet.create', {
                password: PASSWORD,
                activeChainIds: [core.registry.DEFAULT_ONBOARDING_CHAIN_IDS[0]],
            }, {
                storageBackend,
                sessionBackend: {
                    load: async () => sessionKey,
                    save: async (key) => { sessionKey = new Uint8Array(key); },
                    clear: async () => { sessionKey = null; },
                },
                metaBackend: {
                    load: async () => meta,
                    save: async (next) => { meta = next; },
                    clear: async () => { meta = null; },
                },
                chainRegistry,
                sdkRegistry,
                signerPool,
                onUnlocked,
            });

            expect(result.mnemonic.trim().split(/\s+/)).toHaveLength(12);
            expect(state.issued).toHaveLength(1);
            expect(state.issued.every(zeroed)).toBe(true);
            expect(sessionKey).toBeInstanceOf(Uint8Array);
            expect(zeroed(sessionKey)).toBe(false);
            expect(onUnlocked).toHaveBeenCalledTimes(1);
        } finally {
            signerPool.lockAll();
            sessionKey?.fill(0);
            state.issued.length = 0;
        }
    });

    it('a failure after pooling locks the pool again: no signer outlives a failed create', async () => {
        const chainRegistry = core.registry.defaultRegistry();
        const sdkRegistry = new core.sdk.SDKRegistry({
            chainRegistry,
            sdkFactory: ({ network }) => ({
                wallet: {
                    deriveAddress: (publicKeyHex, opts) => (
                        core.sdk.mockDeriveAddress(network, opts?.type, publicKeyHex)
                    ),
                },
            }),
        });
        const signerPool = new core.signers.SignerPool();
        const onUnlocked = vi.fn();
        let sessionKey = null;

        try {
            await expect(dispatchPreHost('wallet.create', {
                password: PASSWORD,
                activeChainIds: [core.registry.DEFAULT_ONBOARDING_CHAIN_IDS[0]],
            }, {
                storageBackend: new core.storage.InMemoryBackend(),
                sessionBackend: {
                    load: async () => sessionKey,
                    save: async (key) => { sessionKey = new Uint8Array(key); },
                    clear: async () => { sessionKey = null; },
                },
                metaBackend: {
                    load: async () => null,
                    save: async () => { throw new Error('meta write refused'); },
                    clear: async () => {},
                },
                chainRegistry,
                sdkRegistry,
                signerPool,
                onUnlocked,
            })).rejects.toThrow('meta write refused');

            expect(signerPool.size()).toBe(0);
            expect(sessionKey).toBeNull();
            expect(onUnlocked).not.toHaveBeenCalled();
            expect(state.issued).toHaveLength(1);
            expect(state.issued.every(zeroed)).toBe(true);
        } finally {
            signerPool.lockAll();
            state.issued.length = 0;
        }
    });
});
