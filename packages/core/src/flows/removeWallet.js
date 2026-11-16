// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// removeWallet: destructive flow that deletes a Wallet record and all
// records linked to it: accounts, addresses (HD-derived + imported-WIF),
// signers, pendingTxs, pendingAirdrops, pendingFileUploads, pendingDeploys,
// multisigSigningSessions, coSignerAccounts, watchlistEntries,
// priceAlerts, gatedKeys, autopayOrders.
//
// Vault-level singletons (settings) and contacts survive. Connected-site
// grants lose references to removed accounts, and a grant with no surviving
// accounts is revoked because an empty account scope means all accounts.
//
// SignerPool eviction is the responsibility of the host handler that
// wraps this flow; the core flow is vault-only.
//
// Order matters: addresses depend on accounts (we resolve account ids
// first, then derive the linked address ids before we delete accounts).

import { WalletNotFoundError } from './unlockWallet.js';
import { clearGatedContentCaches } from './gatedContent.js';
import { clearPendingGeneratedKeysForWallet } from './gatedPublishAction.js';
import { withAccountLock } from '../cosigner/accountLock.js';

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} opts
 * @returns {Promise<{ removed: { wallet: 1, accounts: number, addresses: number, signers: number, pendingTxs: number, pendingAirdrops: number, pendingFileUploads: number, pendingDeploys: number, multisigSigningSessions: number, coSignerAccounts: number, watchlistEntries: number, priceAlerts: number, gatedKeys: number, autopayOrders: number, connectedSiteGrants: number } }>}
 */
export async function removeWallet({ vault, walletId }) {
    if (!vault) throw new Error('removeWallet: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('removeWallet: walletId is required');
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const state = await collectRemovalState(vault, wallet, walletId);
    await deleteWalletChildren(vault, state);
    await vault.wallets.delete(walletId);
    const lateCoSignerAccounts = await vault.coSignerAccounts.findBy('walletId', walletId);
    await deleteCoSignerAccounts(vault, lateCoSignerAccounts);
    clearGatedContentCaches();
    clearPendingGeneratedKeysForWallet(walletId);
    return { removed: removalCounts(state, lateCoSignerAccounts.length) };
}

function connectedSitePlan(sites, accountIds) {
    const updates = [];
    const deletes = [];
    for (const site of sites) {
        const granted = Array.isArray(site.permissions?.accounts) ? site.permissions.accounts : [];
        if (!granted.some((id) => accountIds.has(id))) continue;
        const surviving = granted.filter((id) => !accountIds.has(id));
        if (surviving.length === 0) deletes.push(site);
        else {
            updates.push({
                ...site,
                permissions: { ...site.permissions, accounts: surviving },
            });
        }
    }
    return { updates, deletes };
}

function pendingTxsForDeletedAddresses(pendingTxs, allAddresses, addresses) {
    const deletedIds = new Set(addresses.map((address) => address.id));
    const deletedScopes = new Set(addresses.map(pendingScopeForAddress));
    const survivingScopes = new Set(allAddresses
        .filter((address) => !deletedIds.has(address.id))
        .map(pendingScopeForAddress));
    return pendingTxs.filter((pending) => {
        const scope = pendingScopeForPendingTx(pending);
        return deletedScopes.has(scope) && !survivingScopes.has(scope);
    });
}

async function walletOwnedRecords(vault, walletId) {
    const names = [
        'signers', 'pendingAirdrops', 'pendingDeploys', 'multisigSigningSessions',
        'coSignerAccounts', 'watchlistEntries', 'priceAlerts', 'gatedKeys', 'autopayOrders',
    ];
    if (vault.pendingFileUploads) names.splice(3, 0, 'pendingFileUploads');
    const entries = await Promise.all(names.map(async (name) => [
        name,
        await vault[name].findBy('walletId', walletId),
    ]));
    return Object.fromEntries(entries);
}

async function collectRemovalState(vault, wallet, walletId) {
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIds = new Set(accounts.map((account) => account.id));
    const importedIds = new Set(wallet.importedKeys.map((key) => key.addressId));
    const allAddresses = await vault.addresses.list();
    const addresses = allAddresses.filter((address) =>
        (address.accountId && accountIds.has(address.accountId)) || importedIds.has(address.id));
    const pendingTxs = pendingTxsForDeletedAddresses(
        await vault.pendingTxs.list(), allAddresses, addresses);
    const connectedSites = connectedSitePlan(await vault.connectedSites.list(), accountIds);
    return {
        accounts,
        addresses,
        pendingTxs,
        connectedSites,
        owned: await walletOwnedRecords(vault, walletId),
    };
}

async function deleteWalletChildren(vault, state) {
    await deleteRecords(vault.addresses, state.addresses);
    for (const site of state.connectedSites.updates) await vault.connectedSites.put(site);
    await deleteRecords(vault.connectedSites, state.connectedSites.deletes);
    await deleteRecords(vault.accounts, state.accounts);
    await deleteRecords(vault.signers, state.owned.signers);
    await deleteRecords(vault.pendingTxs, state.pendingTxs);
    await deleteRecords(vault.pendingAirdrops, state.owned.pendingAirdrops);
    if (vault.pendingFileUploads) {
        await deleteRecords(vault.pendingFileUploads, state.owned.pendingFileUploads);
    }
    await deleteRecords(vault.pendingDeploys, state.owned.pendingDeploys);
    await deleteRecords(vault.multisigSigningSessions, state.owned.multisigSigningSessions);
    await deleteCoSignerAccounts(vault, state.owned.coSignerAccounts);
    await deleteRecords(vault.watchlistEntries, state.owned.watchlistEntries);
    await deleteRecords(vault.priceAlerts, state.owned.priceAlerts);
    await deleteRecords(vault.gatedKeys, state.owned.gatedKeys);
    await deleteRecords(vault.autopayOrders, state.owned.autopayOrders);
}

function removalCounts(state, lateCoSignerCount) {
    const removed = {
        wallet: 1,
        accounts: state.accounts.length,
        addresses: state.addresses.length,
        signers: state.owned.signers.length,
        pendingTxs: state.pendingTxs.length,
        pendingAirdrops: state.owned.pendingAirdrops.length,
        pendingDeploys: state.owned.pendingDeploys.length,
        multisigSigningSessions: state.owned.multisigSigningSessions.length,
        coSignerAccounts: state.owned.coSignerAccounts.length + lateCoSignerCount,
        watchlistEntries: state.owned.watchlistEntries.length,
        priceAlerts: state.owned.priceAlerts.length,
        gatedKeys: state.owned.gatedKeys.length,
        autopayOrders: state.owned.autopayOrders.length,
        connectedSiteGrants: state.connectedSites.updates.length + state.connectedSites.deletes.length,
    };
    if (state.owned.pendingFileUploads) {
        removed.pendingFileUploads = state.owned.pendingFileUploads.length;
    }
    return removed;
}

async function deleteRecords(collection, records) {
    for (const record of records) await collection.delete(record.id);
}

// Delete under the account lock (a window write or policy edit puts the whole
// record back, so it must finish before the delete or see it saved).
async function deleteCoSignerAccounts(vault, records) {
    for (const record of records) {
        await withAccountLock(record.id, () => vault.coSignerAccounts.delete(record.id));
    }
}

function pendingScopeForAddress(address) {
    return JSON.stringify([address.chain, address.network, address.address]);
}

function pendingScopeForPendingTx(pending) {
    return JSON.stringify([pending.chain, pending.network, pending.fromAddress]);
}
