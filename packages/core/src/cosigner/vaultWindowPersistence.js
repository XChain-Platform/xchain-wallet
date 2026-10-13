// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vault-backed persistence port for the co-signer spending window (§22, P4).
//
// The spending-window state lives on the CoSignerAccount record's `window`
// field (one collection to migrate, not two). This adapter satisfies the
// VaultWindowStore persistence port { read(), write() } against that field,
// and a small factory builds a ready-to-use store for an account.

import { VaultWindowStore } from './vaultWindowStore.js';

/**
 * Persistence port reading/writing the `window` field of one CoSignerAccount.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} accountId
 * @param {{ walletId?: string, chainId?: string }} [expectedScope]
 * @returns {import('./vaultWindowStore.js').WindowPersistence}
 */
export function createVaultWindowPersistence(vault, accountId, expectedScope = {}) {
    if (!vault || !vault.coSignerAccounts
        || typeof vault.coSignerAccounts.get !== 'function'
        || typeof vault.coSignerAccounts.put !== 'function') {
        throw new Error('createVaultWindowPersistence: vault with coSignerAccounts is required');
    }
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
        throw new Error('createVaultWindowPersistence: accountId is required');
    }
    if (!expectedScope || typeof expectedScope !== 'object' || Array.isArray(expectedScope)) {
        throw new Error('createVaultWindowPersistence: expectedScope must be an object');
    }

    function requireAccountScope(acct) {
        if (!acct) throw new Error(`coSignerAccount "${accountId}" not found`);
        if (acct.id !== accountId) {
            throw new Error(`coSignerAccount "${accountId}" resolved to a different account`);
        }
        for (const field of ['walletId', 'chainId']) {
            if (expectedScope[field] !== undefined && acct[field] !== expectedScope[field]) {
                throw new Error(`coSignerAccount "${accountId}" ${field} changed`);
            }
        }
        return acct;
    }

    return {
        async read() {
            const acct = requireAccountScope(await vault.coSignerAccounts.get(accountId));
            return acct.window ?? null;
        },
        async write(state) {
            const acct = requireAccountScope(await vault.coSignerAccounts.get(accountId));
            await vault.coSignerAccounts.put({
                ...acct,
                window: state,
                updatedAt: new Date().toISOString(),
            });
        },
    };
}

/**
 * Build a VaultWindowStore for an account, or null when the account's policy
 * has no `maxPerWindow` cap (the SDK CoSigner needs a window store only then).
 * The window length comes from `policy.maxPerWindow.hours`.
 *
 * @param {object} args
 * @param {import('../storage/Vault.js').Vault} args.vault
 * @param {import('../schemas/coSignerAccount.js').CoSignerAccount} args.account
 * @param {() => number} [args.now]   injectable clock (ms) for tests
 * @returns {VaultWindowStore | null}
 */
export function buildAccountWindowStore({ vault, account, now }) {
    if (!account || !account.policy) {
        throw new Error('buildAccountWindowStore: account with a policy is required');
    }
    const win = account.policy.maxPerWindow;
    if (win === null || win === undefined) return null;
    if (!win || typeof win !== 'object' || !Number.isFinite(win.hours) || win.hours <= 0) {
        throw new Error('buildAccountWindowStore: maxPerWindow.hours must be a positive number');
    }
    for (const field of ['id', 'walletId', 'chainId']) {
        if (typeof account[field] !== 'string' || account[field].trim().length === 0) {
            throw new Error(`buildAccountWindowStore: account.${field} is required`);
        }
    }
    return new VaultWindowStore({
        persistence: createVaultWindowPersistence(vault, account.id, {
            walletId: account.walletId,
            chainId: account.chainId,
        }),
        hours: win.hours,
        now,
    });
}
