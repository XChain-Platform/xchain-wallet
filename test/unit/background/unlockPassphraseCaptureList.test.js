// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.4: `wallet.unlock` tells the caller which wallets still owe
// their 25th word, so the unlock screen can ask once and hand the answer to
// `wallet.passphrase.capture`.
//
// This is the extension + desktop handler (`wallet.unlock` sits in
// PRE_HOST_MESSAGE_TYPES on both, so it never reaches the MessageHost). The
// web + mobile twin is `unlockWalletLocal`, covered in
// test/unit/web/unlockPassphraseCaptureListWeb.test.js.
//
// The KDF and the vault are faked: a real Argon2id round costs ~100ms of
// blocked event loop and proves nothing about the reply shape. The signer pool
// is a stub returning canned populate summaries, because what is under test is
// how the handler reports a summary, not how the pool builds one.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(3) },
        storage: {
            ...actual.storage,
            // Opens and closes cleanly; a wrong-password run is a different
            // test file's business (unlockThrottle.test.js).
            Vault: class FakeVault {
                async open() { /* password accepted */ }
                close() { /* nothing to zero */ }
            },
        },
    };
});

const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');
const { PassphraseMismatchError } = await import('../../../packages/core/src/flows/unlockWallet.js');

/** The zero-work summary a populate over plain wallets returns. */
function emptySummary(over = {}) {
    return {
        pooled: [], skipped: [], passphraseMatched: [], passphraseMismatch: [],
        passphraseMismatchNames: [], passphraseCaptureNeeded: [], passphraseCaptureNames: [],
        ...over,
    };
}

let populate;
let lockAll;

function deps(over = {}) {
    return {
        metaBackend: { load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) },
        storageBackend: { load: async () => null },
        sessionBackend: { save: async () => {} },
        signerPool: { populate, lockAll },
        chainRegistry: {},
        sdkRegistry: {},
        ...over,
    };
}

beforeEach(() => {
    populate = vi.fn(async () => emptySummary());
    lockAll = vi.fn();
});

describe('handleWalletUnlock: passphraseCaptureNeeded (§3.4)', () => {
    it('zips the summary\'s parallel arrays into { id, name } rows', async () => {
        populate = vi.fn(async () => emptySummary({
            passphraseCaptureNeeded: ['w1', 'w2'],
            passphraseCaptureNames: ['Cold', 'Savings'],
        }));
        const res = await handleWalletUnlock({ password: 'pw' }, deps());
        expect(res.unlocked).toBe(true);
        expect(res.passphraseCaptureNeeded).toEqual([
            { id: 'w1', name: 'Cold' },
            { id: 'w2', name: 'Savings' },
        ]);
    });

    it('returns an empty list when nothing needs capture', async () => {
        const res = await handleWalletUnlock({ password: 'pw' }, deps());
        expect(res).toEqual({ unlocked: true, passphraseCaptureNeeded: [] });
        expect(res.poolUnavailable).toBeUndefined();
    });

    it('substitutes an empty name rather than dropping a nameless wallet', async () => {
        populate = vi.fn(async () => emptySummary({
            passphraseCaptureNeeded: ['w1'],
            passphraseCaptureNames: [],
        }));
        const res = await handleWalletUnlock({ password: 'pw' }, deps());
        expect(res.passphraseCaptureNeeded).toEqual([{ id: 'w1', name: '' }]);
    });

    // An empty list means two different things. Without this flag the unlock
    // screen reads "populate blew up" as "nothing to capture" and a legacy
    // wallet silently never gets asked.
    it('marks poolUnavailable when populate threw, and still returns a usable reply', async () => {
        populate = vi.fn(async () => { throw new Error('pool exploded'); });
        const res = await handleWalletUnlock({ password: 'pw' }, deps());
        expect(res.unlocked).toBe(true);
        expect(res.poolUnavailable).toBe(true);
        expect(res.passphraseCaptureNeeded).toEqual([]);
    });

    it('does not mark poolUnavailable when no pool was wired at all', async () => {
        const res = await handleWalletUnlock(
            { password: 'pw' },
            deps({ signerPool: undefined, chainRegistry: undefined, sdkRegistry: undefined }),
        );
        expect(res).toEqual({ unlocked: true, passphraseCaptureNeeded: [] });
    });

    it('still fires onUnlocked and saves the session key on the populate-failed path', async () => {
        populate = vi.fn(async () => { throw new Error('pool exploded'); });
        const saved = [];
        const onUnlocked = vi.fn();
        await handleWalletUnlock({ password: 'pw' }, deps({
            sessionBackend: { save: async (k) => { saved.push(k); } },
            onUnlocked,
        }));
        expect(saved).toHaveLength(1);
        expect(onUnlocked).toHaveBeenCalledOnce();
    });
});

describe('handleWalletUnlock: the mismatch throw stays scoped to a typed passphrase', () => {
    it('throws when a typed 25th word matched nothing', async () => {
        populate = vi.fn(async () => emptySummary({
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(handleWalletUnlock({ password: 'pw', bip39Passphrase: 'wrong' }, deps()))
            .rejects.toBeInstanceOf(PassphraseMismatchError);
        expect(lockAll).toHaveBeenCalledOnce();
    });

    // A stored-passphrase wallet no longer runs the ownership check, so it
    // never lands in `passphraseMatched`. The gate must not read that absence
    // as "the typed word matched nothing".
    it('does not throw for a stored-passphrase wallet, even with a passphrase typed', async () => {
        populate = vi.fn(async () => emptySummary({ pooled: ['w-stored'] }));
        const res = await handleWalletUnlock({ password: 'pw', bip39Passphrase: 'ignored' }, deps());
        expect(res.unlocked).toBe(true);
        expect(lockAll).not.toHaveBeenCalled();
    });

    it('does not throw when no passphrase was typed', async () => {
        populate = vi.fn(async () => emptySummary({
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(handleWalletUnlock({ password: 'pw' }, deps())).resolves.toMatchObject({ unlocked: true });
    });

    it('lets the unlock stand when at least one passphrase wallet matched', async () => {
        populate = vi.fn(async () => emptySummary({
            pooled: ['w2'], passphraseMatched: ['w2'],
            passphraseMismatch: ['w1'], passphraseMismatchNames: ['Cold'],
        }));
        await expect(handleWalletUnlock({ password: 'pw', bip39Passphrase: 'right-for-w2' }, deps()))
            .resolves.toMatchObject({ unlocked: true });
    });
});
