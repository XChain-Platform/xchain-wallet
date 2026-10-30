// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Refuse secret disclosure after the vault has closed, even if a stale host
 * still holds the vault object during lock teardown.
 *
 * @param {{ isOpen?: boolean } | null | undefined} vault
 * @param {string} operation
 */
export function assertWalletUnlockedForReveal(vault, operation) {
    if (vault?.isOpen !== false) return;
    const error = new Error(`${operation}: wallet is locked`);
    error.name = 'WalletLockedError';
    throw error;
}
