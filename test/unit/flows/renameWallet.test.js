// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';

import { renameWallet } from '../../../packages/core/src/flows/renameWallet.js';
import { renameAccount } from '../../../packages/core/src/flows/renameAccount.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

function makeVault() {
    const put = vi.fn(async () => {});
    const accountPut = vi.fn(async () => {});
    const wallets = [
        { id: 'w', name: 'o', x: 1 },
        { id: 'other', name: 'Savings', x: 2 },
    ];
    const accounts = [
        { id: 'a', walletId: 'w', name: 'Main', x: 1 },
        { id: 'other-account', walletId: 'w', name: 'Savings', x: 2 },
    ];
    const get = vi.fn(async (id) => wallets.find((wallet) => wallet.id === id) ?? null);
    const list = vi.fn(async () => wallets);
    const accountGet = vi.fn(async (id) => accounts.find((account) => account.id === id) ?? null);
    const findBy = vi.fn(async (field, value) => accounts
        .filter((account) => account[field] === value));
    return {
        vault: {
            wallets: { get, list, put },
            accounts: { get: accountGet, findBy, put: accountPut },
        },
        get,
        list,
        put,
        accountPut,
    };
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

    it('rejects a duplicate wallet name case-insensitively', async () => {
        const { vault, put } = makeVault();

        await expect(renameWallet({ walletId: 'w', name: ' savings ', vault }))
            .rejects.toThrow('A wallet named "savings" already exists.');
        expect(put).not.toHaveBeenCalled();
    });

    it('enforces the 64-character limit in both rename flows', async () => {
        const name = 'x'.repeat(65);
        const { vault } = makeVault();

        await expect(renameWallet({ walletId: 'w', name, vault }))
            .rejects.toThrow(/64 characters or fewer/);
        await expect(renameAccount({ accountId: 'a', name, vault }))
            .rejects.toThrow(/64 characters or fewer/);
    });

    it('counts emoji as Unicode characters after trimming in both rename flows', async () => {
        const name = `  ${'🚀'.repeat(64)}  `;
        const { vault, put, accountPut } = makeVault();

        await expect(renameWallet({ walletId: 'w', name, vault }))
            .resolves.toMatchObject({ name: '🚀'.repeat(64) });
        await expect(renameAccount({ accountId: 'a', name, vault }))
            .resolves.toMatchObject({ name: '🚀'.repeat(64) });
        expect(put).toHaveBeenCalledOnce();
        expect(accountPut).toHaveBeenCalledOnce();
    });

    it('preserves emoji and right-to-left text', async () => {
        const { vault, put } = makeVault();

        await renameWallet({ walletId: 'w', name: '  ארנק 🚀  ', vault });

        expect(put).toHaveBeenCalledWith({ id: 'w', name: 'ארנק 🚀', x: 1 });
    });
});
