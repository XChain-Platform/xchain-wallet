// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Importing a recovery phrase the vault already holds must add nothing: a
// second wallet over the same keys double-counts balances and shows the user
// two wallets that are one. A different BIP39 passphrase is a different wallet.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

// Addresses depend on the phrase through the public key, so the same phrase
// derives the same address and another phrase derives another.
const sdkRegistry = { get: () => ({ wallet: { deriveAddress: (pub, { type }) => `${type}_${pub}` } }) };

async function openVault() {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    return vault;
}

function run(vault, mnemonic, overrides = {}) {
    return importMnemonic({
        password: 'correct-horse-battery-staple',
        mnemonic,
        vault,
        chainRegistry: new ChainRegistry(),
        sdkRegistry,
        activeChainIds: ['bitcoin-regtest'],
        name: 'First',
        kdfParams: LOW_COST_KDF_PARAMS,
        ...overrides,
    });
}

describe('importing a phrase the vault already holds', () => {
    it('refuses the second import, names the wallet that has it, and writes nothing', async () => {
        const vault = await openVault();
        const mnemonic = generateBip39Mnemonic(128);
        await run(vault, mnemonic);

        await expect(run(vault, mnemonic, { name: 'Second' })).rejects.toThrow(
            'This recovery phrase is already in this app as "First".',
        );
        expect(await vault.wallets.list()).toHaveLength(1);
        expect(await vault.accounts.list()).toHaveLength(1);
        expect(await vault.addresses.list()).toHaveLength(1);
    });

    it('treats the same phrase typed with different spacing and case as the same wallet', async () => {
        const vault = await openVault();
        const mnemonic = generateBip39Mnemonic(128);
        await run(vault, mnemonic);

        await expect(run(vault, `  ${mnemonic.toUpperCase().replace(/ /g, '   ')}  `))
            .rejects.toThrow(/already in this app/);
    });

    it('accepts a different phrase', async () => {
        const vault = await openVault();
        await run(vault, generateBip39Mnemonic(128));
        await run(vault, generateBip39Mnemonic(128), { name: 'Other' });
        expect(await vault.wallets.list()).toHaveLength(2);
    });

    it('accepts the same phrase under a different BIP39 passphrase', async () => {
        const vault = await openVault();
        const mnemonic = generateBip39Mnemonic(128);
        await run(vault, mnemonic);
        await run(vault, mnemonic, { name: 'Hidden', bip39Passphrase: 'a passphrase' });
        expect(await vault.wallets.list()).toHaveLength(2);
    });
});
