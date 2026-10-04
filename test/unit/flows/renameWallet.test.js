// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';

import { renameWallet } from '../../../packages/core/src/flows/renameWallet.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

function makeVault() {
    const put = vi.fn(async () => {});
    const get = vi.fn(async (id) => (
        id === 'w' ? { id: 'w', name: 'o', x: 1 } : null
    ));
    return { vault: { wallets: { get, put } }, get, put };
}

describe('renameWallet', () => {
    it.each(['', null, 7])('rejects invalid walletId %j', async (walletId) => {
        const { vault } = makeVault();
        await expect(renameWallet({ walletId, name: 'New', vault }))
            .rejects.toMatchObject({ message: 'renameWallet: walletId is required' });
    });

    it.each(['', '   ', null, 7])('rejects invalid name %j', async (name) => {
        const { vault } = makeVault();
        await expect(renameWallet({ walletId: 'w', name, vault }))
            .rejects.toMatchObject({ message: 'renameWallet: name must be a non-empty string' });
    });

    it('requires a vault', async () => {
        await expect(renameWallet({ walletId: 'w', name: 'New' }))
            .rejects.toMatchObject({ message: 'renameWallet: vault is required' });
    });

    it('stores and returns the trimmed rename with other fields preserved', async () => {
        const { vault, get, put } = makeVault();
        const updated = await renameWallet({ walletId: 'w', name: '  New ', vault });

        expect(get).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledWith('w');
        expect(put).toHaveBeenCalledTimes(1);
        expect(put).toHaveBeenCalledWith({ id: 'w', name: 'New', x: 1 });
        expect(updated).toEqual({ id: 'w', name: 'New', x: 1 });
    });

    it('rejects an unknown id without storing', async () => {
        const { vault, put } = makeVault();

        await expect(renameWallet({ walletId: 'missing', name: 'New', vault }))
            .rejects.toBeInstanceOf(WalletNotFoundError);
        expect(put).not.toHaveBeenCalled();
    });
});
