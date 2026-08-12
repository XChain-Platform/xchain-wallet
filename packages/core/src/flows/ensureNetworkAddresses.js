// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ensureNetworkAddresses.
//
// Addresses used to be derived exactly once, at wallet creation, one per
// `activeChainIds` - which the shells hardcode to the three MAINNETS. The
// `activeNetwork` setting only FILTERS the visible set, so switching
// Settings > Network to Testnet or Regtest left the wallet with zero visible
// addresses: Receive said "No addresses yet on any chain", the app reported
// itself offline, and nothing in the UI could create one. A two-click dead end
// out of a shipped settings control, with no way back but switching the
// network again. Regtest is developer-only, but Testnet is offered to
// everyone.
//
// This closes it by deriving the first address for each chain on the network
// being switched TO, mirroring exactly what wallet creation does for its
// active chains (one address, `descriptor.defaultAddressType`, account 0).
//
// Deliberately best-effort per chain: a network has several chains, and one
// failing to derive must not deny the user the others. The caller gets a
// per-chain report rather than a thrown error, because the switch itself has
// already been persisted by then and failing loudly would strand the user in
// the very state this flow exists to prevent.

import { receiveAddress } from './receiveAddress.js';

/**
 * @typedef {Object} EnsureNetworkAddressesOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} walletId
 * @property {'mainnet'|'testnet'|'regtest'} network
 * @property {import('../signers/Signer.js').Signer} [signer]   pre-unlocked signer. REQUIRED in practice: without one this flow derives nothing rather than prompting for a password mid-switch.
 * @property {string} [accountId]     defaults to the wallet's lowest-index account
 */

/**
 * Derive the first address on every chain of `network` this wallet has none
 * on. Never throws for a per-chain failure.
 *
 * @param {EnsureNetworkAddressesOpts} opts
 * @returns {Promise<{ created: string[], existing: string[], failed: Array<{ chainId: string, reason: string }>, skipped: string|null }>}
 */
export async function ensureNetworkAddresses({
    vault,
    chainRegistry,
    sdkRegistry,
    walletId,
    network,
    signer,
    accountId,
}) {
    if (!vault) throw new Error('ensureNetworkAddresses: vault is required');
    if (!chainRegistry) throw new Error('ensureNetworkAddresses: chainRegistry is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('ensureNetworkAddresses: walletId is required');
    }
    if (typeof network !== 'string' || network.length === 0) {
        throw new Error('ensureNetworkAddresses: network is required');
    }

    const result = { created: [], existing: [], failed: [], skipped: null };

    // No usable signer means no derivation. That covers a locked vault and a
    // hardware-backed account, where deriving would wake the device several
    // times in a row for a settings toggle the user did not connect to
    // signing. Report it rather than half-doing it.
    if (!signer) {
        result.skipped = 'no-signer';
        return result;
    }

    const descriptors = chainRegistry.byNetworkKind(network) || [];
    if (descriptors.length === 0) {
        result.skipped = 'no-chains';
        return result;
    }

    const accounts = await vault.accounts.findBy('walletId', walletId);
    if (!accounts || accounts.length === 0) {
        result.skipped = 'no-accounts';
        return result;
    }
    const target = accountId
        ? accounts.find((a) => a.id === accountId)
        : [...accounts].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
    if (!target) {
        result.skipped = 'no-accounts';
        return result;
    }

    // Which chains already hold an address for this wallet's accounts? Read
    // once: one list scan beats a query per chain.
    const accountIds = new Set(accounts.map((a) => a.id));
    const all = await vault.addresses.list();
    const covered = new Set();
    for (const a of all) {
        if (!a.accountId || !accountIds.has(a.accountId)) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (chainId) covered.add(chainId);
    }

    for (const descriptor of descriptors) {
        const chainId = descriptor.id;
        if (covered.has(chainId)) {
            result.existing.push(chainId);
            continue;
        }
        try {
            // eslint-disable-next-line no-await-in-loop
            await receiveAddress({
                vault,
                walletId,
                chainRegistry,
                sdkRegistry,
                chainId,
                accountId: target.id,
                signer,
            });
            result.created.push(chainId);
        } catch (err) {
            result.failed.push({ chainId, reason: err?.message || String(err) });
        }
    }

    return result;
}
