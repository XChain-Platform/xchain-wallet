// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.4, web + mobile half: `unlockWalletLocal` is the second unlock
// handler (the extension and desktop shells intercept `wallet.unlock` before
// the host, so they never reach this one), and it must report the same
// capture queue in the same shape. The extension twin is covered in
// test/unit/background/unlockPassphraseCaptureList.test.js.
//
// The KDF, the vault, the signer pool and the notification watcher are faked:
// a real Argon2id round blocks the worker for ~100ms and none of the four
// says anything about the reply shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { populate, vaultClose, deriveAsync, hoisted } = vi.hoisted(() => {
    const populate = vi.fn();
    const vaultClose = vi.fn();
    const deriveAsync = vi.fn();
    class FakeSignerPool {
        populate(...args) { return populate(...args); }
        lockAll() { /* nothing pooled */ }
    }
    // Every watcher `startNotifications` spins up, inert. Left real they poll
    // a vault that has no collections and fill the run with handled-but-loud
    // stack traces.
    class InertWatcher {
        async start() { /* no polling in a unit test */ }
        stop() { /* nothing started */ }
        // Some call sites `.catch()` the refresh, so it has to be thenable.
        refresh() { return Promise.resolve(); }
    }
    class FakeVault {
        async open() { /* password accepted */ }
        close() { vaultClose(); }
    }
    return { populate, vaultClose, deriveAsync, hoisted: { FakeSignerPool, InertWatcher, FakeVault } };
});

// hostBridge imports these modules directly (not through the core barrel),
// so each seam is mocked at its own file.
vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => ({
    ...(await importOriginal()),
    deriveMasterKeyAsync: (...args) => deriveAsync(...args),
    // The unlock lane must not block the page on the synchronous KDF.
    deriveMasterKey: () => { throw new Error('sync KDF on the web unlock path'); },
}));
vi.mock('../../../packages/core/src/storage/Vault.js', async (importOriginal) => ({
    ...(await importOriginal()),
    Vault: hoisted.FakeVault,
}));
vi.mock('../../../packages/core/src/signers/SignerPool.js', async (importOriginal) => ({
    ...(await importOriginal()),
    SignerPool: hoisted.FakeSignerPool,
}));
vi.mock('../../../packages/core/src/notifications/NotificationService.js', async (importOriginal) => ({
    ...(await importOriginal()),
    NotificationService: hoisted.InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/PriceAlertWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    PriceAlertWatcher: hoisted.InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/GovernancePollWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    GovernancePollWatcher: hoisted.InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/CoinpayAutopayWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    CoinpayAutopayWatcher: hoisted.InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/DeadlineWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    DeadlineWatcher: hoisted.InertWatcher,
}));
vi.mock('../../../packages/core/src/notifications/DispenserEscrowWatcher.js', async (importOriginal) => ({
    ...(await importOriginal()),
    DispenserEscrowWatcher: hoisted.InertWatcher,
}));

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({ load: async () => null, save: async () => {} }),
    createMetaBackend: () => ({ load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const { unlockWalletLocal, lockWalletLocal, sendMessage } = await import('../../../packages/web/src/hostBridge.js');

/** The zero-work summary a populate over plain wallets returns. */
function emptySummary(over = {}) {
    return {
        pooled: [], skipped: [], passphraseMatched: [], passphraseMismatch: [],
        passphraseMismatchNames: [], passphraseCaptureNeeded: [], passphraseCaptureNames: [],
        ...over,
    };
}

beforeEach(async () => {
    populate.mockReset();
    populate.mockResolvedValue(emptySummary());
    deriveAsync.mockReset();
    deriveAsync.mockImplementation(async () => new Uint8Array(32).fill(5));
    await lockWalletLocal();
    vaultClose.mockReset();
});

describe('unlockWalletLocal: passphraseCaptureNeeded (§3.4)', () => {
    it('zips the summary\'s parallel arrays into { id, name } rows', async () => {
        populate.mockResolvedValue(emptySummary({
            passphraseCaptureNeeded: ['w1', 'w2'],
            passphraseCaptureNames: ['Cold', 'Savings'],
        }));
        const res = await unlockWalletLocal({ password: 'pw' });
        expect(res.unlocked).toBe(true);
        expect(res.passphraseCaptureNeeded).toEqual([
            { id: 'w1', name: 'Cold' },
            { id: 'w2', name: 'Savings' },
        ]);
    });

    it('returns an empty list when nothing needs capture', async () => {
        const res = await unlockWalletLocal({ password: 'pw' });
        expect(res).toEqual({ unlocked: true, passphraseCaptureNeeded: [] });
    });

    it('derives the vault key exactly once, through the async KDF', async () => {
        await unlockWalletLocal({ password: 'pw' });
        expect(deriveAsync).toHaveBeenCalledTimes(1);
        expect(deriveAsync).toHaveBeenCalledWith('pw', { algorithm: 'argon2id' });
    });

    it('substitutes an empty name rather than dropping a nameless wallet', async () => {
        populate.mockResolvedValue(emptySummary({
            passphraseCaptureNeeded: ['w1'], passphraseCaptureNames: [],
        }));
        const res = await unlockWalletLocal({ password: 'pw' });
        expect(res.passphraseCaptureNeeded).toEqual([{ id: 'w1', name: '' }]);
    });
});

describe('unlockWalletLocal: the mismatch throw stays scoped to a typed passphrase', () => {
    it('throws when a typed 25th word matched nothing', async () => {
        populate.mockResolvedValue(emptySummary({
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(unlockWalletLocal({ password: 'pw', bip39Passphrase: 'wrong' }))
            .rejects.toMatchObject({ name: 'PassphraseMismatchError' });
    });

    // A stored-passphrase wallet no longer runs the ownership check, so it
    // never lands in `passphraseMatched`. The gate must not read that absence
    // as "the typed word matched nothing".
    it('does not throw for a stored-passphrase wallet, even with a passphrase typed', async () => {
        populate.mockResolvedValue(emptySummary({ pooled: ['w-stored'] }));
        const res = await unlockWalletLocal({ password: 'pw', bip39Passphrase: 'ignored' });
        expect(res.unlocked).toBe(true);
    });

    it('does not throw when no passphrase was typed', async () => {
        populate.mockResolvedValue(emptySummary({
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(unlockWalletLocal({ password: 'pw' })).resolves.toMatchObject({ unlocked: true });
    });
});

/** The rejection a call to the in-page host raises, or null when it resolved. */
async function hostError() {
    try { await sendMessage('wallet.list'); return null; } catch (err) { return err; }
}

// Twins of the extension's populate-failed cases
// (test/unit/background/unlockPassphraseCaptureList.test.js): same reply shape,
// and the session stands.
describe('unlockWalletLocal: a signer-pool failure does not block the unlock', () => {
    it('marks poolUnavailable when populate threw, and the session is live', async () => {
        populate.mockRejectedValue(new Error('wallets.list failed'));
        const res = await unlockWalletLocal({ password: 'pw' });
        expect(res).toEqual({ unlocked: true, passphraseCaptureNeeded: [], poolUnavailable: true });
        expect((await hostError())?.name).not.toBe('VaultClosedError');
        expect(vaultClose).not.toHaveBeenCalled();
    });

    it('leaves poolUnavailable off when populate succeeded', async () => {
        const res = await unlockWalletLocal({ password: 'pw' });
        expect(res.poolUnavailable).toBeUndefined();
    });
});

describe('unlockWalletLocal: a failure after the vault opened closes it', () => {
    it('closes the vault, stays locked, and a following unlock succeeds', async () => {
        // A malformed summary throws after v.open() and outside the populate guard.
        populate.mockResolvedValue(emptySummary({ passphraseCaptureNeeded: null }));
        await expect(unlockWalletLocal({ password: 'pw' })).rejects.toThrow(TypeError);
        expect(vaultClose).toHaveBeenCalledTimes(1);
        expect((await hostError())?.name).toBe('VaultClosedError');

        populate.mockResolvedValue(emptySummary());
        await expect(unlockWalletLocal({ password: 'pw' }))
            .resolves.toEqual({ unlocked: true, passphraseCaptureNeeded: [] });
    });

    it('closes the vault on a passphrase mismatch too', async () => {
        populate.mockResolvedValue(emptySummary({
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(unlockWalletLocal({ password: 'pw', bip39Passphrase: 'wrong' }))
            .rejects.toMatchObject({ name: 'PassphraseMismatchError' });
        expect(vaultClose).toHaveBeenCalledTimes(1);
        expect((await hostError())?.name).toBe('VaultClosedError');
    });
});
