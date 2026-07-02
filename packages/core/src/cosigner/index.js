// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Wallet-side co-signer support (§22, P4 passive co-signer). The policy
// brain + partial-signing core live in the SDK (`sdk.coSigner`); the wallet
// only adds the Vault-backed spending-window store and the orchestration
// flow (`flows/passiveCoSign.js`).

export {
    VaultWindowStore,
    WindowStateCorruptError,
    WINDOW_STATE_VERSION,
    addDecimalStrings,
    createInMemoryWindowPersistence,
} from './vaultWindowStore.js';
export {
    createVaultWindowPersistence,
    buildAccountWindowStore,
} from './vaultWindowPersistence.js';
