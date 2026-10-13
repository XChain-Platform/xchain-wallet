// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { changeWalletPassword } from '../../../packages/extension/src/background/createBackgroundHost.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'c2FsdA==',
    iterations: 3,
    memory: 64 * 1024,
    parallelism: 1,
};

function setup() {
    const wallet = {
        id: 'wallet-1',
        encryptedSeed: 'ciphertext',
        kdfParams: KDF_PARAMS,
        importedKeys: [{ id: 'key-1', encryptedWif: 'sealed-wif' }],
    };
    const put = vi.fn(async () => {});
    const evict = vi.fn();
    const deps = {
        vault: { wallets: { get: vi.fn(async () => wallet), put } },
        chainRegistry: {},
        sdkRegistry: {},
        signerPool: { evict },
    };
    return { deps, evict, put, wallet };
}

describe('changeWalletPassword', () => {
    it('never re-encrypts or writes when the current password is wrong', async () => {
        const { deps, put } = setup();
        const invalid = Object.assign(new Error('invalid'), { name: 'InvalidPasswordError' });
        const unlockWallet = vi.fn(async () => { throw invalid; });
        const rekeyWalletRecord = vi.fn();

        await expect(changeWalletPassword({
            walletId: 'wallet-1',
            currentPassword: 'wrong-password',
            newPassword: 'new-password',
        }, deps, { unlockWallet, rekeyWalletRecord })).rejects.toBe(invalid);

        expect(rekeyWalletRecord).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
    });

    it('re-encrypts a detached record with unchanged KDF parameters', async () => {
        const { deps, evict, put, wallet } = setup();
        const lock = vi.fn();
        const unlockWallet = vi.fn(async () => ({ lock }));
        const rekeyWalletRecord = vi.fn(async (candidate) => {
            candidate.encryptedSeed = 'new-ciphertext';
            return true;
        });

        await expect(changeWalletPassword({
            walletId: 'wallet-1',
            currentPassword: 'old-password',
            newPassword: 'new-password',
        }, deps, { unlockWallet, rekeyWalletRecord })).resolves.toEqual({ changed: true });

        expect(lock).toHaveBeenCalledTimes(1);
        expect(rekeyWalletRecord).toHaveBeenCalledWith(expect.not.objectContaining({
            encryptedSeed: wallet.encryptedSeed,
        }), {
            walletPassword: 'old-password',
            devicePassword: 'new-password',
            kdfParams: KDF_PARAMS,
        });
        expect(wallet.encryptedSeed).toBe('ciphertext');
        expect(put).toHaveBeenCalledWith(expect.objectContaining({
            encryptedSeed: 'new-ciphertext',
            kdfParams: KDF_PARAMS,
        }));
        expect(evict).toHaveBeenCalledWith('wallet-1');
    });
});
