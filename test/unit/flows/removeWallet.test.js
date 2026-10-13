// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { removeWallet } from '../../../packages/core/src/flows/removeWallet.js';
import { WalletNotFoundError } from '../../../packages/core/src/flows/unlockWallet.js';

const cacheCleanup = vi.hoisted(() => ({
    gatedContent: vi.fn(),
    pendingGeneratedKeys: vi.fn(),
}));

vi.mock('../../../packages/core/src/flows/gatedContent.js', () => ({
    clearGatedContentCaches: cacheCleanup.gatedContent,
}));

vi.mock('../../../packages/core/src/flows/gatedPublishAction.js', () => ({
    clearPendingGeneratedKeysForWallet: cacheCleanup.pendingGeneratedKeys,
}));

function makeVault() {
    const storedWallets = new Map([
        ['target', { id: 'target', importedKeys: [] }],
        ['other', { id: 'other', importedKeys: [] }],
    ]);
    const deleteWallet = vi.fn(async (id) => storedWallets.delete(id));
    const persisted = { addresses: [] };
    let addressDeleteCount = 0;
    const records = {
        accounts: [],
        addresses: [],
        pendingTxs: [],
        pendingAirdrops: [],
        pendingDeploys: [],
        multisigSigningSessions: [],
        coSignerAccounts: [],
        watchlistEntries: [],
        priceAlerts: [],
        gatedKeys: [],
        autopayOrders: [],
        signers: [],
        connectedSites: [],
    };
    const collection = (name) => ({
        delete: vi.fn(async (id) => {
            const index = records[name].findIndex((record) => record.id === id);
            if (index >= 0) records[name].splice(index, 1);
        }),
        findBy: vi.fn(async (field, value) =>
            records[name].filter((record) => record[field] === value)),
    });

    const vault = {
        wallets: {
            delete: deleteWallet,
            get: vi.fn(async (id) => storedWallets.get(id) ?? null),
        },
        accounts: collection('accounts'),
        addresses: {
            delete: vi.fn(async (id) => {
                const index = records.addresses.findIndex((record) => record.id === id);
                if (index >= 0) records.addresses.splice(index, 1);
                const snapshot = records.addresses.map((record) => ({ ...record }));
                const delay = addressDeleteCount === 0 ? 10 : 0;
                addressDeleteCount += 1;
                await new Promise((resolve) => setTimeout(resolve, delay));
                persisted.addresses = snapshot;
            }),
            list: vi.fn(async () => records.addresses),
        },
        pendingTxs: {
            delete: vi.fn(async (id) => {
                const index = records.pendingTxs.findIndex((record) => record.id === id);
                if (index >= 0) records.pendingTxs.splice(index, 1);
            }),
            list: vi.fn(async () => records.pendingTxs),
        },
        pendingAirdrops: collection('pendingAirdrops'),
        pendingDeploys: collection('pendingDeploys'),
        multisigSigningSessions: collection('multisigSigningSessions'),
        coSignerAccounts: collection('coSignerAccounts'),
        watchlistEntries: collection('watchlistEntries'),
        priceAlerts: collection('priceAlerts'),
        gatedKeys: collection('gatedKeys'),
        autopayOrders: collection('autopayOrders'),
        signers: collection('signers'),
        connectedSites: {
            delete: vi.fn(async (id) => {
                const index = records.connectedSites.findIndex((record) => record.id === id);
                if (index >= 0) records.connectedSites.splice(index, 1);
            }),
            list: vi.fn(async () => records.connectedSites),
            put: vi.fn(async (record) => {
                const index = records.connectedSites.findIndex(({ id }) => id === record.id);
                if (index >= 0) records.connectedSites[index] = record;
                else records.connectedSites.push(record);
            }),
        },
    };

    return { deleteWallet, persisted, records, storedWallets, vault };
}

describe('removeWallet', () => {
    beforeEach(() => {
        cacheCleanup.gatedContent.mockClear();
        cacheCleanup.pendingGeneratedKeys.mockClear();
    });

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

    it('deletes every wallet-owned record and preserves records owned by another wallet', async () => {
        const { persisted, records, storedWallets, vault } = makeVault();
        const ownedCollections = [
            'accounts',
            'pendingAirdrops',
            'pendingDeploys',
            'multisigSigningSessions',
            'coSignerAccounts',
            'watchlistEntries',
            'priceAlerts',
            'gatedKeys',
            'autopayOrders',
            'signers',
        ];
        for (const name of ownedCollections) {
            records[name].push(
                { id: `${name}-target`, walletId: 'target' },
                { id: `${name}-other`, walletId: 'other' },
            );
        }
        storedWallets.get('target').importedKeys.push({ addressId: 'imported-target' });
        records.addresses.push(
            { id: 'derived-target', accountId: 'accounts-target', address: 'target-derived' },
            { id: 'imported-target', accountId: null, address: 'target-imported' },
            { id: 'derived-other', accountId: 'accounts-other', address: 'other-derived' },
        );
        records.pendingTxs.push(
            { id: 'tx-target', fromAddress: 'target-derived' },
            { id: 'tx-other', fromAddress: 'other-derived' },
        );
        records.connectedSites.push(
            {
                id: 'mixed-site',
                permissions: { accounts: ['accounts-target', 'accounts-other'] },
            },
            {
                id: 'target-site',
                permissions: { accounts: ['accounts-target'] },
            },
            {
                id: 'other-site',
                permissions: { accounts: ['accounts-other'] },
            },
        );

        const result = await removeWallet({ vault, walletId: 'target' });

        for (const name of ownedCollections) {
            expect(records[name], name).toEqual([
                { id: `${name}-other`, walletId: 'other' },
            ]);
            expect(result.removed[name], name).toBe(1);
        }
        expect(records.addresses).toEqual([
            { id: 'derived-other', accountId: 'accounts-other', address: 'other-derived' },
        ]);
        expect(persisted.addresses).toEqual(records.addresses);
        expect(records.pendingTxs).toEqual([
            { id: 'tx-other', fromAddress: 'other-derived' },
        ]);
        expect(records.connectedSites).toEqual([
            { id: 'mixed-site', permissions: { accounts: ['accounts-other'] } },
            { id: 'other-site', permissions: { accounts: ['accounts-other'] } },
        ]);
        expect(result.removed).toMatchObject({
            addresses: 2,
            pendingTxs: 1,
            connectedSiteGrants: 2,
        });
        expect(cacheCleanup.gatedContent).toHaveBeenCalledOnce();
        expect(cacheCleanup.pendingGeneratedKeys).toHaveBeenCalledWith('target');
    });
});
