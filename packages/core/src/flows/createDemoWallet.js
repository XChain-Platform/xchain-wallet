// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// createDemoWallet — §25.2 try-before-commit onboarding. Ephemeral
// wallet whose storage never touches disk (InMemoryBackend), whose
// password is auto-generated (user never sees it; session ends when
// the caller drops its references), and whose KDF cost is deliberately
// minimal (no attacker access to the in-memory ciphertext).
//
// Returns `{ vault, password, ... }` so the caller can drive subsequent
// flows (receiveAddress, sendToken, etc.) against this demo wallet by
// passing the same `vault` + `walletId` + `password` back through the
// standard flow API — same surface, same code path, just backed by an
// in-memory backend instead of IndexedDB / chrome.storage / file.
//
// Per §25.2 the shell layer is responsible for:
//   - Presenting the demo banner
//   - Fabricating balances / history via a mock SDK factory
//   - Clearing demo state when the user picks "Create a real wallet"

import { makeFreshKdfParams } from '../crypto/kdf.js';
import { Vault } from '../storage/Vault.js';
import { InMemoryBackend } from '../storage/backend.js';
import { createWallet } from './createWallet.js';

// Intentionally weak KDF for demo mode — the in-memory ciphertext never
// reaches an attacker, so paying ~1s of Argon2id buys nothing and
// makes the demo feel sluggish.
const DEMO_KDF_OVERRIDES = { iterations: 1, memory: 8192, parallelism: 1 };

/**
 * @typedef {Object} CreateDemoWalletOpts
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} [activeChainIds]        default ['bitcoin-regtest', 'dogecoin-regtest', 'litecoin-regtest']
 * @property {string} [name]                    default 'Demo Wallet'
 */

/**
 * @typedef {Object} CreateDemoWalletResult
 * @property {import('../storage/Vault.js').Vault} vault      in-memory vault; drop to exit demo mode
 * @property {string} password                                auto-generated; caller holds for the session
 * @property {string} mnemonic                                per-spec the shell does NOT show this
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/account.js').Account} account
 * @property {Array<{ chainId: string, address: import('../schemas/address.js').Address }>} addresses
 */

/**
 * @param {CreateDemoWalletOpts} opts
 * @returns {Promise<CreateDemoWalletResult>}
 */
export async function createDemoWallet({
    chainRegistry,
    sdkRegistry,
    activeChainIds = ['bitcoin-regtest', 'dogecoin-regtest', 'litecoin-regtest'],
    name = 'Demo Wallet',
}) {
    if (!chainRegistry) throw new Error('createDemoWallet: chainRegistry is required');
    if (!sdkRegistry) throw new Error('createDemoWallet: sdkRegistry is required');

    // Auto-password: 256 bits of entropy, hex-encoded. Caller keeps it
    // in memory for the session; it never touches disk.
    const passwordBytes = new Uint8Array(32);
    crypto.getRandomValues(passwordBytes);
    const password = Array.from(passwordBytes, (b) =>
        b.toString(16).padStart(2, '0'),
    ).join('');
    passwordBytes.fill(0);

    // Per-session random master key for the vault (independent of the
    // wallet's seed encryption key derived from `password`).
    const masterKey = new Uint8Array(32);
    crypto.getRandomValues(masterKey);

    const vault = new Vault({
        backend: new InMemoryBackend(),
        masterKey,
    });
    masterKey.fill(0);  // Vault copies the key internally; zero our ref.
    await vault.open();

    const created = await createWallet({
        password,
        name,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds,
        kdfParams: makeFreshKdfParams(DEMO_KDF_OVERRIDES),
    });

    return {
        vault,
        password,
        mnemonic: created.mnemonic,
        wallet: created.wallet,
        account: created.account,
        addresses: created.addresses,
    };
}
