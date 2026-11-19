// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../../helpers/argon2idTimeout.js';
import { DuplicateWalletError } from '../../../../packages/core/src/flows/_persistHdWallet.js';
import { importMnemonic } from '../../../../packages/core/src/flows/importMnemonic.js';
import { ChainRegistry } from '../../../../packages/core/src/registry/index.js';
import { InMemoryBackend } from '../../../../packages/core/src/storage/backend.js';
import { Vault } from '../../../../packages/core/src/storage/Vault.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

const sdkRegistry = {
    get: () => ({ wallet: { deriveAddress: (publicKey, { type }) => `${type}_${publicKey}` } }),
};

function runImport(vault, chainRegistry, name) {
    return importMnemonic({
        password: 'correct-horse-battery-staple',
        mnemonic: MNEMONIC,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds: ['bitcoin-regtest'],
        name,
        kdfParams: KDF_PARAMS,
    });
}

describe('concurrent recovery phrase imports', () => {
    it('persists one complete wallet graph and rejects the duplicate', async () => {
        const vault = new Vault({
            backend: new InMemoryBackend(),
            masterKey: new Uint8Array(32).fill(9),
        });
        await vault.open();
        const chainRegistry = new ChainRegistry();
        const listAddresses = vault.addresses.list.bind(vault.addresses);
        let arrivals = 0;
        let release;
        const bothRead = new Promise((resolve) => { release = resolve; });
        vault.addresses.list = async () => {
            const rows = await listAddresses();
            arrivals += 1;
            if (arrivals === 2) release();
            await bothRead;
            return rows;
        };

        const results = await Promise.allSettled([
            runImport(vault, chainRegistry, 'First'),
            runImport(vault, chainRegistry, 'Second'),
        ]);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const [failure] = results.filter((result) => result.status === 'rejected');
        expect(failure.reason).toBeInstanceOf(DuplicateWalletError);
        expect(await vault.wallets.count()).toBe(1);
        expect(await vault.accounts.count()).toBe(1);
        expect(await vault.addresses.count()).toBe(1);
        expect(await vault.settings.get()).not.toBeNull();
    });
});
