// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The change flow's ordering and rollback, with every primitive faked. The
// real-crypto round trip (change, then unlock with both passwords) is in
// walletChangePasswordUnlock.test.js.

import { describe, expect, it, vi } from 'vitest';
import { changeWalletPassword } from '../../../packages/extension/src/background/createBackgroundHost.js';

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'c2FsdA==',
    iterations: 3,
    memory: 64 * 1024,
    parallelism: 1,
};

function setup({ vaultUnderOld = true } = {}) {
    const wallet = {
        id: 'wallet-1',
        encryptedSeed: 'ciphertext',
        kdfParams: KDF_PARAMS,
        importedKeys: [{ id: 'key-1', encryptedWif: 'sealed-wif' }],
    };
    const rekeyVault = vi.fn(async () => {});
    const put = vi.fn(async () => {});
    const evict = vi.fn();
    const unlockOne = vi.fn(async () => {});
    const commit = vi.fn(async () => {});
    const deps = {
        vault: {
            wallets: { get: vi.fn(async () => wallet), list: vi.fn(async () => [wallet]), put },
            keyMatches: vi.fn(() => vaultUnderOld),
            rekey: rekeyVault,
        },
        chainRegistry: {},
        sdkRegistry: {},
        signerPool: { evict, unlockOne },
        vaultKeyring: { kdfParams: vi.fn(async () => KDF_PARAMS), commit },
    };
    const keys = [];
    const deriveMasterKey = vi.fn(async () => {
        const k = new Uint8Array(32).fill(keys.length + 1);
        keys.push(k);
        return k;
    });
    return { deps, evict, put, wallet, rekeyVault, commit, unlockOne, deriveMasterKey, keys };
}

describe('changeWalletPassword', () => {
    it('never re-encrypts or writes when the current password is wrong', async () => {
        const { deps, put, rekeyVault, deriveMasterKey } = setup();
        const invalid = Object.assign(new Error('invalid'), { name: 'InvalidPasswordError' });
        const unlockWallet = vi.fn(async () => { throw invalid; });
        const rekeyWalletRecord = vi.fn();

        await expect(changeWalletPassword({
            walletId: 'wallet-1',
            currentPassword: 'wrong-password',
            newPassword: 'new-password',
        }, deps, { unlockWallet, rekeyWalletRecord, deriveMasterKey })).rejects.toBe(invalid);

        expect(rekeyWalletRecord).not.toHaveBeenCalled();
        expect(put).not.toHaveBeenCalled();
        expect(rekeyVault).not.toHaveBeenCalled();
    });

    it('re-seals a detached record and the vault key in one write, with unchanged KDF parameters', async () => {
        const { deps, rekeyVault, commit, unlockOne, wallet, deriveMasterKey, keys } = setup();
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
        }, deps, { unlockWallet, rekeyWalletRecord, deriveMasterKey }))
            .resolves.toEqual({ changed: true, vaultRekeyed: true, walletIds: ['wallet-1'] });

        expect(lock).toHaveBeenCalledTimes(1);
        expect(rekeyWalletRecord).toHaveBeenCalledWith(expect.not.objectContaining({
            encryptedSeed: wallet.encryptedSeed,
        }), {
            walletPassword: 'old-password',
            devicePassword: 'new-password',
            kdfParams: KDF_PARAMS,
        });
        expect(wallet.encryptedSeed).toBe('ciphertext');
        expect(deriveMasterKey).toHaveBeenNthCalledWith(1, 'old-password', KDF_PARAMS);
        expect(deriveMasterKey).toHaveBeenNthCalledWith(2, 'new-password', KDF_PARAMS);
        expect(rekeyVault).toHaveBeenCalledTimes(1);
        const [{ masterKey, wallets }] = rekeyVault.mock.calls[0];
        expect(masterKey).toBe(keys[1]);
        expect(wallets).toEqual([expect.objectContaining({ encryptedSeed: 'new-ciphertext', kdfParams: KDF_PARAMS })]);
        // previousKey is the old vault key, so the keyring moves its cache only
        // while the session slot still holds it (a lock clears that slot).
        expect(commit).toHaveBeenCalledWith({ masterKey: keys[1], password: 'new-password', previousKey: keys[0] });
        expect(unlockOne).toHaveBeenCalledWith(expect.objectContaining({ password: 'new-password' }));
        // Both derived keys are zeroed once the change is done.
        expect(keys.every((k) => k.every((b) => b === 0))).toBe(true);
    });

    it('leaves the vault key and the session caches alone when the vault is not under the old password', async () => {
        const { deps, rekeyVault, commit, deriveMasterKey } = setup({ vaultUnderOld: false });
        const rekeyWalletRecord = vi.fn(async () => true);

        await expect(changeWalletPassword({
            walletId: 'wallet-1', currentPassword: 'old-password', newPassword: 'new-password',
        }, deps, { unlockWallet: async () => ({ lock() {} }), rekeyWalletRecord, deriveMasterKey }))
            .resolves.toMatchObject({ vaultRekeyed: false });

        expect(deriveMasterKey).toHaveBeenCalledTimes(1);
        expect(rekeyVault.mock.calls[0][0].masterKey).toBeUndefined();
        expect(commit).not.toHaveBeenCalled();
    });

    it('leaves the stored record untouched when re-encryption fails part way', async () => {
        const { deps, evict, put, rekeyVault, commit, wallet, deriveMasterKey, keys } = setup();
        const before = JSON.stringify(wallet);
        const unlockWallet = vi.fn(async () => ({ lock: vi.fn() }));
        const rekeyWalletRecord = vi.fn(async (candidate) => {
            candidate.encryptedSeed = 'half-written';
            candidate.importedKeys[0].encryptedWif = 'half-written';
            throw new Error('encrypt failed');
        });

        await expect(changeWalletPassword({
            walletId: 'wallet-1',
            currentPassword: 'old-password',
            newPassword: 'new-password',
        }, deps, { unlockWallet, rekeyWalletRecord, deriveMasterKey })).rejects.toThrow('encrypt failed');

        expect(put).not.toHaveBeenCalled();
        expect(rekeyVault).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(evict).not.toHaveBeenCalled();
        expect(JSON.stringify(wallet)).toBe(before);
        expect(keys.every((k) => k.every((b) => b === 0))).toBe(true);
    });

    it('does not touch the session caches when the vault write fails', async () => {
        const { deps, rekeyVault, commit, unlockOne, deriveMasterKey } = setup();
        rekeyVault.mockRejectedValueOnce(new Error('disk full'));

        await expect(changeWalletPassword({
            walletId: 'wallet-1', currentPassword: 'old-password', newPassword: 'new-password',
        }, deps, {
            unlockWallet: async () => ({ lock() {} }),
            rekeyWalletRecord: async () => true,
            deriveMasterKey,
        })).rejects.toThrow('disk full');

        expect(commit).not.toHaveBeenCalled();
        expect(unlockOne).not.toHaveBeenCalled();
    });

    it('refuses before deriving or writing anything when the shell supplied no keyring', async () => {
        const { deps, rekeyVault, deriveMasterKey } = setup();
        const rekeyWalletRecord = vi.fn();
        await expect(changeWalletPassword({
            walletId: 'wallet-1', currentPassword: 'old-password', newPassword: 'new-password',
        }, { ...deps, vaultKeyring: undefined }, {
            unlockWallet: async () => ({ lock() {} }), rekeyWalletRecord, deriveMasterKey,
        })).rejects.toMatchObject({ name: 'PasswordChangeUnavailableError' });

        expect(deriveMasterKey).not.toHaveBeenCalled();
        expect(rekeyWalletRecord).not.toHaveBeenCalled();
        expect(rekeyVault).not.toHaveBeenCalled();
    });
});
