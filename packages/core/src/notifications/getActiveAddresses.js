// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// getActiveAddresses: enumerate the wallet's addresses for the §46
// notification watcher. Each entry pairs an on-chain address with the
// chainId + human label the NotificationService needs to subscribe and
// to render notification text. Deduped by (chainId, address) and,
// optionally, filtered to the user's active network (Settings → Network).

/**
 * @typedef {Object} ActiveAddress
 * @property {string} address   on-chain address string
 * @property {string} chainId   e.g. 'bitcoin-mainnet'
 * @property {string} label     human chain name for notification text, e.g. 'Bitcoin'
 * @property {string} network   'mainnet' | 'testnet' | 'regtest'
 */

/**
 * Build the active-address list the NotificationService subscribes to.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @param {{ activeNetwork?: string }} [opts]  when activeNetwork is set, only
 *   addresses on that network are returned (mirrors the Settings filter)
 * @returns {Promise<ActiveAddress[]>}
 */
export async function getActiveAddresses(vault, chainRegistry, opts = {}) {
    if (!vault) throw new Error('getActiveAddresses: vault is required');
    if (!chainRegistry) throw new Error('getActiveAddresses: chainRegistry is required');
    const { activeNetwork } = opts;

    const records = await vault.addresses.list();
    const seen = new Set();
    /** @type {ActiveAddress[]} */
    const out = [];
    for (const a of records) {
        if (!a || !a.address) continue;
        if (activeNetwork && a.network !== activeNetwork) continue;
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        const key = `${chainId}|${a.address}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const descriptor = chainRegistry.descriptorFor(chainId);
        out.push({
            address: a.address,
            chainId,
            label: (descriptor && descriptor.displayName) || a.chain,
            network: a.network,
        });
    }
    return out;
}
