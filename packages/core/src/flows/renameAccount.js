// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// renameAccount: change the `name` field on an Account record. Pure
// vault metadata update; no signer needed. Twin of renameWallet.

/**
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.name
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @returns {Promise<import('../schemas/account.js').Account>}
 */
export async function renameAccount({ accountId, name, vault }) {
    if (typeof accountId !== 'string' || accountId.length === 0) {
        throw new Error('renameAccount: accountId is required');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('renameAccount: name must be a non-empty string');
    }
    if (!vault) throw new Error('renameAccount: vault is required');

    const account = await vault.accounts.get(accountId);
    if (!account) throw new Error('renameAccount: account not found: ' + accountId);

    const updated = { ...account, name: name.trim() };
    await vault.accounts.put(updated);
    return updated;
}
