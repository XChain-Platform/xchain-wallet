// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cleanup = vi.hoisted(() => ({
    gatedContent: vi.fn(),
    pendingGeneratedKeys: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/gatedContent.js', () => ({
    clearGatedContentCaches: cleanup.gatedContent,
}));

vi.mock('../../../packages/core/src/flows/gatedPublishAction.js', () => ({
    clearPendingGeneratedKeysForWallet: cleanup.pendingGeneratedKeys,
}));

import { removeWallet } from '../../../packages/core/src/flows/removeWallet.js';
import { renameWallet } from '../../../packages/core/src/flows/renameWallet.js';

function emptyCollection(records = []) {
    return {
        list: vi.fn(async () => records),
        findBy: vi.fn(async (field, value) => records.filter((record) => record[field] === value)),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
    };
}

function removalVault({ accounts = [], addresses = [], connectedSites = [] } = {}) {
    const wallet = { id: 'wallet-1', importedKeys: [] };
    return {
        wallet,
        vault: {
            wallets: {
                get: vi.fn(async (id) => (id === wallet.id ? wallet : null)),
                delete: vi.fn(async () => {}),
            },
            accounts: emptyCollection(accounts),
            addresses: emptyCollection(addresses),
            connectedSites: emptyCollection(connectedSites),
            pendingTxs: emptyCollection(),
            pendingAirdrops: emptyCollection(),
            pendingDeploys: emptyCollection(),
            multisigSigningSessions: emptyCollection(),
            coSignerAccounts: emptyCollection(),
            watchlistEntries: emptyCollection(),
            priceAlerts: emptyCollection(),
            gatedKeys: emptyCollection(),
            autopayOrders: emptyCollection(),
            signers: emptyCollection(),
        },
    };
}

beforeEach(() => {
    cleanup.gatedContent.mockReset();
    cleanup.pendingGeneratedKeys.mockReset();
});

describe('renameWallet boundaries', () => {
    it('accepts a trimmed name at the exact 64-character limit', async () => {
        const original = { id: 'wallet-1', name: 'Old', format: 'bip39' };
        const put = vi.fn(async () => {});
        const vault = {
            wallets: {
                get: vi.fn(async () => original),
                list: vi.fn(async () => [original]),
                put,
            },
        };
        const name = 'x'.repeat(64);

        await expect(renameWallet({ walletId: original.id, name: ` ${name} `, vault }))
            .resolves.toMatchObject({ name });
        expect(put).toHaveBeenCalledWith({ ...original, name });
    });

    it('allows a case-only rename of the same wallet', async () => {
        const original = { id: 'wallet-1', name: 'Savings' };
        const put = vi.fn(async () => {});
        const vault = {
            wallets: {
                get: vi.fn(async () => original),
                list: vi.fn(async () => [original, { id: 'wallet-2', name: 'Spending' }]),
                put,
            },
        };

        await expect(renameWallet({ walletId: original.id, name: 'savings', vault }))
            .resolves.toMatchObject({ name: 'savings' });
        expect(put).toHaveBeenCalledOnce();
    });

    it('propagates a storage failure without returning an updated record', async () => {
        const failure = new Error('wallet store unavailable');
        const vault = {
            wallets: {
                get: vi.fn(async () => ({ id: 'wallet-1', name: 'Old' })),
                list: vi.fn(async () => []),
                put: vi.fn(async () => { throw failure; }),
            },
        };

        await expect(renameWallet({ walletId: 'wallet-1', name: 'New', vault }))
            .rejects.toBe(failure);
    });
});

describe('removeWallet guard and interruption edges', () => {
    it.each([
        [{ vault: null, walletId: 'wallet-1' }, 'vault is required'],
        [{ vault: {}, walletId: '' }, 'walletId is required'],
        [{ vault: {}, walletId: null }, 'walletId is required'],
    ])('rejects invalid input before reading wallet records %#', async (args, message) => {
        await expect(removeWallet(args)).rejects.toThrow(message);
    });

    it('ignores connected sites whose account scope is absent or malformed', async () => {
        const sites = [
            { id: 'missing-permissions' },
            { id: 'missing-accounts', permissions: {} },
            { id: 'string-accounts', permissions: { accounts: 'account-1' } },
        ];
        const { vault, wallet } = removalVault({
            accounts: [{ id: 'account-1', walletId: 'wallet-1' }],
            connectedSites: sites,
        });

        const result = await removeWallet({ vault, walletId: wallet.id });

        expect(vault.connectedSites.put).not.toHaveBeenCalled();
        expect(vault.connectedSites.delete).not.toHaveBeenCalled();
        expect(result.removed.connectedSiteGrants).toBe(0);
    });

    it('stops before deleting the wallet or clearing caches when a child deletion fails', async () => {
        const account = { id: 'account-1', walletId: 'wallet-1' };
        const address = {
            id: 'address-1', accountId: account.id,
            chain: 'bitcoin', network: 'mainnet', address: 'bc1qsource',
        };
        const { vault, wallet } = removalVault({ accounts: [account], addresses: [address] });
        vault.addresses.delete.mockRejectedValue(new Error('address delete failed'));

        await expect(removeWallet({ vault, walletId: wallet.id }))
            .rejects.toThrow('address delete failed');
        expect(vault.wallets.delete).not.toHaveBeenCalled();
        expect(cleanup.gatedContent).not.toHaveBeenCalled();
        expect(cleanup.pendingGeneratedKeys).not.toHaveBeenCalled();
    });

    it('returns zero counts and clears wallet-scoped caches for an empty wallet', async () => {
        const { vault, wallet } = removalVault();

        const result = await removeWallet({ vault, walletId: wallet.id });

        expect(result.removed).toEqual({
            wallet: 1,
            accounts: 0,
            addresses: 0,
            signers: 0,
            pendingTxs: 0,
            pendingAirdrops: 0,
            pendingDeploys: 0,
            multisigSigningSessions: 0,
            coSignerAccounts: 0,
            watchlistEntries: 0,
            priceAlerts: 0,
            gatedKeys: 0,
            autopayOrders: 0,
            connectedSiteGrants: 0,
        });
        expect(cleanup.gatedContent).toHaveBeenCalledOnce();
        expect(cleanup.pendingGeneratedKeys).toHaveBeenCalledWith(wallet.id);
    });
});
