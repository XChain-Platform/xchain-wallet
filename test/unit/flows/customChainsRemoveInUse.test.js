// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Address records name their chain by coin and network, not by chain id. A
// custom network that a wallet account still holds addresses on refuses
// removal before anything is written, so the account never holds addresses no
// registered chain can show or spend.

import { describe, it, expect, vi } from 'vitest';
import { ChainRegistry } from '../../../packages/core/src/registry/index.js';
import { addCustomChain, removeCustomChain } from '../../../packages/core/src/flows/customChains.js';

const DESCRIPTOR = Object.freeze({
    id: 'forkcoin-regtest',
    coin: 'forkcoin',
    displayName: 'ForkCoin Regtest',
    networkKind: 'regtest',
    color: '#A1B2C3',
    icon: '',
    derivationPaths: { p2pkh: "m/44'/0'/A'/C/I" },
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    feeStrategy: {
        unit: 'sats-per-kbyte',
        supportedStrategies: ['low', 'normal', 'fast'],
        defaultStrategy: 'normal',
        rbfSupported: false,
    },
    supportedActions: ['SEND'],
    uriScheme: 'forkcoin',
    wifVersionByte: 0xef,
    explorer: { defaultUrl: 'http://localhost', defaultPort: 18080 },
    encoder: { defaultUrl: 'http://localhost', defaultPort: 18081 },
    hub: { defaultUrl: 'http://localhost', defaultPort: 18082 },
    adsDonationAddress: 'PLACEHOLDER_REPLACE_BEFORE_MAINNET',
});

/**
 * A vault stub with a settings store and, unless `addresses` is null, an
 * address store. `puts` counts settings writes after setup.
 */
function createVaultStub(addresses) {
    let settings = { schemaVersion: 2 };
    const vault = {
        settings: {
            get: vi.fn(async () => settings),
            put: vi.fn(async (next) => { settings = { ...next }; }),
        },
        read: () => settings,
    };
    if (addresses !== null) {
        vault.addresses = { list: vi.fn(async () => addresses.map((a) => ({ ...a }))) };
    }
    return vault;
}

const addressRow = (chain, network) => ({
    id: `addr-${chain}-${network}`,
    accountId: 'account-1',
    chain,
    network,
    address: 'probe-address',
});

async function setup(addresses) {
    const vault = createVaultStub(addresses);
    const chainRegistry = new ChainRegistry();
    await addCustomChain({ vault, chainRegistry, descriptor: { ...DESCRIPTOR } });
    vault.settings.put.mockClear();
    const removeCustom = vi.spyOn(chainRegistry, 'removeCustom');
    return { vault, chainRegistry, removeCustom };
}

describe('removeCustomChain while a wallet account holds addresses on the network', () => {
    it('refuses and leaves the stored list, the registry and the settings untouched', async () => {
        const { vault, chainRegistry, removeCustom } = await setup([addressRow('forkcoin', 'regtest')]);
        const before = JSON.parse(JSON.stringify(vault.read().customChains));

        await expect(removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id }))
            .rejects.toThrow(/still holds addresses/);

        expect(vault.settings.put).not.toHaveBeenCalled();
        expect(removeCustom).not.toHaveBeenCalled();
        expect(chainRegistry.has(DESCRIPTOR.id)).toBe(true);
        expect(vault.read().customChains).toEqual(before);
    });

    it('refuses for a live user-added chain absent from the persisted list', async () => {
        const vault = createVaultStub([addressRow('forkcoin', 'regtest')]);
        const chainRegistry = new ChainRegistry();
        chainRegistry.addCustom({ ...DESCRIPTOR });
        expect(chainRegistry.get(DESCRIPTOR.id)?.isUserAdded).toBe(true);
        const removeCustom = vi.spyOn(chainRegistry, 'removeCustom');

        await expect(removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id }))
            .rejects.toThrow(/still holds addresses/);

        expect(vault.settings.put).not.toHaveBeenCalled();
        expect(removeCustom).not.toHaveBeenCalled();
        expect(chainRegistry.has(DESCRIPTOR.id)).toBe(true);
    });
});

describe('removeCustomChain with no wallet address on the network', () => {
    it('removes the network when the only row is the same coin on another network', async () => {
        const { vault, chainRegistry } = await setup([addressRow('forkcoin', 'testnet')]);

        await expect(removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id }))
            .resolves.toEqual({ removed: true });
        expect(chainRegistry.has(DESCRIPTOR.id)).toBe(false);
        expect(vault.read().customChains).toEqual([]);
    });

    it('removes the network when the only row is another coin on the same network', async () => {
        const { vault, chainRegistry } = await setup([addressRow('bitcoin', 'regtest')]);

        await expect(removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id }))
            .resolves.toEqual({ removed: true });
        expect(chainRegistry.has(DESCRIPTOR.id)).toBe(false);
    });

    it('removes the network from a vault with no address store', async () => {
        const { vault, chainRegistry } = await setup(null);

        await expect(removeCustomChain({ vault, chainRegistry, chainId: DESCRIPTOR.id }))
            .resolves.toEqual({ removed: true });
        expect(chainRegistry.has(DESCRIPTOR.id)).toBe(false);
    });
});
