// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The mainnet coin reserve ignores case and surrounding space.

import { describe, it, expect } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { hydrateCustomChainsFromSettings } from '../../../packages/core/src/registry/hydrateCustomChains.js';
import { addCustomChain } from '../../../packages/core/src/flows/customChains.js';
import { customChainReservedIdError, validateChainDescriptor } from '../../../packages/core/src/registry/validate.js';

const base = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-mainnet');
const descriptor = (extra = {}) => ({ ...base, ...extra });

function makeVault() {
    let settings = {};
    return { settings: { get: async () => settings, put: async (next) => { settings = next; } } };
}

const add = (d) => addCustomChain({ vault: makeVault(), chainRegistry: new ChainRegistry(), descriptor: d });

describe('custom network mainnet reserve', () => {
    it.each([
        ['mixed-case coin', { id: 'btcfork-mainnet', coin: 'Bitcoin' }],
        ['coin with trailing space', { id: 'btcfork-mainnet', coin: 'bitcoin ' }],
        ['coin with leading space', { id: 'btcfork-mainnet', coin: ' bitcoin' }],
        ['id extending a reserved id', { id: 'bitcoin-mainnet-x', coin: 'madeupcoin' }],
    ])('refuses %s', (_name, extra) => {
        expect(customChainReservedIdError(descriptor(extra))).toEqual(expect.any(String));
    });

    it('refuses a padded coin through addCustomChain', async () => {
        await expect(add(descriptor({ id: 'btcfork-mainnet', coin: 'bitcoin ' }))).rejects.toThrow(/can't be added/);
    });

    it('leaves a signed bundled descriptor and an unrelated coin alone', () => {
        expect(customChainReservedIdError(base)).toBeNull();
        expect(customChainReservedIdError(descriptor({ id: 'bitcoin-cash-mainnet', coin: 'bitcoincash' }))).toBeNull();
    });
});

describe('a stored same-id row that boot skips', () => {
    const pasted = descriptor({ id: 'btcfork-mainnet', coin: 'btcfork' });
    const vaultWith = (customChains) => {
        let settings = { customChains };
        return { settings: { get: async () => settings, put: async (next) => { settings = next; } } };
    };

    it.each(['Bitcoin', 'bitcoin', 'bitcoin '])('is replaced by the paste when its coin is %j', async (coin) => {
        const dead = descriptor({ id: 'btcfork-mainnet', coin });
        expect(validateChainDescriptor(dead).ok).toBe(true);
        expect(customChainReservedIdError(dead)).toEqual(expect.any(String));
        const vault = vaultWith([dead]);
        const chainRegistry = new ChainRegistry();
        const out = await addCustomChain({ vault, chainRegistry, descriptor: pasted });
        expect(out.replaced).toBe(true);
        expect(out.restored).toBeUndefined();
        expect((await vault.settings.get()).customChains).toEqual([pasted]);
        expect(chainRegistry.get('btcfork-mainnet').coin).toBe('btcfork');
        const boot = new ChainRegistry();
        hydrateCustomChainsFromSettings(boot, await vault.settings.get());
        expect(boot.get('btcfork-mainnet').coin).toBe('btcfork');
    });

    it('restores the next stored row boot would install', async () => {
        const dead = descriptor({ id: 'btcfork-mainnet', coin: 'Bitcoin' });
        const live = descriptor({ id: 'btcfork-mainnet', coin: 'btcfork', displayName: 'Fork B' });
        const vault = vaultWith([dead, live]);
        const chainRegistry = new ChainRegistry();
        const out = await addCustomChain({ vault, chainRegistry, descriptor: pasted });
        expect(out.restored).toBe(true);
        expect(out.descriptor).toEqual(live);
        expect((await vault.settings.get()).customChains).toEqual([dead, live]);
        expect(chainRegistry.get('btcfork-mainnet').displayName).toBe('Fork B');
    });
});
