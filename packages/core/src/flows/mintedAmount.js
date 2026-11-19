// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Read the cumulative amount of one token minted by one source address.
// MINT_ADDRESS_MAX counts authored valid mints, not tokens received or the
// destination credited by those mints, so the explorer query is address-first
// and the token is filtered inside the returned mint rows.

import { addDecimal, compareDecimal } from '../shared/utils/mintHeadroom.js';

function rowsOf(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.data)) return response.data;
    throw new Error('mintedAmountForAddress: the mint reply is not a row list');
}

/**
 * Sum valid MINT rows for an exact source and ticker without float rounding.
 *
 * @param {object[]} rows
 * @param {{ address: string, tick: string }} filter
 * @returns {{ amount: string, count: number }}
 */
export function sumMintedAmount(rows, { address, tick }) {
    let amount = '0';
    let count = 0;
    for (const row of rows) {
        if (!row || String(row.status || '').toLowerCase() !== 'valid') continue;
        if (row.action != null && String(row.action).toUpperCase() !== 'MINT') continue;
        if (String(row.source || '') !== String(address)) continue;
        if (String(row.tick || '') !== String(tick)) continue;
        if (compareDecimal(row.amount, '0') === -1 || compareDecimal(row.amount, '0') === null) {
            throw new Error('mintedAmountForAddress: a valid mint has an unreadable amount');
        }
        const next = addDecimal(amount, row.amount);
        if (next === null) throw new Error('mintedAmountForAddress: a valid mint has an unreadable amount');
        amount = next;
        count += 1;
    }
    return { amount, count };
}

/**
 * Read and sum every valid mint authored by an address for one token.
 *
 * @param {{ sdkRegistry: { get(chainId: string): any }, chainId: string,
 *   address: string, tick: string, limit?: number }} params
 * @returns {Promise<{ amount: string, count: number }>}
 */
export async function mintedAmountForAddress({
    sdkRegistry, chainId, address, tick, limit = 1000,
} = {}) {
    if (!sdkRegistry) throw new Error('mintedAmountForAddress: sdkRegistry is required');
    if (!chainId) throw new Error('mintedAmountForAddress: chainId is required');
    if (!address) throw new Error('mintedAmountForAddress: address is required');
    if (!tick) throw new Error('mintedAmountForAddress: tick is required');
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk?.getMints !== 'function') {
        throw new Error('mintedAmountForAddress: getMints is unavailable');
    }

    const pageSize = Math.max(1, Math.min(1000, Math.trunc(Number(limit)) || 1000));
    let page = 1;
    let fetched = 0;
    let amount = '0';
    let count = 0;
    while (true) {
        const response = await sdk.getMints(address, 'address', {
            page,
            limit: pageSize,
            sortorder: 'asc',
        });
        const rows = rowsOf(response);
        const summed = sumMintedAmount(rows, { address, tick });
        const next = addDecimal(amount, summed.amount);
        if (next === null) throw new Error('mintedAmountForAddress: mint total is unreadable');
        amount = next;
        count += summed.count;
        fetched += rows.length;

        const total = Number(response?.total);
        const hasTotal = !Array.isArray(response) && response?.total != null && Number.isFinite(total);
        if (Array.isArray(response) || rows.length === 0 || rows.length < pageSize
            || (hasTotal && fetched >= total)) break;
        page += 1;
    }
    return { amount, count };
}
