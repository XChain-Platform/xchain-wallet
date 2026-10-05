// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';

import { removeWallet } from '../../../packages/core/src/flows/removeWallet.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

function makeVault() {
    const storedWallets = new Map([
        ['target', { id: 'target', importedKeys: [] }],
        ['other', { id: 'other', importedKeys: [] }],
    ]);
    const deleteWallet = vi.fn(async (id) => storedWallets.delete(id));
    const emptyFindBy = () => ({
        delete: vi.fn(async () => {}),
        findBy: vi.fn(async () => []),
    });

    const vault = {
        wallets: {
            delete: deleteWallet,
            get: vi.fn(async (id) => storedWallets.get(id) ?? null),
        },
        accounts: emptyFindBy(),
        addresses: { delete: vi.fn(), list: vi.fn(async () => []) },
        pendingTxs: { delete: vi.fn(), list: vi.fn(async () => []) },
        pendingAirdrops: emptyFindBy(),
        multisigSigningSessions: emptyFindBy(),
        watchlistEntries: emptyFindBy(),
        priceAlerts: emptyFindBy(),
        signers: emptyFindBy(),
    };

    return { deleteWallet, storedWallets, vault };
}

describe('removeWallet', () => {
    it('deletes the named wallet once and leaves other wallets untouched', async () => {
        const { deleteWallet, storedWallets, vault } = makeVault();

        const result = await removeWallet({ vault, walletId: 'target' });

        expect(deleteWallet).toHaveBeenCalledTimes(1);
        expect(deleteWallet).toHaveBeenCalledWith('target');
        expect(storedWallets.has('target')).toBe(false);
        expect(storedWallets.get('other')).toEqual({ id: 'other', importedKeys: [] });
        expect(result.removed.wallet).toBe(1);
    });

    it('rejects an unknown wallet without persisting', async () => {
        const { deleteWallet, storedWallets, vault } = makeVault();

        await expect(removeWallet({ vault, walletId: 'missing' }))
            .rejects.toBeInstanceOf(WalletNotFoundError);
        expect(deleteWallet).not.toHaveBeenCalled();
        expect([...storedWallets.keys()]).toEqual(['target', 'other']);
    });
});
