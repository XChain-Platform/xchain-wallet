// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    importedAddressIdsFor,
    importedAddressIdsForStrict,
    importedAddressIdsOfWallet,
} from '../../../packages/core/src/flows/_importedAddressIds.js';

describe('importedAddressIdsFor', () => {
    it.each([
        [null, 'wallet-1'],
        [{}, 'wallet-1'],
        [{ wallets: {} }, ''],
        [{ wallets: {} }, null],
    ])('returns an empty set for an unusable vault or wallet id', async (vault, walletId) => {
        await expect(importedAddressIdsFor(vault, walletId)).resolves.toEqual(new Set());
    });

    it('returns unique non-empty string address ids from the wallet', async () => {
        const get = vi.fn(async () => ({
            importedKeys: [
                { addressId: 'address-2' },
                null,
                { addressId: '' },
                { addressId: 3 },
                { addressId: 'address-1' },
                { addressId: 'address-2' },
            ],
        }));

        await expect(importedAddressIdsFor({ wallets: { get } }, 'wallet-1'))
            .resolves.toEqual(new Set(['address-2', 'address-1']));
        expect(get).toHaveBeenCalledWith('wallet-1');
    });

    it.each([null, {}, { importedKeys: 'address-1' }])(
        'returns an empty set when imported keys are absent or malformed',
        async (wallet) => {
            const vault = { wallets: { get: vi.fn(async () => wallet) } };
            await expect(importedAddressIdsFor(vault, 'wallet-1')).resolves.toEqual(new Set());
        },
    );

    it('fails open when the wallet record cannot be read', async () => {
        const vault = {
            wallets: { get: vi.fn(async () => { throw new Error('vault unavailable'); }) },
        };

        await expect(importedAddressIdsFor(vault, 'wallet-1')).resolves.toEqual(new Set());
    });

    it('offers a strict read for callers that require a complete inventory', async () => {
        const failure = new Error('vault unavailable');
        const vault = { wallets: { get: vi.fn(async () => { throw failure; }) } };

        await expect(importedAddressIdsForStrict(vault, 'wallet-1')).rejects.toBe(failure);
        await expect(importedAddressIdsForStrict({}, 'wallet-1')).rejects.toThrow(/unreadable/);
    });

    it('applies the same rule to a wallet record the caller already holds', async () => {
        const wallet = {
            importedKeys: [{ addressId: 'a' }, null, { addressId: '' }, { addressId: 7 }, { addressId: 'b' }],
        };
        expect(importedAddressIdsOfWallet(wallet)).toEqual(new Set(['a', 'b']));
        expect(importedAddressIdsOfWallet(null)).toEqual(new Set());
        expect(importedAddressIdsOfWallet({ importedKeys: 'a' })).toEqual(new Set());
        const get = vi.fn(async () => wallet);
        await expect(importedAddressIdsForStrict({ wallets: { get } }, 'wallet-1'))
            .resolves.toEqual(importedAddressIdsOfWallet(wallet));
    });
});
