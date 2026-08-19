// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// seedSettings: populate per-chain entries in Settings.fees and
// Settings.ads.perChain. Idempotent: existing entries are never
// overwritten, so a user's customized fee strategy or ADS amount
// survives a second invocation (e.g., activating an additional chain
// later, or a fresh wallet created in an already-configured vault).
//
// Seeding creates the ENTRY (its key marks the chain as configured,
// see seedChainIds) but copies NO default values into it (§35.10 /
// §36.6): every preference field starts null = "follow the current
// release's default", resolved at read time against the chain
// descriptor via resolveFeeConfig / resolveAdsChainConfig. Only an
// explicit user override ever writes a concrete value, so a later
// release can retune descriptor defaults and reach every wallet that
// never overrode them. ADS lifetime counters are real state and start
// at zero.

import {
    createDefaultAdsChainState,
    createDefaultSettings,
} from '../schemas/settings.js';

/**
 * Return a new Settings object with fees + ads.perChain entries seeded
 * for every chainId in `activeChainIds` that doesn't already have one.
 *
 * @param {import('../schemas/settings.js').Settings} settings
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @param {string[]} activeChainIds
 * @returns {import('../schemas/settings.js').Settings}
 */
export function seedSettingsForChains(settings, chainRegistry, activeChainIds) {
    if (!settings) throw new Error('seedSettingsForChains: settings is required');
    if (!chainRegistry) throw new Error('seedSettingsForChains: chainRegistry is required');
    if (!Array.isArray(activeChainIds)) {
        throw new Error('seedSettingsForChains: activeChainIds must be an array');
    }

    const fees = { ...settings.fees };
    const adsPerChain = { ...settings.ads.perChain };

    for (const chainId of activeChainIds) {
        const descriptor = chainRegistry.get(chainId);
        if (!descriptor) {
            throw new Error(`seedSettingsForChains: unknown chain "${chainId}"`);
        }
        if (!fees[chainId]) {
            fees[chainId] = {
                strategy: null,
                customSatsPerKb: null,
                rbfByDefault: null,
            };
        }
        if (!adsPerChain[chainId]) {
            adsPerChain[chainId] = createDefaultAdsChainState();
        }
    }

    return {
        ...settings,
        fees,
        ads: { ...settings.ads, perChain: adsPerChain },
    };
}

/**
 * Vault-aware variant: read current settings (or default if absent),
 * seed for the active chains, write back. Returns the seeded record.
 *
 * `activeNetwork` only takes effect when settings are being CREATED on
 * this call (no existing record in the vault). For an already-configured
 * wallet, an existing `activeNetwork` is preserved. Activating an
 * additional chain via Settings must not silently switch the user's
 * network mode. Pass `activeNetwork` from wallet-creation entry points
 * so a demo wallet (regtest chains) lands with `activeNetwork:'regtest'`
 * and a mainnet wallet lands with `'mainnet'` (the default).
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {import('../registry/index.js').ChainRegistry} chainRegistry
 * @param {string[]} activeChainIds
 * @param {{ activeNetwork?: 'mainnet' | 'testnet' | 'regtest' }} [opts]
 * @returns {Promise<import('../schemas/settings.js').Settings>}
 */
export async function ensureSettings(vault, chainRegistry, activeChainIds, opts = {}) {
    if (!vault) throw new Error('ensureSettings: vault is required');
    const existing = await vault.settings.get();
    let current = existing ?? createDefaultSettings();
    if (!existing && opts.activeNetwork) {
        current = { ...current, activeNetwork: opts.activeNetwork };
    }
    const seeded = seedSettingsForChains(current, chainRegistry, activeChainIds);
    await vault.settings.put(seeded);
    return seeded;
}
