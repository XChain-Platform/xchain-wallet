// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { NETWORKS, NETWORK_DEFAULT } from '../../schemas/settings.js';

export const ACTIVE_NETWORK_OPTIONS = /** @type {const} */ ([
    { value: 'mainnet', label: 'Mainnet' },
    { value: 'testnet', label: 'Testnet' },
    { value: 'regtest', label: 'Regtest' },
]);

/**
 * Return a valid active network, preserving the schema's Mainnet default.
 *
 * @param {unknown} value
 * @returns {'mainnet'|'testnet'|'regtest'}
 */
export function normalizeActiveNetwork(value) {
    return NETWORKS.includes(value) ? value : NETWORK_DEFAULT;
}

/**
 * Return the user-facing label for an active network value.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function activeNetworkLabel(value) {
    const network = normalizeActiveNetwork(value);
    return ACTIVE_NETWORK_OPTIONS.find((option) => option.value === network)?.label || 'Mainnet';
}

/**
 * Keep Regtest developer-only while always offering an exit from it.
 *
 * @param {{ developerMode?: boolean, current?: unknown }} opts
 */
export function activeNetworkOptions({ developerMode = false, current } = {}) {
    const showRegtest = developerMode || normalizeActiveNetwork(current) === 'regtest';
    return showRegtest
        ? ACTIVE_NETWORK_OPTIONS
        : ACTIVE_NETWORK_OPTIONS.filter((option) => option.value !== 'regtest');
}

/**
 * Confirm the reload and the visible data boundary before switching networks.
 *
 * @param {unknown} current
 * @param {unknown} next
 * @param {(message: string) => boolean} [confirm]
 */
export function confirmActiveNetworkSwitch(current, next, confirm = globalThis.confirm) {
    if (!NETWORKS.includes(next)) return false;
    const from = activeNetworkLabel(current);
    const to = activeNetworkLabel(next);
    if (from === to) return false;
    if (typeof confirm !== 'function') return false;
    return confirm(
        `Switch from ${from} to ${to}? The wallet will reload and refresh balances and history for ${to}. ${from} data stays saved and hidden until you switch back.`,
    );
}

/**
 * Persist through the host route that also prepares the destination network.
 *
 * @param {object} opts
 * @param {object} [opts.messaging]
 * @param {(patch: Record<string, unknown>) => Promise<any>} [opts.update]
 * @param {string} [opts.walletId]
 * @param {unknown} opts.network
 */
export async function persistActiveNetwork({ messaging, update, walletId, network }) {
    if (!NETWORKS.includes(network)) throw new Error('A valid active network is required.');
    if (typeof messaging?.setActiveNetwork === 'function' && walletId) {
        return messaging.setActiveNetwork({ walletId, network });
    }
    if (typeof update === 'function') {
        return { settings: await update({ activeNetwork: network }) };
    }
    throw new Error('Active network switching is not available in this shell.');
}
