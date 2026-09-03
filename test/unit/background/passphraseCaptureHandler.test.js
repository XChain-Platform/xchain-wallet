// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.4: `wallet.passphrase.capture`, the message that seals a legacy
// wallet's 25th word onto its record.
//
// It is registered ONCE, in createBackgroundHost, which is the single host
// behind every shell (the web bridge imports it rather than reimplementing
// it), so driving it through the host here covers all four shells.
//
// `unlockWalletRecord` is the only collaborator faked: it is the one piece
// that would do a real Argon2id round. Everything the assertion cares about
// (the AES-GCM blob, the ownership check, the vault write) runs for real, so a
// stored blob that cannot be reopened fails this file.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/core/src/flows/unlockWallet.js', async (importOriginal) => ({
    ...(await importOriginal()),
    unlockWalletRecord: vi.fn(),
}));

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { SignerPool } from '../../../packages/core/src/signers/SignerPool.js';
import { unlockWalletRecord } from '../../../packages/core/src/flows/unlockWallet.js';
import { decryptWalletPassphrase } from '../../../packages/core/src/crypto/walletBlob.js';

const PUB = '02aabbcc';
const PATH = "m/84'/0'/0'/0/0";
const MASTER_KEY = new Uint8Array(32).fill(9);

const LEGACY = {
    schemaVersion: 3,
    id: 'w-legacy',
    name: 'Cold',
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'imported',
    format: 'bip39',
    passphraseEnabled: true,
    encryptedPassphrase: null,
    multisigs: [],
};

/** A vault that actually persists, so a re-read proves what the handler wrote. */
function memoryVault({ addresses = [{ id: 'x1', accountId: 'a1', derivationPath: PATH, publicKey: PUB }] } = {}) {
    const rows = new Map([[LEGACY.id, { ...LEGACY }]]);
    return {
        settings: { get: async () => ({}) },
        wallets: {
            list: async () => [...rows.values()].map((r) => ({ ...r })),
            get: async (id) => (rows.has(id) ? { ...rows.get(id) } : null),
            put: async (rec) => { rows.set(rec.id, { ...rec }); },
        },
        accounts: { findBy: async (f, v) => (f === 'walletId' && v === LEGACY.id ? [{ id: 'a1', walletId: LEGACY.id }] : []) },
        addresses: { findBy: async (f, v) => (f === 'accountId' && v === 'a1' ? addresses : []) },
    };
}

/** A signer that derives `pubkey` for any path and hands out a fixed master key. */
function capturingSigner(pubkey) {
    return {
        locked: false,
        lock() { this.locked = true; },
        getPublicKey: async ({ path }) => ({ publicKey: pubkey, path }),
        getMasterKey: () => MASTER_KEY,
    };
}

/** Same in-memory opt-out shape used by walletProjection.test.js. */
function makeHost({ vault, signerPool }) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault,
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
        signerPool,
    });
}

beforeEach(() => {
    vi.mocked(unlockWalletRecord).mockReset();
});

describe('wallet.passphrase.capture (§3.4)', () => {
    it('is registered on the one host every shell runs', () => {
        const host = makeHost({ vault: memoryVault(), signerPool: new SignerPool() });
        expect(host.types()).toContain('wallet.passphrase.capture');
    });

    it('persists the encrypted passphrase and reports the wallet as stored', async () => {
        const vault = memoryVault();
        const signerPool = new SignerPool();
        const signer = capturingSigner(PUB);
        unlockWalletRecord.mockResolvedValue(signer);
        const host = makeHost({ vault, signerPool });

        const res = await host.handle({
            type: 'wallet.passphrase.capture',
            request: { walletId: LEGACY.id, password: 'pw', bip39Passphrase: 'right' },
        });

        expect(res.ok).toBe(true);
        expect(res.result.wallet.id).toBe(LEGACY.id);
        // The projection is the UI's whole answer: this wallet now opens on the
        // password alone.
        expect(res.result.wallet.passphraseStored).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(res.result.wallet, 'encryptedPassphrase')).toBe(false);

        const stored = await vault.wallets.get(LEGACY.id);
        expect(typeof stored.encryptedPassphrase).toBe('string');
        const bytes = await decryptWalletPassphrase({
            masterKey: MASTER_KEY, encryptedPassphrase: stored.encryptedPassphrase,
        });
        expect(new TextDecoder().decode(bytes)).toBe('right');

        // The session continues without a second unlock.
        expect(signerPool.get(LEGACY.id)).toBe(signer);
    });

    it('reads the wallet from the host vault rather than asking the caller for it', async () => {
        const vault = memoryVault();
        unlockWalletRecord.mockResolvedValue(capturingSigner(PUB));
        const host = makeHost({ vault, signerPool: new SignerPool() });

        // No wallet record in the request, only its id.
        const res = await host.handle({
            type: 'wallet.passphrase.capture',
            request: { walletId: LEGACY.id, password: 'pw', bip39Passphrase: 'right' },
        });
        expect(res.ok).toBe(true);
        expect(unlockWalletRecord).toHaveBeenCalledWith(
            expect.objectContaining({ wallet: expect.objectContaining({ id: LEGACY.id }) }),
        );
    });

    it('surfaces PassphraseMismatchError and persists nothing for a wrong passphrase', async () => {
        const vault = memoryVault();
        const signerPool = new SignerPool();
        const signer = capturingSigner('03deadbeef');
        unlockWalletRecord.mockResolvedValue(signer);
        const host = makeHost({ vault, signerPool });

        const res = await host.handle({
            type: 'wallet.passphrase.capture',
            request: { walletId: LEGACY.id, password: 'pw', bip39Passphrase: 'wrong' },
        });

        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('PassphraseMismatchError');
        // The envelope keeps `code`, which is what the unlock screen branches on.
        expect(res.error.code).toBe('PASSPHRASE_MISMATCH');
        expect((await vault.wallets.get(LEGACY.id)).encryptedPassphrase).toBeNull();
        expect(signerPool.size()).toBe(0);
        expect(signer.locked).toBe(true);
    });

    it('rejects a request with no walletId without touching the pool', async () => {
        const vault = memoryVault();
        const host = makeHost({ vault, signerPool: new SignerPool() });
        const res = await host.handle({ type: 'wallet.passphrase.capture', request: { password: 'pw', bip39Passphrase: 'x' } });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/walletId is required/);
        expect(unlockWalletRecord).not.toHaveBeenCalled();
    });

    it('rejects an unknown walletId', async () => {
        const vault = memoryVault();
        const host = makeHost({ vault, signerPool: new SignerPool() });
        const res = await host.handle({
            type: 'wallet.passphrase.capture',
            request: { walletId: 'ghost', password: 'pw', bip39Passphrase: 'x' },
        });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/not found/);
        expect(unlockWalletRecord).not.toHaveBeenCalled();
    });

    it('rejects when the session has no signer pool at all', async () => {
        const vault = memoryVault();
        const host = makeHost({ vault, signerPool: undefined });
        const res = await host.handle({
            type: 'wallet.passphrase.capture',
            request: { walletId: LEGACY.id, password: 'pw', bip39Passphrase: 'right' },
        });
        expect(res.ok).toBe(false);
        expect(res.error.message).toMatch(/no signer pool/);
        expect((await vault.wallets.get(LEGACY.id)).encryptedPassphrase).toBeNull();
    });
});
