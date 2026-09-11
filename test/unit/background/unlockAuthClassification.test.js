// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Only a real AEAD tag mismatch is a wrong password.
//
// Sniffing error TEXT (/operation[- ]?error|auth|tag/i over err.message) does
// not decide it: any backend message containing "auth" satisfies that, as does
// "tag" inside an ordinary word such as "staging". Nor may the catch span the
// SignerPool populate block, where a PassphraseMismatchError quoting a
// user-chosen wallet name matches the same regex. Either shape raises
// "Incorrect password" AND charges the lockout ladder for a password that was
// never wrong.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let openBehaviour = async () => { };

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(3) },
        storage: {
            ...actual.storage,
            Vault: class ScriptedVault {
                async open() { return openBehaviour(); }
                close() { /* nothing to zero */ }
            },
        },
    };
});

const core = await import('@xchain-wallet/core');
const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');

function makeThrottleStore() {
    const store = { state: null, saves: 0 };
    return {
        store,
        async load() { return store.state ? { ...store.state } : null; },
        async save(next) { store.saves += 1; store.state = { ...next }; },
        async clear() { store.state = null; },
    };
}

function makeDeps(throttle, extra = {}) {
    return {
        storageBackend: {},
        sessionBackend: { save: vi.fn(async () => { }) },
        signingSecretBackend: { save: vi.fn(async () => { }) },
        metaBackend: { load: async () => ({ kdfParams: { salt: 'x', memory: 1, iterations: 1, parallelism: 1 } }) },
        unlockThrottleStore: throttle,
        ...extra,
    };
}

describe('wallet.unlock failure classification', () => {
    let throttle;
    beforeEach(() => {
        throttle = makeThrottleStore();
        openBehaviour = async () => { };
    });

    it('charges a real tag mismatch as a wrong password', async () => {
        openBehaviour = async () => {
            throw new core.crypto.AeadAuthError(new Error('aes/gcm: invalid ghash tag'));
        };

        await expect(handleWalletUnlock({ password: 'nope' }, makeDeps(throttle)))
            .rejects.toMatchObject({ name: 'InvalidPasswordError' });
        expect(throttle.store.state.failCount).toBe(1);
    });

    it('propagates a storage fault whose message merely contains "tag"', async () => {
        // "s-tag-ing": the old regex matched this and called it a bad password.
        openBehaviour = async () => { throw new Error('staging backend unavailable'); };

        await expect(handleWalletUnlock({ password: 'right' }, makeDeps(throttle)))
            .rejects.toThrow(/staging backend unavailable/);
        expect(throttle.store.saves).toBe(0);
        expect(throttle.store.state).toBeNull();
    });

    it('propagates an unsupported-document fault without charging an attempt', async () => {
        openBehaviour = async () => {
            throw new Error('codec: unsupported documentVersion 2 (expected 1)');
        };

        await expect(handleWalletUnlock({ password: 'right' }, makeDeps(throttle)))
            .rejects.toThrow(/documentVersion/);
        expect(throttle.store.saves).toBe(0);
    });

    it('leaves a passphrase mismatch as itself, even when a wallet name matches the old regex', async () => {
        const signerPool = {
            populate: async () => ({
                passphraseCaptureNeeded: [],
                passphraseCaptureNames: [],
                passphraseMismatch: ['w1'],
                passphraseMismatchNames: ['Staging Vault'],
                passphraseMatched: [],
            }),
            lockAll: vi.fn(),
        };

        await expect(handleWalletUnlock(
            { password: 'right', bip39Passphrase: 'mistyped' },
            makeDeps(throttle, { signerPool, chainRegistry: {}, sdkRegistry: {} }),
        )).rejects.toMatchObject({ name: 'PassphraseMismatchError' });

        expect(signerPool.lockAll).toHaveBeenCalled();
        expect(throttle.store.saves).toBe(0);
    });
});
