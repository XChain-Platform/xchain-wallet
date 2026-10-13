// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
    deriveMasterKeyAsync: vi.fn(async () => new Uint8Array(32).fill(7)),
    decrypt: vi.fn(async () => new TextEncoder().encode('confirmed-private-key')),
}));

vi.mock('../../../packages/core/src/crypto/index.js', async (importOriginal) => ({
    ...await importOriginal(),
    deriveMasterKeyAsync: cryptoMocks.deriveMasterKeyAsync,
    decrypt: cryptoMocks.decrypt,
}));

import { exportPrivateKey } from '../../../packages/core/src/flows/exportPrivateKey.js';

const address = {
    id: 'a1',
    source: 'imported-wif',
    address: 'test-address',
    chain: 'bitcoin',
    network: 'regtest',
};
const wallet = {
    id: 'w1',
    format: 'wif-only',
    kdfParams: {},
    importedKeys: [{ addressId: address.id, encryptedWif: 'AA==' }],
};
const vault = {
    addresses: { get: vi.fn(async () => address) },
    wallets: { get: vi.fn(async () => wallet) },
};
const chainRegistry = { chainIdFor: vi.fn(() => 'bitcoin-regtest') };

beforeEach(() => {
    cryptoMocks.deriveMasterKeyAsync.mockClear();
    cryptoMocks.decrypt.mockClear();
});

describe('exportPrivateKey password confirmation', () => {
    it('verifies a supplied password instead of using the session signer', async () => {
        const signer = {
            exportWifForPath: vi.fn(),
            exportWifForAddressId: vi.fn(() => 'session-private-key'),
        };

        const result = await exportPrivateKey({
            vault,
            walletId: wallet.id,
            signer,
            password: 'wallet-password',
            chainRegistry,
            addressId: address.id,
        });

        expect(cryptoMocks.deriveMasterKeyAsync).toHaveBeenCalledWith(
            'wallet-password',
            wallet.kdfParams,
        );
        expect(signer.exportWifForAddressId).not.toHaveBeenCalled();
        expect(result.wif).toBe('confirmed-private-key');
    });
});
