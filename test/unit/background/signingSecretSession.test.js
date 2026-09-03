// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.6: the signing-secret session slot holds the password and
// nothing else.
//
// A BIP39 passphrase is captured once at create/import and lives encrypted on
// the wallet record, so unlock has no second secret to cache. The JSON-marker
// slot shape the previous build wrote must nevertheless keep READING for one
// release: a session that was already unlocked when the user upgraded still
// has a marker slot, and dropping the reader would strand its passphrase
// wallets until the next lock.
//
// The KDF and the Vault are faked for the unlock tests: a real Argon2id round
// costs ~100ms of blocked event loop and proves nothing about what lands in
// the slot. The SignerPool tests use the REAL pool, because the gate under
// test (awaiting-capture versus stored) is the pool's own logic; only the
// per-record unlock is stubbed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        // A signer with no getPublicKey makes the pool's ownership check
        // return "nothing to compare", which it treats as accepted. Address
        // verification is SignerPool's own test's business.
        unlockWalletRecord: vi.fn(async () => ({ lock() { /* nothing to zero */ } })),
    };
});

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: { ...actual.crypto, deriveMasterKey: () => new Uint8Array(32).fill(3) },
        storage: {
            ...actual.storage,
            // Opens and closes cleanly; the wrong-password path belongs to
            // unlockThrottle.test.js.
            Vault: class FakeVault {
                async open() { /* password accepted */ }
                close() { /* nothing to zero */ }
            },
        },
    };
});

const {
    SIGNING_SECRET_SESSION_KEY,
    saveSigningSecret,
    loadSigningSecret,
    loadSigningCredentials,
} = await import('../../../packages/extension/src/background/signingSecretSession.js');
const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');
const { SignerPool } = await import('../../../packages/core/src/signers/SignerPool.js');

const CREDENTIALS_MARKER = '\u0000xchain-creds:';

function memoryBackend() {
    let blob = null;
    return {
        async save(b) { blob = new Uint8Array(b); },
        async load() { return blob; },
        async clear() { blob = null; },
    };
}

/** The raw slot contents as text, or null when the slot is empty. */
async function slotText(backend) {
    const bytes = await backend.load();
    return bytes ? new TextDecoder().decode(bytes) : null;
}

describe('signingSecretSession: slot shapes', () => {
    it('stores a bare password unchanged and reads it back through both loaders', async () => {
        const be = memoryBackend();
        await saveSigningSecret(be, 'hunter2');
        expect(await slotText(be)).toBe('hunter2');
        expect(await loadSigningSecret(be)).toBe('hunter2');
        expect(await loadSigningCredentials(be)).toEqual({ password: 'hunter2', bip39Passphrase: '' });
    });

    // Test 2: the one-release compatibility window. This value is byte-for-byte
    // what the PREVIOUS build wrote, constructed here rather than produced by
    // the current writer, so the reader keeps being tested after the writer's
    // marker branch is eventually deleted.
    it('still parses a marker-form slot written by the previous build', async () => {
        const be = memoryBackend();
        const legacy = CREDENTIALS_MARKER + JSON.stringify({ password: 'hunter2', bip39Passphrase: 'my 25th word' });
        await be.save(new TextEncoder().encode(legacy));
        expect(await loadSigningCredentials(be)).toEqual({
            password: 'hunter2',
            bip39Passphrase: 'my 25th word',
        });
        expect(await loadSigningSecret(be)).toBe('hunter2');
    });

    it('reads a slot written by an older worker (raw password bytes) as a password', async () => {
        const be = memoryBackend();
        await be.save(new TextEncoder().encode('legacy-pw'));
        expect(await loadSigningCredentials(be)).toEqual({ password: 'legacy-pw', bip39Passphrase: '' });
    });

    it('does not mistake a JSON-looking password for the marked shape', async () => {
        const be = memoryBackend();
        const tricky = '{"password":"x","bip39Passphrase":"y"}';
        await saveSigningSecret(be, tricky);
        expect(await loadSigningCredentials(be)).toEqual({ password: tricky, bip39Passphrase: '' });
    });

    it('rejects a marker-form slot whose JSON is corrupt or passwordless', async () => {
        const be = memoryBackend();
        await be.save(new TextEncoder().encode(`${CREDENTIALS_MARKER}not json`));
        expect(await loadSigningCredentials(be)).toBeNull();
        await be.save(new TextEncoder().encode(CREDENTIALS_MARKER + JSON.stringify({ bip39Passphrase: 'x' })));
        expect(await loadSigningCredentials(be)).toBeNull();
    });

    it('returns null for an empty slot or a missing backend', async () => {
        expect(await loadSigningCredentials(memoryBackend())).toBeNull();
        expect(await loadSigningCredentials(null)).toBeNull();
        expect(await loadSigningSecret(undefined)).toBeNull();
    });
});

describe('handleWalletUnlock: the slot receives the password ALONE', () => {
    function deps(signingSecretBackend, over = {}) {
        return {
            metaBackend: { load: async () => ({ kdfParams: { algorithm: 'argon2id' } }) },
            storageBackend: { load: async () => null },
            sessionBackend: { save: async () => {} },
            signingSecretBackend,
            ...over,
        };
    }

    // Test 1. The assertion is on the RAW slot bytes, not on what the loader
    // hands back: a marker write would round-trip through loadSigningCredentials
    // perfectly well and this test would never notice.
    it('writes exactly the password, with no marker and no JSON envelope', async () => {
        const be = memoryBackend();
        await handleWalletUnlock({ password: 'hunter2' }, deps(be));
        expect(await slotText(be)).toBe('hunter2');
    });

    // The unlock request still ACCEPTS a 25th word (a legacy wallet's one-time
    // capture rides in on it), but the slot is not where it may land.
    it('keeps a typed 25th word out of the slot entirely', async () => {
        const be = memoryBackend();
        await handleWalletUnlock({ password: 'hunter2', bip39Passphrase: 'my 25th word' }, deps(be));
        const text = await slotText(be);
        expect(text).toBe('hunter2');
        expect(text).not.toContain('my 25th word');
        expect(text.startsWith('\u0000')).toBe(false);
    });

    it('leaves the slot untouched when no backend is wired', async () => {
        await expect(handleWalletUnlock({ password: 'hunter2' }, deps(undefined)))
            .resolves.toMatchObject({ unlocked: true });
    });
});

// The MV3 worker-restart path. This mirrors background.js's ensureHost
// rehydrate block: read the slot, re-populate, then park whatever still owes
// a passphrase. Kept here rather than imported because background.js is a
// service-worker entry with top-level chrome side effects.
async function rehydrate({ pool, vault, secretSlot, captureSlot }) {
    const cached = await loadSigningCredentials(secretSlot);
    if (!cached) return null;
    const pooled = await pool.populate({
        vault,
        password: cached.password,
        bip39Passphrase: cached.bip39Passphrase,
        chainRegistry: {},
        sdkRegistry: {},
    });
    return pooled;
}

/** A vault with wallet records only; the pool's address check finds nothing to compare. */
function vaultOf(...wallets) {
    return { wallets: { list: async () => wallets } };
}

const legacyWallet = {
    id: 'w-legacy', name: 'Cold', format: 'bip39',
    passphraseEnabled: true, encryptedPassphrase: null,
};
const storedWallet = {
    id: 'w-stored', name: 'Savings', format: 'bip39',
    passphraseEnabled: true, encryptedPassphrase: 'base64-ciphertext',
};

describe('service-worker restart: re-pooling from the slot', () => {
    let secretSlot;
    let captureSlot;

    beforeEach(() => {
        secretSlot = memoryBackend();
        captureSlot = memoryBackend();
    });

    // Test 4, and the mechanism behind acceptance test AT6: nothing but the
    // password is in play, and the pool needs nothing else.
    it('re-pools a stored-passphrase wallet from the password alone', async () => {
        await saveSigningSecret(secretSlot, 'hunter2');
        // A fresh pool stands in for the one Chrome discarded with the worker.
        const pooled = await rehydrate({
            pool: new SignerPool(), vault: vaultOf(storedWallet), secretSlot, captureSlot,
        });
        expect(pooled.pooled).toEqual(['w-stored']);
        expect(pooled.passphraseCaptureNeeded).toEqual([]);
        // No prompt is owed, so nothing is parked for the next popup open.
        expect(pooled.passphraseCaptureNeeded).toEqual([]);
        // And the slot still holds the password and only the password.
        expect(await slotText(secretSlot)).toBe('hunter2');
    });

    // Test 3: the upgraded-mid-session case. The slot predates the upgrade, so
    // it carries a passphrase, and passing it through is what keeps a legacy
    // wallet signing until the session's next lock.
    it('still pools a legacy wallet when the slot is a pre-upgrade marker', async () => {
        const legacy = CREDENTIALS_MARKER + JSON.stringify({ password: 'hunter2', bip39Passphrase: 'my 25th word' });
        await secretSlot.save(new TextEncoder().encode(legacy));
        const pooled = await rehydrate({
            pool: new SignerPool(), vault: vaultOf(legacyWallet), secretSlot, captureSlot,
        });
        expect(pooled.pooled).toEqual(['w-legacy']);
        expect(pooled.passphraseCaptureNeeded).toEqual([]);
        expect(pooled.passphraseCaptureNeeded).toEqual([]);
    });

    // The same legacy wallet with a slot written by THIS build: no passphrase
    // to pass through, so the pool leaves it out and it owes a capture.
    it('leaves a legacy wallet unpooled and queued when the slot holds the password alone', async () => {
        await saveSigningSecret(secretSlot, 'hunter2');
        const pooled = await rehydrate({
            pool: new SignerPool(), vault: vaultOf(legacyWallet, storedWallet), secretSlot, captureSlot,
        });
        expect(pooled.pooled).toEqual(['w-stored']);
        expect(pooled.passphraseCaptureNeeded).toEqual(['w-legacy']);
    });

    it('does nothing at all when the session slot is empty (locked session)', async () => {
        const pool = new SignerPool();
        expect(await rehydrate({ pool, vault: vaultOf(storedWallet), secretSlot, captureSlot })).toBeNull();
        expect(pool.size()).toBe(0);
    });
});

// Dropping the re-populate summary is what left a legacy wallet unasked for
// the rest of an evicted session: `wallet.unlock` hands its capture list
// straight to the unlock screen, but an eviction re-pools with no screen
// listening. The queue is parked in a session slot instead.
