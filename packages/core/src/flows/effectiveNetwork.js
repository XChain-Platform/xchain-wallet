// Active-network filter helpers — the single source of truth for which
// chains are "live" given the user's `settings.activeNetwork` choice.
//
// The wallet's `activeChainIds` records every chain the user has ever
// configured (across networks). The runtime "what to fetch / what to
// show" set is a derived subset filtered down to chains whose
// `networkKind` matches `settings.activeNetwork`. A user with mainnet
// + testnet chains configured who has `activeNetwork: 'mainnet'` sees
// only mainnet — and the wallet makes no network requests against
// the testnet chains.
//
// Switching networks = updating one setting. Underlying chain
// configuration stays untouched; switching back is instant and
// reveals the same address records / cached balances.
//
// Used by:
//   - `walletBalances` (filters its per-chain fan-out)
//   - Home / History / AddressList / Send / every action form's chain
//     picker (filters derived `activeChainIds = Object.entries(...)`)
//   - Every caller of `checkReachability` (filters the chainIds arg)

import { NETWORK_DEFAULT } from '../schemas/settings.js';

/**
 * Read the active-network preference from a settings record. Falls
 * back to the v2-tolerant default (`'mainnet'`) when the field is
 * absent — older records written before the field existed get the
 * safe default at read time, no migration write required.
 *
 * @param {object | null | undefined} settings
 * @returns {'mainnet' | 'testnet' | 'regtest'}
 */
export function getActiveNetwork(settings) {
    const v = settings?.activeNetwork;
    if (v === 'mainnet' || v === 'testnet' || v === 'regtest') return v;
    return NETWORK_DEFAULT;
}

/**
 * Does a chainId belong to the user's active network?
 *
 * @param {string} chainId
 * @param {object | null | undefined} settings
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {boolean}
 */
export function isChainOnActiveNetwork(chainId, settings, chainRegistry) {
    if (!chainId || !chainRegistry) return false;
    const descriptor = chainRegistry.descriptorFor(chainId);
    if (!descriptor) return false;
    return descriptor.networkKind === getActiveNetwork(settings);
}

/**
 * Filter an array of chainIds down to those on the active network.
 * Unknown chainIds (not in the registry) are excluded as a defensive
 * default — if we can't classify a chain's network, we don't fetch
 * against it.
 *
 * @param {string[]} chainIds
 * @param {object | null | undefined} settings
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @returns {string[]}
 */
export function filterChainIdsByActiveNetwork(chainIds, settings, chainRegistry) {
    if (!Array.isArray(chainIds) || chainIds.length === 0) return [];
    const network = getActiveNetwork(settings);
    /** @type {string[]} */
    const out = [];
    for (const id of chainIds) {
        const descriptor = chainRegistry?.descriptorFor(id);
        if (descriptor && descriptor.networkKind === network) out.push(id);
    }
    return out;
}
