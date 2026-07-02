// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Read-only queries over stored CoSignerAccounts (§22, P4). Used by the
// bridge transport to resolve which agent account an inbound co-sign request
// targets, and by the UI to list a wallet's accounts.

/**
 * List the co-signer accounts for a wallet, newest first.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @returns {Promise<import('../schemas/coSignerAccount.js').CoSignerAccount[]>}
 */
export async function listCoSignerAccounts(vault, walletId) {
    if (!vault || !vault.coSignerAccounts) throw new Error('listCoSignerAccounts: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('listCoSignerAccounts: walletId is required');
    }
    const all = await vault.coSignerAccounts.findBy('walletId', walletId);
    return all.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/**
 * Resolve the enabled co-signer account that owns an aggregate address on a
 * chain. The aggregate address is unique per (agent, daemon) key pair, so at
 * most one enabled match exists; a disabled account is not returned (the
 * daemon refuses it anyway, and an inbound request should read as "unknown").
 *
 * @param {object} args
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {string} args.chainId
 * @param {string} args.aggregateAddress
 * @returns {Promise<import('../schemas/coSignerAccount.js').CoSignerAccount | null>}
 */
export async function findCoSignerAccountByAddress({ vault, chainId, aggregateAddress } = {}) {
    if (!vault || !vault.coSignerAccounts) throw new Error('findCoSignerAccountByAddress: vault is required');
    if (typeof chainId !== 'string' || chainId.length === 0) {
        throw new Error('findCoSignerAccountByAddress: chainId is required');
    }
    if (typeof aggregateAddress !== 'string' || aggregateAddress.length === 0) {
        throw new Error('findCoSignerAccountByAddress: aggregateAddress is required');
    }
    const matches = await vault.coSignerAccounts.findBy('aggregateAddress', aggregateAddress);
    return (
        matches.find((a) => a.chainId === chainId && a.enabled !== false) ?? null
    );
}
