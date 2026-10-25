// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A pasted descriptor is stored in the vault settings and read on every boot,
// so addCustomChain refuses one whose serialized form is oversized, extra
// fields included.

import { describe, it, expect } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { addCustomChain, MAX_CUSTOM_DESCRIPTOR_CHARS } from '../../../packages/core/src/flows/customChains.js';

const base = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const descriptor = (extra = {}) => ({
    ...base,
    id: 'forkcoin-regtest',
    coin: 'forkcoin',
    wifVersionByte: 0xef,
    derivationPaths: { p2pkh: "m/44'/9'/A'/C/I" },
    addressTypes: ['p2pkh'],
    defaultAddressType: 'p2pkh',
    icon: '',
    ...extra,
});

function makeVault() {
    let settings = {};
    return {
        settings: { get: async () => settings, put: async (next) => { settings = next; } },
        read: () => settings,
    };
}

describe('addCustomChain descriptor size', () => {
    it('stores a normal descriptor', async () => {
        const vault = makeVault();
        await addCustomChain({ vault, chainRegistry: new ChainRegistry(), descriptor: descriptor() });
        expect(vault.read().customChains).toHaveLength(1);
    });

    it('rejects a descriptor padded with a 1 MB extra field and stores nothing', async () => {
        const vault = makeVault();
        await expect(addCustomChain({
            vault,
            chainRegistry: new ChainRegistry(),
            descriptor: descriptor({ note: 'x'.repeat(1024 * 1024) }),
        })).rejects.toThrow(/too large/);
        expect(vault.read().customChains).toBeUndefined();
        expect(MAX_CUSTOM_DESCRIPTOR_CHARS).toBeLessThan(1024 * 1024);
    });
});
