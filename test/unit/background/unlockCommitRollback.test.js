// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

let openBehaviour = async () => {};

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(3) },
        storage: {
            ...actual.storage,
            Vault: class ScriptedVault {
                async open() { return openBehaviour(); }
                close() {}
            },
        },
    };
});

const core = await import('@xchain-wallet/core');
const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');

function slotBackend(saveError = null, clearError = null) {
    let value = null;
    return {
        save: vi.fn(async (next) => {
            value = new Uint8Array(next);
            if (saveError) throw saveError;
        }),
        load: vi.fn(async () => value),
        clear: vi.fn(async () => {
            value = null;
            if (clearError) throw clearError;
        }),
    };
}

function makeDeps({ sessionBackend = slotBackend(), signingSecretBackend = slotBackend() } = {}) {
    return {
        storageBackend: {},
        sessionBackend,
        signingSecretBackend,
        metaBackend: { load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) },
        signerPool: {
            populate: vi.fn(async () => ({
                passphraseCaptureNeeded: [], passphraseCaptureNames: [],
                passphraseMismatch: [], passphraseMatched: [],
            })),
            lockAll: vi.fn(),
        },
        chainRegistry: {},
        sdkRegistry: {},
        onUnlocked: vi.fn(),
    };
}

beforeEach(() => { openBehaviour = async () => {}; });

describe('wallet.unlock commit rollback', () => {
    it('clears the session and signer pool when the signing-secret save fails', async () => {
        const failure = new Error('secret storage failed');
        const deps = makeDeps({ signingSecretBackend: slotBackend(failure) });

        await expect(handleWalletUnlock({ password: 'password' }, deps)).rejects.toBe(failure);

        expect(deps.signerPool.lockAll).toHaveBeenCalledOnce();
        expect(await deps.sessionBackend.load()).toBeNull();
        expect(await deps.signingSecretBackend.load()).toBeNull();
        expect(deps.onUnlocked).not.toHaveBeenCalled();
    });

    it('clears every slot when the session save fails after caching bytes', async () => {
        const failure = new Error('session storage failed');
        const deps = makeDeps({ sessionBackend: slotBackend(failure) });

        await expect(handleWalletUnlock({ password: 'password' }, deps)).rejects.toBe(failure);

        expect(deps.signerPool.lockAll).toHaveBeenCalledOnce();
        expect(await deps.sessionBackend.load()).toBeNull();
        expect(deps.signingSecretBackend.clear).toHaveBeenCalledOnce();
    });

    it('preserves the commit error when one rollback step also fails', async () => {
        const failure = new Error('secret storage failed');
        const clearFailure = new Error('session clear failed');
        const deps = makeDeps({
            sessionBackend: slotBackend(null, clearFailure),
            signingSecretBackend: slotBackend(failure),
        });
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});

        await expect(handleWalletUnlock({ password: 'password' }, deps)).rejects.toBe(failure);

        expect(deps.signerPool.lockAll).toHaveBeenCalledOnce();
        expect(deps.signingSecretBackend.clear).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(
            '[xchain] wallet.unlock rollback: sessionBackend.clear failed:', clearFailure,
        );
    });

    it('does not clear an existing session for a wrong password', async () => {
        openBehaviour = async () => {
            throw new core.crypto.AeadAuthError(new Error('aes/gcm: invalid ghash tag'));
        };
        const deps = makeDeps();

        await expect(handleWalletUnlock({ password: 'wrong' }, deps))
            .rejects.toMatchObject({ name: 'InvalidPasswordError' });

        expect(deps.signerPool.lockAll).not.toHaveBeenCalled();
        expect(deps.sessionBackend.clear).not.toHaveBeenCalled();
        expect(deps.signingSecretBackend.clear).not.toHaveBeenCalled();
    });

    it('keeps the successful commit path unchanged', async () => {
        const deps = makeDeps();

        await expect(handleWalletUnlock({ password: 'password' }, deps))
            .resolves.toMatchObject({ unlocked: true });

        expect(deps.onUnlocked).toHaveBeenCalledOnce();
        expect(deps.sessionBackend.clear).not.toHaveBeenCalled();
        expect(deps.signingSecretBackend.clear).not.toHaveBeenCalled();
    });
});
