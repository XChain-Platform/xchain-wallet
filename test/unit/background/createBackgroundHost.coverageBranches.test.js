// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    changeWalletPassword,
    PasswordChangeConflictError,
    PasswordChangeUnavailableError,
} from '../../../packages/extension/src/background/createBackgroundHost.js';

const VALID_REQUEST = {
    walletId: 'wallet-1',
    currentPassword: 'old-password',
    newPassword: 'new-password',
};

function makeChangeHarness(overrides = {}) {
    const wallet = { id: 'wallet-1', kdfParams: { salt: 'salt' }, importedKeys: [] };
    const oldKey = new Uint8Array([1, 2]);
    const newKey = new Uint8Array([3, 4]);
    const deps = {
        vault: {
            isOpen: true,
            wallets: {
                get: vi.fn(async () => wallet),
                list: vi.fn(async () => [wallet]),
            },
            keyMatches: vi.fn(() => true),
            rekey: vi.fn(async () => true),
        },
        chainRegistry: {},
        sdkRegistry: {},
        vaultKeyring: {
            kdfParams: vi.fn(async () => ({ salt: 'vault-salt' })),
            commit: vi.fn(async () => {}),
        },
        signerPool: {
            unlockOne: vi.fn(async () => {}),
            evict: vi.fn(),
        },
        ...overrides,
    };
    const operations = {
        unlockWallet: vi.fn(async () => ({ lock: () => {} })),
        rekeyWalletRecord: vi.fn(async () => true),
        deriveMasterKey: vi.fn()
            .mockResolvedValueOnce(oldKey)
            .mockResolvedValueOnce(newKey),
    };
    return { deps, operations, wallet, oldKey, newKey };
}

describe('background host password change edge branches', () => {
    it.each([
        [{}, /walletId is required/],
        [{ walletId: 'wallet-1' }, /currentPassword is required/],
        [{ walletId: 'wallet-1', currentPassword: 'old-password' }, /newPassword is required/],
        [{ ...VALID_REQUEST, newPassword: 'short' }, /at least 8 characters/],
        [{ ...VALID_REQUEST, newPassword: 'old-password' }, /differs/],
    ])('validates the request before reading the vault', async (request, expected) => {
        await expect(changeWalletPassword(request, {})).rejects.toThrow(expected);
    });

    it('reports a missing wallet', async () => {
        const { deps, operations } = makeChangeHarness();
        deps.vault.wallets.get.mockResolvedValue(null);

        await expect(changeWalletPassword(VALID_REQUEST, deps, operations))
            .rejects.toThrow('Wallet not found: wallet-1');
    });

    it('contains signer cleanup failures and requires a committing keyring', async () => {
        const { deps, operations } = makeChangeHarness();
        operations.unlockWallet.mockResolvedValue({ lock: () => { throw new Error('cleanup failed'); } });
        deps.vaultKeyring.commit = undefined;

        await expect(changeWalletPassword(VALID_REQUEST, deps, operations))
            .rejects.toBeInstanceOf(PasswordChangeUnavailableError);
    });

    it('rejects records without password-protected material and clears derived keys', async () => {
        const { deps, operations, oldKey } = makeChangeHarness();
        operations.rekeyWalletRecord.mockResolvedValue(false);

        await expect(changeWalletPassword(VALID_REQUEST, deps, operations))
            .rejects.toThrow('no password-protected key material');
        expect([...oldKey]).toEqual([0, 0]);
    });

    it('maps a vault write conflict to the public conflict error', async () => {
        const { deps, operations, oldKey, newKey } = makeChangeHarness();
        deps.vault.rekey.mockRejectedValue(Object.assign(new Error('stale'), { name: 'VaultConflictError' }));

        await expect(changeWalletPassword(VALID_REQUEST, deps, operations))
            .rejects.toBeInstanceOf(PasswordChangeConflictError);
        expect([...oldKey]).toEqual([0, 0]);
        expect([...newKey]).toEqual([0, 0]);
    });
});
