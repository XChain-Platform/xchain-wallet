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

const { populate } = vi.hoisted(() => ({ populate: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
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
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(5) },
        storage: {
            ...actual.storage,
            Vault: class FakeVault {
                async open() { /* password accepted */ }
                close() { /* nothing to zero */ }
            },
        },
        signers: { ...actual.signers, SignerPool: FakeSignerPool },
        notifications: {
            ...actual.notifications,
            NotificationService: InertWatcher,
            PriceAlertWatcher: InertWatcher,
            GovernancePollWatcher: InertWatcher,
            CoinpayAutopayWatcher: InertWatcher,
            DeadlineWatcher: InertWatcher,
            DispenserEscrowWatcher: InertWatcher,
        },
    };
});

vi.mock('../../../packages/web/src/storage/backends.js', () => ({
    createStorageBackend: () => ({ load: async () => null, save: async () => {} }),
    createMetaBackend: () => ({ load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) }),
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const { unlockWalletLocal, lockWalletLocal } = await import('../../../packages/web/src/hostBridge.js');

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
    await lockWalletLocal();
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
