// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Chaos: backend.save() throws mid-flight. The Vault must surface
// the error to the caller and NOT silently corrupt its in-memory
// document — a subsequent successful save should write the same
// state the failed call attempted.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { StorageBackend, InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';

const KEY = new Uint8Array(32).fill(99);
const KDF = {
    algorithm: 'argon2id', salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3, memory: 65536, parallelism: 1,
};

class FlakyBackend extends StorageBackend {
    constructor() {
        super();
        this.inner = new InMemoryBackend();
        this.failNextSave = false;
    }
    async load() { return this.inner.load(); }
    async save(blob) {
        if (this.failNextSave) {
            this.failNextSave = false;
            throw new Error('disk-full');
        }
        return this.inner.save(blob);
    }
}

describe('chaos/backend/save-failure', () => {
    it('surfaces a save() throw to the caller', async () => {
        const backend = new FlakyBackend();
        const v = new Vault({ backend, masterKey: KEY });
        await v.open();
        backend.failNextSave = true;
        await expect(
            v.wallets.put(createWallet({
                name: 'A', origin: 'created', format: 'bip39',
                passphraseEnabled: false,
                encryptedSeed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                kdfParams: KDF,
            })),
        ).rejects.toThrow(/disk-full/);
        await v.close();
    });

    it('after a failed save, in-memory state is consistent on retry', async () => {
        const backend = new FlakyBackend();
        const v = new Vault({ backend, masterKey: KEY });
        await v.open();
        const w = createWallet({
            name: 'Retry me', origin: 'created', format: 'bip39',
            passphraseEnabled: false,
            encryptedSeed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            kdfParams: KDF,
        });
        backend.failNextSave = true;
        await expect(v.wallets.put(w)).rejects.toThrow();
        // Retry — backend will succeed this time. The write should
        // land cleanly with the same record.
        await v.wallets.put(w);
        await v.close();

        const v2 = new Vault({ backend, masterKey: KEY });
        await v2.open();
        const got = await v2.wallets.get(w.id);
        expect(got).toBeTruthy();
        expect(got.name).toBe('Retry me');
    });
});
