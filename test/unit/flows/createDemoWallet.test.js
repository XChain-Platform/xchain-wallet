// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { generateBip39Mnemonic } = vi.hoisted(() => ({
    generateBip39Mnemonic: vi.fn(),
}));

vi.mock('../../../packages/core/src/crypto/mnemonic.js', async (importOriginal) => ({
    ...await importOriginal(),
    generateBip39Mnemonic,
}));

import { createDemoWallet } from '../../../packages/core/src/flows/createDemoWallet.js';
import { Vault } from '../../../packages/core/src/storage/Vault.js';
import { InMemoryBackend } from '../../../packages/core/src/storage/backend.js';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const CHAIN_IDS = [
    'bitcoin-regtest',
    'dogecoin-regtest',
    'litecoin-regtest',
];

function makeCollaborators() {
    const descriptors = Object.fromEntries(CHAIN_IDS.map((id) => {
        const coin = id.slice(0, id.indexOf('-'));
        return [id, {
            id,
            coin,
            networkKind: 'regtest',
            defaultAddressType: 'p2pkh',
            addressTypes: ['p2pkh'],
        }];
    }));
    const deriveAddress = vi.fn((publicKey) => `demo-${publicKey.slice(0, 24)}`);
    const chainRegistry = {
        has: vi.fn((id) => Boolean(descriptors[id])),
        get: vi.fn((id) => descriptors[id] ?? null),
        descriptorFor: vi.fn((id) => descriptors[id] ?? null),
        derivationPathFor: vi.fn((_id, _type, account, change, index) =>
            `m/44'/0'/${account}'/${change}/${index}`),
    };
    const sdkRegistry = {
        get: vi.fn(() => ({ wallet: { deriveAddress } })),
    };
    return { chainRegistry, sdkRegistry, deriveAddress };
}

async function create(overrides = {}) {
    const collaborators = makeCollaborators();
    const result = await createDemoWallet({ ...collaborators, ...overrides });
    return { result, ...collaborators };
}

describe('createDemoWallet', () => {
    beforeEach(() => {
        generateBip39Mnemonic.mockReset().mockReturnValue(MNEMONIC);
    });

    it('returns a wallet in a vault backed only by memory', async () => {
        const { result } = await create();

        expect(result.wallet).toEqual(await result.vault.wallets.get(result.wallet.id));
        expect(result.vault).toBeInstanceOf(Vault);
        expect(result.vault._backend).toBeInstanceOf(InMemoryBackend);
    });

    it('derives the same first address from the same mnemonic', async () => {
        const first = await create({ activeChainIds: ['bitcoin-regtest'] });
        const second = await create({ activeChainIds: ['bitcoin-regtest'] });
        generateBip39Mnemonic.mockReturnValueOnce(OTHER_MNEMONIC);
        const other = await create({ activeChainIds: ['bitcoin-regtest'] });

        expect(first.result.mnemonic).toBe(MNEMONIC);
        expect(second.result.mnemonic).toBe(MNEMONIC);
        expect(second.result.addresses[0].address.address)
            .toBe(first.result.addresses[0].address.address);
        expect(other.result.mnemonic).toBe(OTHER_MNEMONIC);
        expect(other.result.addresses[0].address.address)
            .not.toBe(first.result.addresses[0].address.address);
    });

    it('honors name and active-chain overrides', async () => {
        const activeChainIds = ['litecoin-regtest'];
        const { result, chainRegistry } = await create({
            activeChainIds,
            name: 'Temporary Preview',
        });

        expect(result.wallet.name).toBe('Temporary Preview');
        expect(result.addresses.map(({ chainId }) => chainId)).toEqual(activeChainIds);
        expect(chainRegistry.has).toHaveBeenCalledWith('litecoin-regtest');
        expect(chainRegistry.has).not.toHaveBeenCalledWith('bitcoin-regtest');
    });
});
