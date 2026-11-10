// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import {
    clearActiveAccount,
    readActiveAccount,
    writeActiveAccount,
} from './activeAccountMemory.js';

/**
 * Resolve the saved account against the wallet's live accounts and persist
 * the fallback. This keeps storage aligned with the account that callers
 * activate when the saved account no longer exists.
 *
 * @param {string | null | undefined} walletId
 * @param {Array<{ id?: string, index?: number }> | null | undefined} accounts
 * @returns {string | null}
 */
export function reconcileActiveAccount(walletId, accounts) {
    const sorted = Array.isArray(accounts)
        ? accounts
            .filter((account) => typeof account?.id === 'string' && account.id)
            .slice()
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        : [];
    const saved = readActiveAccount(walletId);
    const chosen = saved && sorted.some((account) => account.id === saved)
        ? saved
        : (sorted[0]?.id || null);

    if (chosen) writeActiveAccount(walletId, chosen);
    else clearActiveAccount(walletId);
    return chosen;
}
