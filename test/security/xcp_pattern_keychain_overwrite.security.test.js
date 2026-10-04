// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security: creating or importing a wallet must add a record and never
// replace a stored wallet's encrypted seed, regardless of session state.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../helpers/argon2idTimeout.js';
import { createWallet } from '../../packages/core/src/flows/createWallet.js';
import { importMnemonic } from '../../packages/core/src/flows/importMnemonic.js';
import { generateBip39Mnemonic } from '../../packages/core/src/crypto/mnemonic.js';
import { ChainRegistry } from '../../packages/core/src/registry/index.js';
import { Vault } from '../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../packages/core/src/storage/backend.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const TEST_PASSWORD = ['fixture', 'pass', 'phrase'].join('-');

const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

async function freshVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    return vault;
}

function baseOpts(vault) {
    return {
        password: TEST_PASSWORD,
        vault,
        chainRegistry: new ChainRegistry(),
        sdkRegistry: { get: () => ({ wallet: { deriveAddress: (pub, { type }) => `${type}_${pub.slice(0, 16)}` } }) },
        activeChainIds: ['bitcoin-regtest'],
        kdfParams: LOW_COST_KDF_PARAMS,
    };
}

describe('security/xcp-pattern/keychain-overwrite', () => {
    it('a create after a stored wallet leaves the stored seed intact', async () => {
        const vault = await freshVault();
        const first = await createWallet({ ...baseOpts(vault), name: 'First' });
        const before = JSON.stringify(await vault.wallets.get(first.wallet.id));

        const second = await createWallet({ ...baseOpts(vault), name: 'Second' });

        expect(second.wallet.id).not.toBe(first.wallet.id);
        expect(JSON.stringify(await vault.wallets.get(first.wallet.id))).toBe(before);
    });

    it('an import after a stored wallet leaves the stored seed intact', async () => {
        const vault = await freshVault();
        const first = await createWallet({ ...baseOpts(vault), name: 'First' });
        const before = JSON.stringify(await vault.wallets.get(first.wallet.id));

        const imported = await importMnemonic({
            ...baseOpts(vault),
            mnemonic: generateBip39Mnemonic(128),
            name: 'Imported',
        });

        expect(imported.wallet.id).not.toBe(first.wallet.id);
        expect(JSON.stringify(await vault.wallets.get(first.wallet.id))).toBe(before);
    });

    it('refuses to persist over an existing wallet id and keeps the stored secret', async () => {
        const vault = await freshVault();
        const first = await createWallet({ ...baseOpts(vault), name: 'First' });
        const before = JSON.stringify(await vault.wallets.get(first.wallet.id));

        const spy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(first.wallet.id);
        try {
            await expect(
                importMnemonic({ ...baseOpts(vault), mnemonic: generateBip39Mnemonic(128), name: 'Clash' }),
            ).rejects.toThrow(/refusing to overwrite/);
        } finally {
            spy.mockRestore();
        }

        expect(JSON.stringify(await vault.wallets.get(first.wallet.id))).toBe(before);
    });
});
