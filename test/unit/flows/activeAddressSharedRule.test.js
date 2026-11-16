// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const importedAddressIdsFor = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/_importedAddressIds.js', () => ({
    importedAddressIdsFor,
}));

const { resolveActiveAddresses } = await import('../../../packages/core/src/flows/activeAddress.js');

const account = {
    id: 'acct-a', walletId: 'w1',
    activeAddressByChainId: { 'bitcoin-regtest': 'wif1' },
};
const hd = {
    id: 'a0', accountId: 'acct-a', chain: 'bitcoin', network: 'regtest',
    source: 'hd', role: 'receive', derivationPath: "m/84'/0'/0'/0/0", address: 'addr_a0',
};
const imported = {
    id: 'wif1', accountId: null, chain: 'bitcoin', network: 'regtest',
    source: 'imported-wif', role: 'receive', derivationPath: null, address: 'addr_wif1',
};
const chainRegistry = {
    chainIdFor: (coin, network) => (
        coin === 'bitcoin' && network === 'regtest' ? 'bitcoin-regtest' : null
    ),
};

function vaultWith(importedKeys) {
    return {
        accounts: { get: async () => account },
        addresses: { list: async () => [hd, imported] },
        wallets: { get: async () => ({ id: 'w1', importedKeys }) },
    };
}

describe('resolveActiveAddresses uses the shared imported-address rule', () => {
    beforeEach(() => importedAddressIdsFor.mockReset());

    it('ignores the wallet record when the shared resolver returns no ids', async () => {
        importedAddressIdsFor.mockResolvedValue(new Set());
        const out = await resolveActiveAddresses({
            vault: vaultWith([{ addressId: 'wif1' }]), accountId: 'acct-a', chainRegistry,
        });

        expect(out['bitcoin-regtest'].id).toBe('a0');
    });

    it('accepts an imported id supplied only by the shared resolver', async () => {
        importedAddressIdsFor.mockResolvedValue(new Set(['wif1']));
        const out = await resolveActiveAddresses({
            vault: vaultWith([]), accountId: 'acct-a', chainRegistry,
        });

        expect(out['bitcoin-regtest']).toEqual({ id: 'wif1', address: 'addr_wif1' });
        expect(importedAddressIdsFor).toHaveBeenCalledWith(expect.anything(), 'w1');
    });
});
