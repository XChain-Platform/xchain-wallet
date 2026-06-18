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
            await expect(pool.populate({ vault, password: 'pw', ...REG })).resolves.toBeUndefined();
            expect(pool.get('w1')).toBe(fresh);
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
