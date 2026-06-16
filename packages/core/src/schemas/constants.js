// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shared enums used across multiple schemas. Schema-specific enums
// (Wallet.origin, PendingTx.status, etc.) live next to their owning schema.

export const NETWORKS = /** @type {const} */ (['mainnet', 'testnet', 'regtest']);

export const ACTION_PERMISSIONS = /** @type {const} */ (['always', 'ask', 'never']);

export const ADDRESS_SOURCES = /** @type {const} */ ([
    'hd',
    'imported-wif',
    'watch-only',
    'trezor',
    'ledger',
]);
