// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const DIRECTORY_COINS = new Set(['bitcoin', 'litecoin', 'dogecoin']);

function responseRows(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    return [];
}

function sameSharedList(left, right) {
    return String(left?.home_chain) === String(right?.home_chain)
        && String(left?.home_list_index) === String(right?.home_list_index);
}

/**
 * Read the shared-list directory for the viewing chain's network.
 *
 * @param {Object} params
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} params.sdkRegistry
 * @param {import('../registry/index.js').ChainRegistry} params.chainRegistry
 * @param {string} params.chainId
 * @returns {Promise<{ lists: object[], unavailable: string[] }>}
 */
export async function sharedListDirectory({ sdkRegistry, chainRegistry, chainId }) {
    if (!sdkRegistry) throw new Error('sharedListDirectory: sdkRegistry is required');
    if (!chainRegistry) throw new Error('sharedListDirectory: chainRegistry is required');
    if (!chainId) throw new Error('sharedListDirectory: chainId is required');

    const viewing = chainRegistry.get?.(chainId) ?? chainRegistry.descriptorFor?.(chainId);
    if (!viewing) throw new Error(`sharedListDirectory: unknown chain "${chainId}"`);

    const descriptors = (chainRegistry.byNetworkKind?.(viewing.networkKind) ?? [])
        .filter((descriptor) => DIRECTORY_COINS.has(descriptor.coin));
    const reads = await Promise.all(descriptors.map(async (descriptor) => {
        try {
            const sdk = sdkRegistry.get(descriptor.id);
            if (!sdk?.explorer || typeof sdk.explorer.get !== 'function') {
                throw new Error('explorer direct read is unavailable');
            }
            const response = await sdk.explorer.get('/shared_lists', { noRetry: true });
            return { descriptor, rows: responseRows(response), failed: false };
        } catch {
            return { descriptor, rows: [], failed: true };
        }
    }));

    const viewingRows = reads.find((read) => read.descriptor.id === chainId)?.rows ?? [];
    const lists = [];
    for (const read of reads) {
        const owners = read.descriptor.platformListOwners ?? [];
        for (const row of read.rows) {
            if (row?.kind !== 'home') continue;
            const mirror = read.descriptor.id === chainId
                ? null
                : viewingRows.find((candidate) => candidate?.kind === 'mirror'
                    && sameSharedList(candidate, row));
            lists.push({
                ...row,
                bindTarget: read.descriptor.id === chainId
                    ? row.home_list_index
                    : (mirror?.local_list_index ?? null),
                maintainedByPlatform: typeof row.owner === 'string' && owners.includes(row.owner),
            });
        }
    }

    return {
        lists,
        unavailable: reads.filter((read) => read.failed).map((read) => read.descriptor.id),
    };
}
