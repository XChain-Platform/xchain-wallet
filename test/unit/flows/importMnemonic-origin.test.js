// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// regression (xchain-wallet#56): the Create screen generates the phrase
// in-app but persists it through importMnemonic, which defaulted the
// origin from the format, so a created wallet's details read "Imported
// from a recovery phrase". The Create screen now passes origin 'created'
// and the flow keeps it; a plain import still gets the format default.

import { describe, it, expect, vi } from 'vitest';

import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { importMnemonic } from '../../../packages/core/src/flows/importMnemonic.js';
import { generateBip39Mnemonic } from '../../../packages/core/src/crypto/mnemonic.js';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

// Below the production floor on purpose: the origin label is under test,
// not Argon2id's cost.
const LOW_COST_KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

async function run(overrides = {}) {
    const vault = new Vault({ backend: new InMemoryBackend(), masterKey: new Uint8Array(32).fill(9) });
    await vault.open();
    const chainRegistry = new ChainRegistry();
    const result = await importMnemonic({
        password: 'correct-horse-battery-staple',
        mnemonic: generateBip39Mnemonic(128),
        vault,
        chainRegistry,
        // Address derivation is not under test; the signer needs only this.
        sdkRegistry: { get: () => ({ wallet: { deriveAddress: (pub, { type }) => `${type}_${pub.slice(0, 16)}` } }) },
        activeChainIds: ['bitcoin-regtest'],
        name: 'Origin Test',
        kdfParams: LOW_COST_KDF_PARAMS,
        ...overrides,
    });
    return { result, stored: await vault.wallets.get(result.wallet.id) };
}

describe('importMnemonic origin', () => {
    it('keeps origin "created" for a wallet generated on the Create screen', async () => {
        const { result, stored } = await run({ origin: 'created' });
        expect(result.wallet.origin).toBe('created');
        expect(stored.origin).toBe('created');
    });

    it('still defaults a plain BIP39 import to "imported-mnemonic"', async () => {
        const { stored } = await run();
        expect(stored.origin).toBe('imported-mnemonic');
    });

    it('refuses an origin outside the known set', async () => {
        await expect(run({ origin: 'made-up' })).rejects.toThrow(/unsupported origin/);
    });
});
