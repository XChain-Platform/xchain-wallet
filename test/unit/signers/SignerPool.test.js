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

// Only the unlock primitive is faked. The error classes beside it are the real
// ones, because `captureOne` throws `PassphraseMismatchError` and a stand-in
// class would prove nothing about what a caller catches.
vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWalletRecord: vi.fn(),
}));

import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';
import {
    PassphraseMismatchError,
    unlockWalletRecord,
} from '../../../packages/core/src/flows/unlockWallet.js';
import { decryptWalletPassphrase } from '../../../packages/core/src/crypto/walletBlob.js';

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

        it('leaves a legacy passphrase wallet unpooled and names it as capture-needed', async () => {
            const vault = { wallets: { list: async () => [
                { id: 'w1', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: null },
            ] } };
            const pool = new SignerPool();
            const summary = await pool.populate({ vault, password: 'pw', ...REG });

            expect(unlockWalletRecord).not.toHaveBeenCalled();
            expect(pool.has('w1')).toBe(false);
            expect(summary.passphraseCaptureNeeded).toEqual(['w1']);
            expect(summary.passphraseCaptureNames).toEqual(['Cold']);
        });

        it('pools a stored-passphrase wallet from the password alone', async () => {
            const vault = { wallets: { list: async () => [
                { id: 'w1', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: 'c2VhbGVk' },
            ] } };
            const signer = fakeSigner('s1');
            unlockWalletRecord.mockResolvedValue(signer);
            const pool = new SignerPool();
            const summary = await pool.populate({ vault, password: 'pw', ...REG });

            expect(pool.get('w1')).toBe(signer);
            expect(unlockWalletRecord).toHaveBeenCalledWith(
                expect.objectContaining({ password: 'pw', bip39Passphrase: '' }),
            );
            expect(summary.pooled).toEqual(['w1']);
            expect(summary.passphraseCaptureNeeded).toEqual([]);
            expect(summary.passphraseCaptureNames).toEqual([]);
        });

        it('unlocks a legacy passphrase wallet when the bip39Passphrase is provided', async () => {
            const vault = { wallets: { list: async () => [
                { id: 'w1', passphraseEnabled: true, encryptedPassphrase: null },
            ] } };
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

        it('reports pooled, skipped and capture-needed wallet ids in its summary', async () => {
            const vault = { wallets: { list: async () => [
                { id: 'w1' },
                { id: 'w2', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: null },
                { id: 'w3' },
            ] } };
            unlockWalletRecord
                .mockResolvedValueOnce(fakeSigner('s1'))
                .mockRejectedValueOnce(new Error('bad password'));
            const pool = new SignerPool();
            const summary = await pool.populate({ vault, password: 'pw', ...REG });
            expect(summary.pooled).toEqual(['w1']);
            expect(summary.skipped).toEqual(['w3']);
            expect(summary.passphraseCaptureNeeded).toEqual(['w2']);
            expect(summary.passphraseCaptureNames).toEqual(['Cold']);
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
                    wallets: { list: async () => [
                        { id: 'w1', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: null },
                    ] },
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

            // A stored passphrase was verified once, when it was captured. There
            // is no typo left to catch, so the derivation is skipped: paying it
            // on every unlock could also unpool a working wallet on a miss.
            it('does not run the check for a wallet whose passphrase is stored', async () => {
                const vault = vaultWithHdAddress();
                vault.wallets = { list: async () => [
                    { id: 'w1', name: 'Cold', passphraseEnabled: true, encryptedPassphrase: 'c2VhbGVk' },
                ] };
                const signer = derivingSigner('03deadbeef');
                unlockWalletRecord.mockResolvedValue(signer);
                const pool = new SignerPool();
                const summary = await pool.populate({ vault, password: 'pw', ...REG });

                expect(signer.askedPath).toBeUndefined();
                expect(pool.get('w1')).toBe(signer);
                expect(summary.pooled).toEqual(['w1']);
                expect(summary.passphraseMatched).toEqual([]);
                expect(summary.passphraseMismatch).toEqual([]);
            });

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

    // The one-time capture step for a wallet created before the passphrase was
    // stored. Real crypto here: the blob it writes has to be openable, so
    // `encryptWalletPassphrase` is exercised rather than mocked.
    describe('captureOne', () => {
        const PUB = '02aabbcc';
        const PATH = "m/84'/0'/0'/0/0";
        const MASTER_KEY = new Uint8Array(32).fill(7);
        const LEGACY = {
            id: 'w1', name: 'Cold', format: 'bip39', passphraseEnabled: true, encryptedPassphrase: null,
        };

        // A vault that actually persists, so a re-read proves what `put` wrote.
        function memoryVault({ addresses = [{ id: 'x1', accountId: 'a1', derivationPath: PATH, publicKey: PUB }] } = {}) {
            const rows = new Map([[LEGACY.id, { ...LEGACY }]]);
            return {
                wallets: {
                    list: async () => [...rows.values()].map((r) => ({ ...r })),
                    get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null),
                    put: async (rec) => { rows.set(rec.id, { ...rec }); },
                },
                accounts: { findBy: async (f, v) => (f === 'walletId' && v === 'w1' ? [{ id: 'a1', walletId: 'w1' }] : []) },
                addresses: { findBy: async (f, v) => (f === 'accountId' && v === 'a1' ? addresses : []) },
            };
        }

        function capturingSigner(pubkey) {
            const s = fakeSigner('cap');
            s.getPublicKey = async ({ path }) => { s.askedPath = path; return { publicKey: pubkey }; };
            s.getMasterKey = () => MASTER_KEY;
            return s;
        }

        it('stores the passphrase and pools the signer when it owns the wallet', async () => {
            const vault = memoryVault();
            const signer = capturingSigner(PUB);
            unlockWalletRecord.mockResolvedValue(signer);
            const pool = new SignerPool();

            const record = await pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'right', ...REG,
            });

            expect(pool.get('w1')).toBe(signer);
            expect(signer.locked).toBe(false);
            expect(typeof record.encryptedPassphrase).toBe('string');

            // Re-read: `put` upserts and auto-saves, so the blob must be there.
            const stored = await vault.wallets.get('w1');
            expect(typeof stored.encryptedPassphrase).toBe('string');
            expect(stored.encryptedPassphrase.length).toBeGreaterThan(0);
            const bytes = await decryptWalletPassphrase({
                masterKey: MASTER_KEY, encryptedPassphrase: stored.encryptedPassphrase,
            });
            expect(new TextDecoder().decode(bytes)).toBe('right');

            // And the wallet now opens on the password alone.
            const next = fakeSigner('after');
            unlockWalletRecord.mockResolvedValue(next);
            const summary = await new SignerPool().populate({ vault, password: 'pw', ...REG });
            expect(summary.pooled).toEqual(['w1']);
            expect(summary.passphraseCaptureNeeded).toEqual([]);
        });

        it('refuses a passphrase that derives a different key, persisting nothing', async () => {
            const vault = memoryVault();
            const signer = capturingSigner('03deadbeef');
            unlockWalletRecord.mockResolvedValue(signer);
            const pool = new SignerPool();

            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'wrong', ...REG,
            })).rejects.toBeInstanceOf(PassphraseMismatchError);

            expect((await vault.wallets.get('w1')).encryptedPassphrase).toBeNull();
            expect(pool.has('w1')).toBe(false);
            expect(pool.size()).toBe(0);
            expect(signer.locked).toBe(true);
        });

        // Nothing to verify against is not a pass. The user did not choose this
        // string, so storing it unverified would seal the wrong passphrase in.
        it('refuses when there is no address to check ownership against', async () => {
            const vault = memoryVault({ addresses: [] });
            const signer = capturingSigner(PUB);
            unlockWalletRecord.mockResolvedValue(signer);
            const pool = new SignerPool();

            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'right', ...REG,
            })).rejects.toBeInstanceOf(PassphraseMismatchError);

            expect((await vault.wallets.get('w1')).encryptedPassphrase).toBeNull();
            expect(pool.has('w1')).toBe(false);
            expect(signer.locked).toBe(true);
        });

        it('names the wallet in the mismatch error', async () => {
            const vault = memoryVault();
            unlockWalletRecord.mockResolvedValue(capturingSigner('03deadbeef'));
            const pool = new SignerPool();
            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'wrong', ...REG,
            })).rejects.toMatchObject({ code: 'PASSPHRASE_MISMATCH', walletNames: ['Cold'] });
        });

        it('requires a passphrase and never unlocks without one', async () => {
            const vault = memoryVault();
            const pool = new SignerPool();
            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: '', ...REG,
            })).rejects.toThrow(/bip39Passphrase is required/);
            expect(unlockWalletRecord).not.toHaveBeenCalled();
        });

        it('propagates an unlock failure without pooling anything', async () => {
            const vault = memoryVault();
            unlockWalletRecord.mockRejectedValue(new Error('bad password'));
            const pool = new SignerPool();
            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'nope', bip39Passphrase: 'right', ...REG,
            })).rejects.toThrow('bad password');
            expect(pool.size()).toBe(0);
        });

        it('locks the signer and stores nothing when the vault put fails', async () => {
            const vault = memoryVault();
            vault.wallets.put = async () => { throw new Error('disk full'); };
            const signer = capturingSigner(PUB);
            unlockWalletRecord.mockResolvedValue(signer);
            const pool = new SignerPool();

            await expect(pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'right', ...REG,
            })).rejects.toThrow('disk full');
            expect(signer.locked).toBe(true);
            expect(pool.size()).toBe(0);
        });

        it('locks the signer it replaces', async () => {
            const vault = memoryVault();
            const stale = fakeSigner('stale');
            unlockWalletRecord.mockResolvedValue(stale);
            const pool = new SignerPool();
            await pool.unlockOne({ wallet: { id: 'w1' }, password: 'pw', ...REG });

            const signer = capturingSigner(PUB);
            unlockWalletRecord.mockResolvedValue(signer);
            await pool.captureOne({
                vault, wallet: { ...LEGACY }, password: 'pw', bip39Passphrase: 'right', ...REG,
            });

            expect(stale.locked).toBe(true);
            expect(pool.get('w1')).toBe(signer);
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
