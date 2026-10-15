// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

/**
 * True for a chain id whose coins carry market value. Home uses it to keep
 * fixture fiat off a real test-network wallet.
 *
 * @param {unknown} chainId
 */
export function isMainnetChainId(chainId) {
    return typeof chainId === 'string' && chainId.endsWith('-mainnet');
}
