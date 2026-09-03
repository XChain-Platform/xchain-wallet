// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for SignerPool: the in-memory cache of unlocked software
// signers held for the lifetime of an unlocked session.
//
// `unlockWalletRecord` (the only collaborator that does real crypto) is
// mocked so these tests stay fast and deterministic; the pool's own
// caching / locking / eviction logic is what is under test.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', () => ({
    unlockWalletRecord: vi.fn(),
}));

import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';
import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';

// A fake signer that records whether it was locked.
function fakeSigner(label) {
    return { label, locked: false, lock() { this.locked = true; } };
}

const REG = { chainRegistry: {}, sdkRegistry: {} };

beforeEach(() => {
    vi.mocked(unlockWalletRecord).mockReset();
});

describe('signers/SignerPool', () => {
    describe('populate', () => {
        it('unlocks and caches a signer for each wallet', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1' }, { id: 'w2' }] } };
            unlockWalletRecord
                .mockResolvedValueOnce(fakeSigner('s1'))
                .mockResolvedValueOnce(fakeSigner('s2'));

            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });

            expect(pool.size()).toBe(2);
            expect(pool.get('w1').label).toBe('s1');
            expect(pool.get('w2').label).toBe('s2');
        });

        it('skips passphrase-enabled wallets when no bip39Passphrase is supplied', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1', passphraseEnabled: true }] } };
            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });

            expect(unlockWalletRecord).not.toHaveBeenCalled();
            expect(pool.has('w1')).toBe(false);
        });

        it('unlocks a passphrase wallet when the bip39Passphrase is provided', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1', passphraseEnabled: true }] } };
            unlockWalletRecord.mockResolvedValue(fakeSigner('s1'));
            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', bip39Passphrase: '25th', ...REG });

            expect(pool.has('w1')).toBe(true);
        });

        it('skips a wallet whose unlock throws (bad password) without failing the rest', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1' }, { id: 'w2' }] } };
            unlockWalletRecord
                .mockRejectedValueOnce(new Error('bad password'))
                .mockResolvedValueOnce(fakeSigner('s2'));

            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });

            expect(pool.has('w1')).toBe(false);
            expect(pool.get('w2').label).toBe('s2');
            expect(pool.size()).toBe(1);
        });

        it('locks the previously-cached signer when re-populating the same wallet', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1' }] } };
            const first = fakeSigner('first');
            const second = fakeSigner('second');
            unlockWalletRecord.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });
            await pool.populate({ vault, password: 'pw', ...REG });

            expect(first.locked).toBe(true);
            expect(pool.get('w1')).toBe(second);
            expect(pool.size()).toBe(1);
        });

        it('swallows a throwing lock() on the replaced signer (best-effort)', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1' }] } };
            const bad = { lock() { throw new Error('lock failed'); } };
            const fresh = fakeSigner('fresh');
            unlockWalletRecord.mockResolvedValueOnce(bad).mockResolvedValueOnce(fresh);
            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });
            await expect(pool.populate({ vault, password: 'pw', ...REG })).resolves.toMatchObject({ pooled: ['w1'] });
            expect(pool.get('w1')).toBe(fresh);
        });

        it('reports pooled and skipped wallet ids in its summary', async () => {
            const vault = { wallets: { list: async () => [
                { id: 'w1' }, { id: 'w2', passphraseEnabled: true }, { id: 'w3' },
            ] } };
            unlockWalletRecord
                .mockResolvedValueOnce(fakeSigner('s1'))
                .mockRejectedValueOnce(new Error('bad password'));
            const pool = new SignerPool();
            const summary = await pool.populate({ vault, password: 'pw', ...REG });
            expect(summary.pooled).toEqual(['w1']);
            expect(summary.skipped).toEqual(['w2', 'w3']);
            expect(summary.passphraseMatched).toEqual([]);
            expect(summary.passphraseMismatch).toEqual([]);
        });

        // A BIP39 passphrase never fails to derive, so the only way to catch a
        // mistyped 25th word is to compare what it derives against the public
        // key the stored HD address record was created from.
        describe('25th-word verification against stored addresses', () => {
            const PUB = '02aabbcc';
            function vaultWithHdAddress() {
                return {
                    wallets: { list: async () => [{ id: 'w1', name: 'Cold', passphraseEnabled: true }] },
                    accounts: { findBy: async (f, v) => (f === 'walletId' && v === 'w1' ? [{ id: 'a1', walletId: 'w1' }] : []) },
                    addresses: { findBy: async (f, v) => (f === 'accountId' && v === 'a1'
                        ? [
                            { id: 'x0', accountId: 'a1', derivationPath: null, publicKey: 'ff' },
                            { id: 'x1', accountId: 'a1', derivationPath: "m/84'/0'/0'/0/0", publicKey: PUB },
                        ]
                        : []) },
                };
            }
            function derivingSigner(pubkey) {
                const s = fakeSigner('sig');
                s.getPublicKey = async ({ path }) => { s.askedPath = path; return { publicKey: pubkey }; };
                return s;
            }

            it('pools the wallet when the passphrase reproduces the stored public key', async () => {
                const signer = derivingSigner(PUB.toUpperCase());
                unlockWalletRecord.mockResolvedValue(signer);
                const pool = new SignerPool();
                const summary = await pool.populate({ vault: vaultWithHdAddress(), password: 'pw', bip39Passphrase: 'right', ...REG });
                expect(pool.get('w1')).toBe(signer);
                expect(signer.askedPath).toBe("m/84'/0'/0'/0/0");
                expect(summary.passphraseMatched).toEqual(['w1']);
                expect(summary.passphraseMismatch).toEqual([]);
            });

            it('locks and refuses the signer when the passphrase derives a different key', async () => {
                const signer = derivingSigner('03deadbeef');
                unlockWalletRecord.mockResolvedValue(signer);
                const pool = new SignerPool();
                const summary = await pool.populate({ vault: vaultWithHdAddress(), password: 'pw', bip39Passphrase: 'wrong', ...REG });
                expect(pool.has('w1')).toBe(false);
                expect(signer.locked).toBe(true);
                expect(summary.passphraseMismatch).toEqual(['w1']);
                expect(summary.passphraseMismatchNames).toEqual(['Cold']);
                expect(summary.pooled).toEqual([]);
            });

            it('accepts a passphrase wallet that has no HD address record to compare against', async () => {
                const vault = vaultWithHdAddress();
                vault.addresses = { findBy: async () => [] };
                const signer = derivingSigner('03deadbeef');
                unlockWalletRecord.mockResolvedValue(signer);
                const pool = new SignerPool();
                const summary = await pool.populate({ vault, password: 'pw', bip39Passphrase: 'any', ...REG });
                expect(pool.get('w1')).toBe(signer);
                expect(summary.passphraseMatched).toEqual(['w1']);
            });

            it('does not run the check for wallets without a passphrase', async () => {
                const vault = vaultWithHdAddress();
                vault.wallets = { wallets: null, list: async () => [{ id: 'w1', name: 'Plain' }] };
                const signer = derivingSigner('03deadbeef');
                unlockWalletRecord.mockResolvedValue(signer);
                const pool = new SignerPool();
                await pool.populate({ vault, password: 'pw', ...REG });
                expect(pool.get('w1')).toBe(signer);
                expect(signer.askedPath).toBeUndefined();
            });
        });
    });

    describe('unlockOne', () => {
        it('adds a single wallet signer', async () => {
            unlockWalletRecord.mockResolvedValue(fakeSigner('s1'));
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            expect(pool.get('w1').label).toBe('s1');
        });

        it('locks an existing signer before replacing it', async () => {
            const old = fakeSigner('old');
            const fresh = fakeSigner('fresh');
            unlockWalletRecord.mockResolvedValueOnce(old).mockResolvedValueOnce(fresh);
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            expect(old.locked).toBe(true);
            expect(pool.get('w1')).toBe(fresh);
        });

        it('propagates an unlock failure (unlike populate)', async () => {
            unlockWalletRecord.mockRejectedValue(new Error('nope'));
            const pool = new SignerPool();
            await expect(pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG }))
                .rejects.toThrow('nope');
        });

        it('swallows a throwing lock() on the replaced signer (best-effort)', async () => {
            const bad = { lock() { throw new Error('lock failed'); } };
            const fresh = fakeSigner('fresh');
            unlockWalletRecord.mockResolvedValueOnce(bad).mockResolvedValueOnce(fresh);
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            await expect(pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG }))
                .resolves.toBeUndefined();
            expect(pool.get('w1')).toBe(fresh);
        });
    });

    describe('get / has', () => {
        it('get returns null and has returns false for an absent wallet', () => {
            const pool = new SignerPool();
            expect(pool.get('nope')).toBeNull();
            expect(pool.has('nope')).toBe(false);
        });
    });

    describe('evict', () => {
        it('locks and removes a single cached signer', async () => {
            const s = fakeSigner('s1');
            unlockWalletRecord.mockResolvedValue(s);
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });

            pool.evict('w1');
            expect(s.locked).toBe(true);
            expect(pool.has('w1')).toBe(false);
        });

        it('is a no-op for an unknown wallet', () => {
            const pool = new SignerPool();
            expect(() => pool.evict('ghost')).not.toThrow();
        });

        it('swallows a throwing lock() on evict (best-effort) and still removes it', async () => {
            unlockWalletRecord.mockResolvedValue({ lock() { throw new Error('lock failed'); } });
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            expect(() => pool.evict('w1')).not.toThrow();
            expect(pool.has('w1')).toBe(false);
        });
    });

    describe('lockAll', () => {
        it('locks every signer and clears the pool', async () => {
            const vault = { wallets: { list: async () => [{ id: 'w1' }, { id: 'w2' }] } };
            const a = fakeSigner('a'); const b = fakeSigner('b');
            unlockWalletRecord.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
            const pool = new SignerPool();
            await pool.populate({ vault, password: 'pw', ...REG });

            pool.lockAll();
            expect(a.locked).toBe(true);
            expect(b.locked).toBe(true);
            expect(pool.size()).toBe(0);
        });

        it('swallows a signer whose lock() throws (best-effort)', async () => {
            unlockWalletRecord.mockResolvedValue({ lock() { throw new Error('lock failed'); } });
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });
            expect(() => pool.lockAll()).not.toThrow();
            expect(pool.size()).toBe(0);
        });
    });
});
