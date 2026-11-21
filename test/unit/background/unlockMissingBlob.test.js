// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// An install whose kdfParams meta survives while its vault blob is gone has
// nothing to decrypt, so opening it proves nothing about the password. Unlock
// refuses that state with the status reader's VaultIncompleteError and writes
// nothing: no session key, no cached password, no throttle change, no host.
//
// The real Vault runs here; only the Argon2id derive is replaced, for speed.

import { describe, it, expect, vi } from 'vitest';

const derive = vi.hoisted(() => vi.fn(() => new Uint8Array(32).fill(7)));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, crypto: { ...actual.crypto, deriveMasterKey: derive } };
});

const { handleWalletUnlock } = await import('../../../packages/extension/src/background/walletUnlock.js');
const { Vault } = await import('../../../packages/core/src/storage/Vault.js');

function spyBackend() {
    return { load: vi.fn(async () => null), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
}

function makeDeps(loads) {
    const queue = [...loads];
    return {
        metaBackend: { load: async () => ({ kdfParams: { algorithm: 'argon2id', salt: 'x', memory: 1, iterations: 1, parallelism: 1 } }) },
        storageBackend: { load: vi.fn(async () => (queue.length > 1 ? queue.shift() : queue[0])) },
        sessionBackend: spyBackend(),
        signingSecretBackend: spyBackend(),
        unlockThrottleStore: spyBackend(),
        onUnlocked: vi.fn(),
    };
}

function expectNothingWritten(deps) {
    expect(deps.sessionBackend.save).not.toHaveBeenCalled();
    expect(deps.signingSecretBackend.save).not.toHaveBeenCalled();
    expect(deps.unlockThrottleStore.save).not.toHaveBeenCalled();
    expect(deps.unlockThrottleStore.clear).not.toHaveBeenCalled();
    expect(deps.onUnlocked).not.toHaveBeenCalled();
}

describe('wallet.unlock over meta with no vault blob', () => {
    it('refuses any password before deriving, and writes nothing', async () => {
        derive.mockClear();
        const deps = makeDeps([null]);
        await expect(handleWalletUnlock({ password: 'anything' }, deps)).rejects.toMatchObject({ name: 'VaultIncompleteError' });
        expect(derive).not.toHaveBeenCalled();
        expectNothingWritten(deps);
    });

    it('refuses when the blob goes while the key is derived, and writes nothing', async () => {
        derive.mockClear();
        const deps = makeDeps([new Uint8Array([1, 2, 3]), null]);
        await expect(handleWalletUnlock({ password: 'anything' }, deps)).rejects.toMatchObject({ name: 'VaultIncompleteError' });
        expect(derive).toHaveBeenCalledTimes(1);
        expectNothingWritten(deps);
    });
});

describe('Vault.open requireExisting', () => {
    it('refuses an empty backend and leaves the vault unopened', async () => {
        const vault = new Vault({ backend: spyBackend(), masterKey: new Uint8Array(32).fill(7) });
        await expect(vault.open({ requireExisting: true })).rejects.toMatchObject({ name: 'VaultIncompleteError' });
        await expect(vault.wallets.list()).rejects.toThrow();
    });

    it('still opens an empty document by default', async () => {
        const vault = new Vault({ backend: spyBackend(), masterKey: new Uint8Array(32).fill(7) });
        await vault.open();
        await expect(vault.wallets.list()).resolves.toEqual([]);
    });
});
