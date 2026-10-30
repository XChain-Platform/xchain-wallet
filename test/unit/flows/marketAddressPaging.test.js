// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// My orders and My swaps list every offer an address placed and every cancel
// it sent. The explorer answers one page of at most 100 rows, so a read of
// page 1 alone hides an address's older open offers (which the wallet cannot
// then cancel) and its older cancels (so a cancelled offer reads as open and
// offers Cancel again).

import { describe, expect, it, vi } from 'vitest';
import {
    orderCancelsForAddress,
    ordersForAddress,
    swapCancelsForAddress,
    swapsForAddress,
} from '../../../packages/core/src/flows/marketQueries.js';

const PAGE = 100;

function pagedReader(total, rowFor) {
    return vi.fn(async (_query, _type, opts = {}) => {
        const page = opts?.page ?? 1;
        const start = (page - 1) * PAGE;
        const data = [];
        for (let i = start; i < Math.min(start + PAGE, total); i += 1) data.push(rowFor(i));
        return { data, total };
    });
}

const registryFor = (sdk) => ({ get: () => sdk });

describe('address-scoped market feeds read every page', () => {
    it.each([
        ['ordersForAddress', ordersForAddress, 'getOrders'],
        ['orderCancelsForAddress', orderCancelsForAddress, 'getOrderCancels'],
        ['swapsForAddress', swapsForAddress, 'getSwaps'],
        ['swapCancelsForAddress', swapCancelsForAddress, 'getSwapCancels'],
    ])('%s returns all 250 rows across three pages', async (_name, query, method) => {
        const read = pagedReader(250, (i) => ({ action_index: 1000 - i, source: 'owner', status: 'valid' }));
        const sdk = { [method]: read };

        const response = await query({ sdkRegistry: registryFor(sdk), chainId: 'chain', address: 'owner' });

        expect(response.data).toHaveLength(250);
        expect(response.data.at(-1).action_index).toBe(1000 - 249);
        expect(read).toHaveBeenCalledTimes(3);
        expect(read).toHaveBeenCalledWith('owner', 'address', expect.objectContaining({ page: 3 }));
    });

    it('keeps a caller-chosen page as that one page', async () => {
        const read = pagedReader(250, (i) => ({ action_index: i }));
        const response = await swapsForAddress({
            sdkRegistry: registryFor({ getSwaps: read }),
            chainId: 'chain',
            address: 'owner',
            opts: { page: 2 },
        });
        expect(response.data).toHaveLength(100);
        expect(read).toHaveBeenCalledTimes(1);
    });
});
