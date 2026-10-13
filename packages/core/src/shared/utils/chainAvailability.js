// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getActiveNetwork } from '../../flows/effectiveNetwork.js';

/**
 * Report whether the active network has at least one configured descriptor.
 * A missing `fees` field is treated as an older or partial settings record,
 * while an explicit empty record means no chain is configured.
 *
 * @param {{ settings?: object | null, loading?: boolean }} settingsState
 * @param {import('../../registry/index.js').ChainRegistry} chainRegistry
 */
export function hasAvailableChain(settingsState, chainRegistry) {
    let descriptors;
    try {
        descriptors = chainRegistry?.supportedChains?.() || [];
    } catch {
        return false;
    }
    if (descriptors.length === 0) return false;

    const settings = settingsState?.settings;
    if (settingsState?.loading || !settings) return true;
    if (!Object.prototype.hasOwnProperty.call(settings, 'fees')) return true;

    const activeNetwork = getActiveNetwork(settings);
    return Object.keys(settings.fees || {}).some((chainId) => {
        const descriptor = chainRegistry?.get?.(chainId)
            || chainRegistry?.descriptorFor?.(chainId);
        return descriptor?.networkKind === activeNetwork;
    });
}

export const NO_CHAINS_TITLE = 'No networks available';
export const NO_CHAINS_BODY = 'Enable a network in Network settings to see balances, addresses, and activity here; if the chain registry could not be loaded, refresh it first.';
