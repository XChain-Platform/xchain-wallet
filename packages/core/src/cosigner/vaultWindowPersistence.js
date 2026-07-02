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
 * @returns {import('./vaultWindowStore.js').WindowPersistence}
 */
export function createVaultWindowPersistence(vault, accountId) {
    if (!vault || !vault.coSignerAccounts) {
        throw new Error('createVaultWindowPersistence: vault with coSignerAccounts is required');
    }
    if (typeof accountId !== 'string' || accountId.length === 0) {
        throw new Error('createVaultWindowPersistence: accountId is required');
    }
    return {
        async read() {
            const acct = await vault.coSignerAccounts.get(accountId);
            if (!acct) throw new Error(`coSignerAccount "${accountId}" not found`);
            return acct.window ?? null;
        },
        async write(state) {
            const acct = await vault.coSignerAccounts.get(accountId);
            if (!acct) throw new Error(`coSignerAccount "${accountId}" not found`);
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
    if (!win || !(typeof win.hours === 'number' && win.hours > 0)) {
        return null;
    }
    return new VaultWindowStore({
        persistence: createVaultWindowPersistence(vault, account.id),
        hours: win.hours,
        now,
    });
}
