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
// signers, pendingTxs, pendingAirdrops, pendingDeploys,
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

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} opts
 * @returns {Promise<{ removed: { wallet: 1, accounts: number, addresses: number, signers: number, pendingTxs: number, pendingAirdrops: number, pendingDeploys: number, multisigSigningSessions: number, coSignerAccounts: number, watchlistEntries: number, priceAlerts: number, gatedKeys: number, autopayOrders: number, connectedSiteGrants: number } }>}
 */
export async function removeWallet({ vault, walletId }) {
    if (!vault) throw new Error('removeWallet: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('removeWallet: walletId is required');
    }

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    // Resolve descendants up front. We delete by id, so capturing the
    // shape before mutating the vault keeps the bookkeeping honest.
    const accounts = await vault.accounts.findBy('walletId', walletId);
    const accountIds = new Set(accounts.map((a) => a.id));
    const importedAddrIds = new Set(wallet.importedKeys.map((k) => k.addressId));

    const connectedSites = await vault.connectedSites.list();
    const connectedSiteUpdates = [];
    const connectedSiteDeletes = [];
    for (const site of connectedSites) {
        const grantedAccounts = Array.isArray(site.permissions?.accounts)
            ? site.permissions.accounts
            : [];
        if (!grantedAccounts.some((id) => accountIds.has(id))) continue;
        const survivingAccounts = grantedAccounts.filter((id) => !accountIds.has(id));
        if (survivingAccounts.length === 0) {
            connectedSiteDeletes.push(site);
        } else {
            connectedSiteUpdates.push({
                ...site,
                permissions: { ...site.permissions, accounts: survivingAccounts },
            });
        }
    }

    const allAddresses = await vault.addresses.list();
    const addressesToDelete = allAddresses.filter((addr) =>
        (addr.accountId && accountIds.has(addr.accountId)) || importedAddrIds.has(addr.id),
    );
    const addressIdsToDelete = new Set(addressesToDelete.map((a) => a.id));
    const pendingScopesToDelete = new Set(addressesToDelete.map(pendingScopeForAddress));
    const survivingPendingScopes = new Set(
        allAddresses
            .filter((address) => !addressIdsToDelete.has(address.id))
            .map(pendingScopeForAddress),
    );

    const allPendingTxs = await vault.pendingTxs.list();
    const pendingTxsToDelete = allPendingTxs.filter((pending) => {
        const scope = pendingScopeForPendingTx(pending);
        return pendingScopesToDelete.has(scope) && !survivingPendingScopes.has(scope);
    });

    const pendingAirdrops = await vault.pendingAirdrops.findBy('walletId', walletId);
    const pendingDeploys = await vault.pendingDeploys.findBy('walletId', walletId);
    const multisigSessions = await vault.multisigSigningSessions.findBy('walletId', walletId);
    const coSignerAccounts = await vault.coSignerAccounts.findBy('walletId', walletId);
    const watchlistEntries = await vault.watchlistEntries.findBy('walletId', walletId);
    const priceAlerts = await vault.priceAlerts.findBy('walletId', walletId);
    const gatedKeys = await vault.gatedKeys.findBy('walletId', walletId);
    const autopayOrders = await vault.autopayOrders.findBy('walletId', walletId);
    const signers = await vault.signers.findBy('walletId', walletId);

    // Each collection mutation auto-saves the whole vault. Serial writes keep
    // an older encrypted snapshot from finishing last and restoring a deleted row.
    await deleteRecords(vault.addresses, addressesToDelete);
    for (const site of connectedSiteUpdates) await vault.connectedSites.put(site);
    await deleteRecords(vault.connectedSites, connectedSiteDeletes);
    await deleteRecords(vault.accounts, accounts);
    await deleteRecords(vault.signers, signers);
    await deleteRecords(vault.pendingTxs, pendingTxsToDelete);
    await deleteRecords(vault.pendingAirdrops, pendingAirdrops);
    await deleteRecords(vault.pendingDeploys, pendingDeploys);
    await deleteRecords(vault.multisigSigningSessions, multisigSessions);
    await deleteRecords(vault.coSignerAccounts, coSignerAccounts);
    await deleteRecords(vault.watchlistEntries, watchlistEntries);
    await deleteRecords(vault.priceAlerts, priceAlerts);
    await deleteRecords(vault.gatedKeys, gatedKeys);
    await deleteRecords(vault.autopayOrders, autopayOrders);
    await vault.wallets.delete(walletId);
    clearGatedContentCaches();
    clearPendingGeneratedKeysForWallet(walletId);

    return {
        removed: {
            wallet: 1,
            accounts: accounts.length,
            addresses: addressesToDelete.length,
            signers: signers.length,
            pendingTxs: pendingTxsToDelete.length,
            pendingAirdrops: pendingAirdrops.length,
            pendingDeploys: pendingDeploys.length,
            multisigSigningSessions: multisigSessions.length,
            coSignerAccounts: coSignerAccounts.length,
            watchlistEntries: watchlistEntries.length,
            priceAlerts: priceAlerts.length,
            gatedKeys: gatedKeys.length,
            autopayOrders: autopayOrders.length,
            connectedSiteGrants: connectedSiteUpdates.length + connectedSiteDeletes.length,
        },
    };
}

async function deleteRecords(collection, records) {
    for (const record of records) await collection.delete(record.id);
}

function pendingScopeForAddress(address) {
    return JSON.stringify([address.chain, address.network, address.address]);
}

function pendingScopeForPendingTx(pending) {
    return JSON.stringify([pending.chain, pending.network, pending.fromAddress]);
}
