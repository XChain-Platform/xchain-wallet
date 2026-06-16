// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueries — thin read-only wrapper over `sdk.getBroadcasts`.
// Backs the §42.7.5 Operator dashboard's "Publishing activity" section
// (Tier 2/3 oracle publishers issue PRICE-style BROADCASTs and the
// dashboard surfaces them as the operator's recent feed updates).

/**
 * @typedef {Object} BroadcastQueryOpts
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} chainId
 * @property {string} address
 * @property {object} [opts]      pagination forwarded to the SDK
 */

/**
 * List BROADCAST actions published by an address. Explorer route
 * `/{COIN}/api/broadcasts/{ADDRESS}/address`.
 *
 * @param {BroadcastQueryOpts} params
 */
export async function broadcastsForAddress({ sdkRegistry, chainId, address, opts }) {
    if (!sdkRegistry) throw new Error('broadcastsForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('broadcastsForAddress: chainId is required');
    if (!address) throw new Error('broadcastsForAddress: address is required');
    const sdk = sdkRegistry.get(chainId);
    return sdk.getBroadcasts(address, 'address', opts);
}
