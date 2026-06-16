// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Integration: Vault open → write records → close → reopen → reads
// the same records back. Exercises the storage codec (encrypt + AAD)
// + the in-memory backend + the per-collection put/get plumbing.
//
// Uses the schema's own factory (`createWallet`) so the test fixture
// always reflects the current wallet shape — if the schema gains a
// required field, this test fails on the factory call rather than on
// validateWallet at save time, which is easier to debug.

import { describe, it, expect } from 'vitest';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';
import { createWallet } from '../../../packages/core/src/schemas/wallet.js';

const MASTER_KEY = new Uint8Array(32).fill(11);

const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 3,
    memory: 65536,
    parallelism: 1,
};

function fakeWallet(name) {
    return createWallet({
        name,
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptedSeed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        kdfParams: KDF_PARAMS,
    });
}

describe('integration/vault/round-trip', () => {
    it('persists a wallet record and reads it back after a close/open cycle', async () => {
        const backend = new InMemoryBackend();

        const v1 = new Vault({ backend, masterKey: MASTER_KEY });
        await v1.open();
        const w = fakeWallet('Test wallet');
        await v1.wallets.put(w);
        await v1.close();

        const v2 = new Vault({ backend, masterKey: MASTER_KEY });
        await v2.open();
        const got = await v2.wallets.get(w.id);
        expect(got).toBeTruthy();
        expect(got.id).toBe(w.id);
        expect(got.name).toBe('Test wallet');
        await v2.close();
    });

    it('persists multiple records across collections', async () => {
        const backend = new InMemoryBackend();
        const v = new Vault({ backend, masterKey: MASTER_KEY });
        await v.open();
        const a = fakeWallet('A');
        const b = fakeWallet('B');
        await v.wallets.put(a);
        await v.wallets.put(b);
        await v.close();

        const v2 = new Vault({ backend, masterKey: MASTER_KEY });
        await v2.open();
        const list = await v2.wallets.list();
        expect(list.length).toBe(2);
        const names = list.map((w) => w.name).sort();
        expect(names).toEqual(['A', 'B']);
        await v2.close();
    });

    it('refuses to load when reopened with a different master key', async () => {
        const backend = new InMemoryBackend();
        const v = new Vault({ backend, masterKey: MASTER_KEY });
        await v.open();
        await v.wallets.put(fakeWallet('Secret'));
        await v.close();

        const wrongKey = new Uint8Array(32).fill(12);
        const v2 = new Vault({ backend, masterKey: wrongKey });
        await expect(v2.open()).rejects.toThrow();
    });

    it('initialises an empty document when the backend has no blob yet', async () => {
        const backend = new InMemoryBackend();
        const v = new Vault({ backend, masterKey: MASTER_KEY });
        await v.open();
        const wallets = await v.wallets.list();
        expect(wallets).toEqual([]);
        await v.close();
    });
});
