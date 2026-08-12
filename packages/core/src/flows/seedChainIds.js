// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// seedChainIds: which chains a newly added wallet or account
// gets its first addresses on.
//
// Address derivation for a new wallet/account walks `activeChainIds`,
// and every shell defaults that to the three MAINNETS. A vault whose
// active network is regtest (Developer Mode) or testnet therefore ends
// up with a second wallet that holds mainnet-only addresses, and the
// active-network filter hides those everywhere: Home, Receive and
// Addresses all report "no addresses", while Add-address offers no coin
// at all because its list is built from the chains the account already
// occupies. The wallet is inert with no in-app way out, because the
// only seeding path (regtest activation) runs over the accounts that
// existed when it was invoked and cannot be re-run afterwards.
//
// The fix is to seed from what the VAULT says is active rather than
// from a hardcoded constant. "Active" here is the same definition
// `bridge.getActiveChains` and `useReachability` use: a chain that has
// per-chain settings (`settings.fees`). The whole configured set is
// seeded, not only the active network's slice, so switching the network
// back afterwards finds addresses already there.

import { getActiveNetwork, filterChainIdsByActiveNetwork } from './effectiveNetwork.js';

/**
 * Chain ids that are live for the user right now: the configured chains
 * (`settings.fees`) that sit on the active network. Falls back to every
 * registry chain on that network when settings name none of them, so a
 * caller is never handed an empty set for a network the wallet is
 * actually looking at.
 *
 * @param {object | null | undefined} settings
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {string[]}
 */
export function activeChainIdsFromSettings(settings, chainRegistry) {
    if (!chainRegistry) return [];
    const configured = Object.keys(settings?.fees ?? {})
        .filter((id) => chainRegistry.has(id));
    const onActive = filterChainIdsByActiveNetwork(configured, settings, chainRegistry);
    if (onActive.length > 0) return onActive;
    return (chainRegistry.byNetworkKind(getActiveNetwork(settings)) || []).map((d) => d.id);
}

/**
 * Chain ids a "pick a chain to put an address on" control should offer:
 * the chains the account already occupies, then every chain active on
 * the current network.
 *
 * Occupied-only lists turn every such control into a dead end for an
 * account with no addresses: Add-address offered no coin, and the
 * Import-WIF picker offered no chain, so a wallet whose seeding failed
 * could not take an address by either route. Occupied ids stay first so
 * a wallet that already has addresses sees exactly the old ordering.
 *
 * Settings are unreadable while the vault is locked; the occupied set
 * alone is then the honest answer, and callers render their own empty
 * state from it.
 *
 * @param {object} opts
 * @param {string[]} [opts.occupied]        chains the account already has addresses on
 * @param {object | null} [opts.settings]   the vault Settings record, or null while locked
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @returns {string[]}
 */
export function offerableChainIds({ occupied, settings, chainRegistry }) {
    const out = (occupied || []).filter(Boolean);
    if (!settings || !chainRegistry) return out;
    for (const cid of activeChainIdsFromSettings(settings, chainRegistry)) {
        if (!out.includes(cid)) out.push(cid);
    }
    return out;
}

/**
 * Resolve the `activeChainIds` a wallet-add / account-add should derive
 * addresses for.
 *
 * An explicit `requested` list always wins (the caller knows what it
 * wants; the flows validate the ids). Otherwise: the chains on the
 * active network first, then any other configured chain, so the new
 * wallet's first address belongs to the network the user is on.
 *
 * @param {object} opts
 * @param {string[]} [opts.requested]     caller-supplied ids; returned verbatim when non-empty
 * @param {object | null} [opts.settings] the vault Settings record
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @param {string[]} [opts.fallback]      used only when settings + registry yield nothing
 * @returns {string[]}
 */
export function resolveSeedChainIds({ requested, settings, chainRegistry, fallback = [] }) {
    if (Array.isArray(requested) && requested.length > 0) return requested;
    if (!chainRegistry) return fallback;

    const configured = Object.keys(settings?.fees ?? {})
        .filter((id) => chainRegistry.has(id));
    const onActive = activeChainIdsFromSettings(settings, chainRegistry);

    const out = [...onActive];
    for (const id of configured) {
        if (!out.includes(id)) out.push(id);
    }
    return out.length > 0 ? out : fallback;
}

/**
 * Vault-reading wrapper around `resolveSeedChainIds`. A settings read
 * that throws (locked or missing record) degrades to the fallback
 * rather than failing the wallet/account creation it is seeding.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @param {string[]} [opts.requested]
 * @param {string[]} [opts.fallback]
 * @returns {Promise<string[]>}
 */
export async function seedChainIdsForVault({ vault, chainRegistry, requested, fallback = [] }) {
    if (Array.isArray(requested) && requested.length > 0) return requested;
    let settings = null;
    try {
        settings = (await vault?.settings?.get?.()) ?? null;
    } catch {
        settings = null;
    }
    return resolveSeedChainIds({ settings, chainRegistry, fallback });
}
