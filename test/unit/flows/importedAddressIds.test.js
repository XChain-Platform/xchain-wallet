// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { importedAddressIdsFor } from '../../../packages/core/src/flows/_importedAddressIds.js';

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
});
