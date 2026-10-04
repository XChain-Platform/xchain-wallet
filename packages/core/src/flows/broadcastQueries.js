// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// broadcastQueries: thin read-only wrapper over `sdk.getBroadcasts`.
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

function pageRows(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (Array.isArray(resp.data)) return resp.data;
    if (Array.isArray(resp.rows)) return resp.rows;
    return [];
}

function isValidFeedCreate(row) {
    const format = row?.action_format ?? row?.ACTION_FORMAT;
    return (format === 2 || format === '2') && (row.status ?? row.STATUS) === 'valid';
}

/**
 * Find the most recent valid v2 feed-create for an address, paging through
 * the explorer results until a page holds one or runs dry.
 *
 * @param {{ messaging: object, chainId: string, address: string, maxPages?: number }} params
 * @returns {Promise<object | null>}
 */
export async function latestFeedCreateForAddress({ messaging, chainId, address, maxPages = 5 }) {
    if (!messaging) throw new Error('latestFeedCreateForAddress: messaging is required');
    if (!chainId) throw new Error('latestFeedCreateForAddress: chainId is required');
    if (!address) throw new Error('latestFeedCreateForAddress: address is required');
    for (let page = 1; page <= maxPages; page += 1) {
        const rows = pageRows(await messaging.getBroadcastsForAddress({ chainId, address, opts: { page } }));
        if (rows.length === 0) return null;
        const feeds = rows.filter(isValidFeedCreate);
        if (feeds.length > 0) {
            feeds.sort((a, b) => Number(b.block_index || 0) - Number(a.block_index || 0));
            return feeds[0];
        }
    }
    return null;
}
