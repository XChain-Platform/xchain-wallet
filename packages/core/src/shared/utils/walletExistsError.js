// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The vault refuses a new wallet over an existing one with a named error
// (assertFreshVault); a shell that passes errors across a message boundary
// keeps only the message, so that is read too.
export function isWalletExistsError(err) {
    return err?.name === 'WalletExistsError' || /^A wallet already exists\b/.test(String(err?.message || ''));
}
