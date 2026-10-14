// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWalletRecord: vi.fn(),
}));

import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';
import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';

const REGISTRIES = { chainRegistry: {}, sdkRegistry: {} };
const WALLET = {
    id: 'wallet-1',
    passphraseEnabled: true,
    encryptedPassphrase: null,
};

function fakeSigner(overrides = {}) {
    return {
        locked: false,
        lock() { this.locked = true; },
        ...overrides,
    };
}

function ownershipVault(overrides = {}) {
    return {
        wallets: { list: async () => [{ ...WALLET }] },
        accounts: { findBy: async () => [{ id: 'account-1' }] },
        addresses: { findBy: async () => [{
            derivationPath: "m/84'/0'/0'/0/0",
            publicKey: '02aa',
        }] },
        ...overrides,
    };
}

beforeEach(() => {
    vi.mocked(unlockWalletRecord).mockReset();
});

describe('SignerPool low-coverage branches', () => {
    it('accepts ownership as unverifiable when a signer cannot derive public keys', async () => {
        const signer = fakeSigner();
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);

        const summary = await new SignerPool().populate({
            vault: ownershipVault(),
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        });

        expect(summary).toMatchObject({
            pooled: ['wallet-1'],
            passphraseMatched: ['wallet-1'],
        });
    });

    it('uses empty display names in capture and mismatch summaries', async () => {
        const capture = await new SignerPool().populate({
            vault: { wallets: { list: async () => [{ ...WALLET }] } },
            password: 'pw',
            ...REGISTRIES,
        });
        expect(capture.passphraseCaptureNames).toEqual(['']);

        vi.mocked(unlockWalletRecord).mockResolvedValue(fakeSigner({
            getPublicKey: async () => ({ publicKey: '03bb' }),
        }));
        const mismatch = await new SignerPool().populate({
            vault: ownershipVault(),
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        });
        expect(mismatch.passphraseMismatchNames).toEqual(['']);
    });

    it('stops without recording a skipped wallet when the session ends during unlock', async () => {
        let rejectUnlock;
        vi.mocked(unlockWalletRecord).mockImplementation(() => new Promise((resolve, reject) => {
            rejectUnlock = reject;
        }));
        const pool = new SignerPool();
        const pending = pool.populate({
            vault: { wallets: { list: async () => [{ id: 'wallet-1' }] } },
            password: 'pw',
            ...REGISTRIES,
        });
        await vi.waitFor(() => expect(rejectUnlock).toBeTypeOf('function'));

        pool.lockAll();
        rejectUnlock(new Error('late failure'));

        await expect(pending).resolves.toMatchObject({ skipped: [] });
    });

    it('locks a signer when the session ends during ownership verification', async () => {
        let finishDerivation;
        const signer = fakeSigner({
            getPublicKey: () => new Promise((resolve) => { finishDerivation = resolve; }),
        });
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);
        const pool = new SignerPool();
        const pending = pool.populate({
            vault: ownershipVault(),
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        });
        await vi.waitFor(() => expect(finishDerivation).toBeTypeOf('function'));

        pool.lockAll();
        finishDerivation({ publicKey: '02aa' });

        await expect(pending).resolves.toMatchObject({ pooled: [], passphraseMatched: [] });
        expect(signer.locked).toBe(true);
    });

    it('cancels capture when invalidated while encrypting the passphrase', async () => {
        const pool = new SignerPool();
        const signer = fakeSigner({
            getPublicKey: async () => ({ publicKey: '02aa' }),
            getMasterKey: () => {
                pool.evict('wallet-1');
                return new Uint8Array(32).fill(7);
            },
        });
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);
        const vault = ownershipVault({ wallets: { put: vi.fn() } });

        await expect(pool.captureOne({
            vault,
            wallet: { ...WALLET },
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        })).rejects.toThrow('signer unlock was cancelled');
        expect(vault.wallets.put).not.toHaveBeenCalled();
        expect(signer.locked).toBe(true);
    });

    it('cancels capture when invalidated during persistence', async () => {
        const pool = new SignerPool();
        const signer = fakeSigner({
            getPublicKey: async () => ({ publicKey: '02aa' }),
            getMasterKey: () => new Uint8Array(32).fill(7),
        });
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);
        const vault = ownershipVault({
            wallets: { put: async () => { pool.evict('wallet-1'); } },
        });

        await expect(pool.captureOne({
            vault,
            wallet: { ...WALLET },
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        })).rejects.toThrow('signer unlock was cancelled');
        expect(signer.locked).toBe(true);
    });
});
