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

// Derivation role of an HD address (§16). 'receive' and 'change' mirror
// the BIP44 external/internal branches (change 0/1). 'dispenser' is a
// metadata tag on a normal external (change=0) address that hosts a
// dispenser, NOT a separate branch. Watch-only / imported keys have no
// branch and default to 'receive'.
export const ADDRESS_ROLES = /** @type {const} */ ([
    'receive',
    'change',
    'dispenser',
]);
