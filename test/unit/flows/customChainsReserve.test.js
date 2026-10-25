// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The mainnet coin reserve ignores case and surrounding space.

import { describe, it, expect } from 'vitest';
import { ChainRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';
import { addCustomChain } from '../../../packages/core/src/flows/customChains.js';
import { customChainReservedIdError } from '../../../packages/core/src/registry/validate.js';

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
