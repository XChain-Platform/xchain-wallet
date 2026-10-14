// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWalletRecord: vi.fn(),
}));

import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';
import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';

const KDF = {
    algorithm: 'argon2id',
    salt: 'MDEyMzQ1Njc4OWFiY2RlZg==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};
const REGISTRIES = { chainRegistry: {}, sdkRegistry: {} };

function fakeSigner(overrides = {}) {
    return {
        locked: false,
        lock() { this.locked = true; },
        ...overrides,
    };
}

beforeEach(() => {
    vi.mocked(unlockWalletRecord).mockReset();
});

describe('SignerPool edge branches', () => {
    it('requires KDF parameters alongside a supplied master key', async () => {
        const pool = new SignerPool();
        const vault = { wallets: { list: vi.fn() } };
        await expect(pool.populate({
            vault,
            password: 'pw',
            masterKey: new Uint8Array(32),
            ...REGISTRIES,
        })).rejects.toThrow('needs the kdfParams');
        expect(vault.wallets.list).not.toHaveBeenCalled();
    });

    it('lends a master key only to wallets with identical KDF parameters', async () => {
        const masterKey = new Uint8Array(32).fill(7);
        const wallets = [
            { id: 'same', kdfParams: { ...KDF } },
            { id: 'different', kdfParams: { ...KDF, iterations: 4 } },
        ];
        vi.mocked(unlockWalletRecord)
            .mockResolvedValueOnce(fakeSigner())
            .mockResolvedValueOnce(fakeSigner());

        await new SignerPool().populate({
            vault: { wallets: { list: async () => wallets } },
            password: 'pw',
            masterKey,
            masterKeyKdfParams: { ...KDF },
            ...REGISTRIES,
        });

        expect(unlockWalletRecord.mock.calls[0][0].masterKey).toBe(masterKey);
        expect(unlockWalletRecord.mock.calls[1][0].masterKey).toBeUndefined();
    });

    it('returns an empty summary when the session ends while wallets are loading', async () => {
        let releaseList;
        const list = new Promise((resolve) => { releaseList = resolve; });
        const pool = new SignerPool();
        const pending = pool.populate({
            vault: { wallets: { list: () => list } }, password: 'pw', ...REGISTRIES,
        });

        pool.lockAll();
        releaseList([{ id: 'late' }]);

        await expect(pending).resolves.toEqual({
            pooled: [],
            skipped: [],
            passphraseMatched: [],
            passphraseMismatch: [],
            passphraseMismatchNames: [],
            passphraseCaptureNeeded: [],
            passphraseCaptureNames: [],
        });
        expect(unlockWalletRecord).not.toHaveBeenCalled();
    });

    it('accepts populate ownership as unverifiable when public-key derivation throws', async () => {
        const signer = fakeSigner({ getPublicKey: async () => { throw new Error('derive failed'); } });
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);
        const vault = {
            wallets: { list: async () => [{
                id: 'wallet-1', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: null,
            }] },
            accounts: { findBy: async () => [{ id: 'account-1' }] },
            addresses: { findBy: async () => [{
                derivationPath: "m/84'/0'/0'/0/0", publicKey: '02aa',
            }] },
        };

        const summary = await new SignerPool().populate({
            vault, password: 'pw', bip39Passphrase: 'typed', ...REGISTRIES,
        });

        expect(summary.passphraseMatched).toEqual(['wallet-1']);
        expect(summary.pooled).toEqual(['wallet-1']);
    });

    it.each([
        [{ wallet: { id: 'wallet-1' }, bip39Passphrase: 'word' }, 'vault is required'],
        [{ vault: {}, bip39Passphrase: 'word' }, 'wallet is required'],
        [{ vault: {}, wallet: { id: 'wallet-1' }, bip39Passphrase: 7 }, 'bip39Passphrase is required'],
    ])('validates capture arguments before unlocking %#', async (input, message) => {
        await expect(new SignerPool().captureOne({
            password: 'pw', ...REGISTRIES, ...input,
        })).rejects.toThrow(message);
        expect(unlockWalletRecord).not.toHaveBeenCalled();
    });

    it('cancels capture when the wallet is evicted during ownership verification', async () => {
        let finishDerivation;
        const signer = fakeSigner({
            getPublicKey: () => new Promise((resolve) => { finishDerivation = resolve; }),
        });
        vi.mocked(unlockWalletRecord).mockResolvedValue(signer);
        const vault = {
            wallets: { put: vi.fn() },
            accounts: { findBy: async () => [{ id: 'account-1' }] },
            addresses: { findBy: async () => [{
                derivationPath: "m/84'/0'/0'/0/0", publicKey: '02aa',
            }] },
        };
        const pool = new SignerPool();
        const pending = pool.captureOne({
            vault,
            wallet: { id: 'wallet-1', name: 'Cold' },
            password: 'pw',
            bip39Passphrase: 'typed',
            ...REGISTRIES,
        });
        await vi.waitFor(() => expect(finishDerivation).toBeTypeOf('function'));

        pool.evict('wallet-1');
        finishDerivation({ publicKey: '02aa' });

        await expect(pending).rejects.toThrow('signer unlock was cancelled');
        expect(signer.locked).toBe(true);
        expect(vault.wallets.put).not.toHaveBeenCalled();
    });
});
