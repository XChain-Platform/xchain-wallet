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
// signers, pendingTxs, pendingAirdrops, multisigSigningSessions,
// watchlistEntries, priceAlerts.
//
// Vault-level singletons (settings) and shared collections (contacts,
// connectedSites) survive; they aren't owned by a single wallet.
//
// SignerPool eviction is the responsibility of the host handler that
// wraps this flow; the core flow is vault-only.
//
// Order matters: addresses depend on accounts (we resolve account ids
// first, then derive the linked address ids before we delete accounts).

import { WalletNotFoundError } from './unlockWallet.js';

/**
 * @param {{ vault: import('../storage/Vault.js').Vault, walletId: string }} opts
 * @returns {Promise<{ removed: { wallet: 1, accounts: number, addresses: number, signers: number, pendingTxs: number, pendingAirdrops: number, multisigSigningSessions: number, watchlistEntries: number, priceAlerts: number } }>}
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

    const allAddresses = await vault.addresses.list();
    const addressesToDelete = allAddresses.filter((addr) =>
        (addr.accountId && accountIds.has(addr.accountId)) || importedAddrIds.has(addr.id),
    );
    const addressStrings = new Set(addressesToDelete.map((a) => a.address));

    const allPendingTxs = await vault.pendingTxs.list();
    const pendingTxsToDelete = allPendingTxs.filter((p) => addressStrings.has(p.fromAddress));

    const pendingAirdrops = await vault.pendingAirdrops.findBy('walletId', walletId);
    const multisigSessions = await vault.multisigSigningSessions.findBy('walletId', walletId);
    const watchlistEntries = await vault.watchlistEntries.findBy('walletId', walletId);
    const priceAlerts = await vault.priceAlerts.findBy('walletId', walletId);
    const signers = await vault.signers.findBy('walletId', walletId);

    // Delete in dependency order: leaves first, root last.
    await Promise.all(addressesToDelete.map((a) => vault.addresses.delete(a.id)));
    await Promise.all(accounts.map((a) => vault.accounts.delete(a.id)));
    await Promise.all(signers.map((s) => vault.signers.delete(s.id)));
    await Promise.all(pendingTxsToDelete.map((p) => vault.pendingTxs.delete(p.id)));
    await Promise.all(pendingAirdrops.map((p) => vault.pendingAirdrops.delete(p.id)));
    await Promise.all(multisigSessions.map((s) => vault.multisigSigningSessions.delete(s.id)));
    await Promise.all(watchlistEntries.map((w) => vault.watchlistEntries.delete(w.id)));
    await Promise.all(priceAlerts.map((p) => vault.priceAlerts.delete(p.id)));
    await vault.wallets.delete(walletId);

    return {
        removed: {
            wallet: 1,
            accounts: accounts.length,
            addresses: addressesToDelete.length,
            signers: signers.length,
            pendingTxs: pendingTxsToDelete.length,
            pendingAirdrops: pendingAirdrops.length,
            multisigSigningSessions: multisigSessions.length,
            watchlistEntries: watchlistEntries.length,
            priceAlerts: priceAlerts.length,
        },
    };
}
