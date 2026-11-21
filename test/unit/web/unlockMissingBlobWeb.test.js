// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The web and mobile unlock refuses an install whose kdfParams meta survives
// while its vault blob is gone: there is nothing to decrypt, so any password
// would open it. The refusal names the state the way getSessionStatus does,
// evicted on the browser lane and incomplete on a native shell, and no
// session starts. The real Vault runs; only the derive and the storage
// backends are replaced.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const seam = vi.hoisted(() => ({ loads: [], native: false, derive: null }));

vi.mock('../../../packages/core/src/crypto/kdf.js', async (importOriginal) => ({
    ...(await importOriginal()),
    deriveMasterKeyAsync: (...args) => seam.derive(...args),
}));

vi.mock('../../../packages/web/src/storage/backends.js', async (importOriginal) => ({
    ...(await importOriginal()),
    createStorageBackend: () => ({
        load: async () => (seam.loads.length > 1 ? seam.loads.shift() : seam.loads[0]),
        save: async () => {},
    }),
    createMetaBackend: () => ({ load: async () => ({ kdfParams: { algorithm: 'argon2id', salt: 'x', memory: 1, iterations: 1, parallelism: 1 } }) }),
    usingNativeVault: () => seam.native,
    installNativeWipeHook: () => {},
    installNativeScreenGuard: () => {},
}));

const { unlockWalletLocal, sendMessage } = await import('../../../packages/web/src/hostBridge.js');

beforeEach(() => {
    seam.derive = vi.fn(async () => new Uint8Array(32).fill(5));
});

async function expectLocked() {
    await expect(sendMessage('wallet.list', {})).rejects.toMatchObject({ name: 'VaultClosedError' });
}

describe('unlockWalletLocal over meta with no vault blob', () => {
    it('refuses as evicted on the browser lane before deriving', async () => {
        seam.native = false;
        seam.loads = [null];
        await expect(unlockWalletLocal({ password: 'anything' })).rejects.toMatchObject({ name: 'VaultEvictedError' });
        expect(seam.derive).not.toHaveBeenCalled();
        await expectLocked();
    });

    it('refuses as incomplete on a native shell before deriving', async () => {
        seam.native = true;
        seam.loads = [null];
        await expect(unlockWalletLocal({ password: 'anything' })).rejects.toMatchObject({ name: 'VaultIncompleteError' });
        expect(seam.derive).not.toHaveBeenCalled();
        await expectLocked();
    });

    it('refuses when the blob goes while the key is derived, and starts no session', async () => {
        seam.native = false;
        seam.loads = [new Uint8Array([1, 2, 3]), null];
        await expect(unlockWalletLocal({ password: 'anything' })).rejects.toMatchObject({ name: 'VaultEvictedError' });
        expect(seam.derive).toHaveBeenCalledTimes(1);
        await expectLocked();
    });
});
