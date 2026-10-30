// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { holdersFor } from '../../../packages/core/src/flows/dividendAction.js';

describe('holdersFor complete dividend preview', () => {
    it('assembles every explorer page when the form requests all holders', async () => {
        const pageOne = Array.from({ length: 500 }, (_unused, index) => ({
            address: `holder-${index}`,
            amount: '1',
        }));
        const getHolders = vi.fn(async (_tick, opts) => (
            opts.page === 1
                ? { total: 501, data: pageOne }
                : { total: 501, data: [{ address: 'holder-500', amount: '1' }] }
        ));

        const result = await holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'bitcoin-mainnet',
            tick: 'SHARES',
            all: true,
        });

        expect(result.data).toHaveLength(501);
        expect(getHolders).toHaveBeenNthCalledWith(1, 'SHARES', { page: 1, limit: 500 });
        expect(getHolders).toHaveBeenNthCalledWith(2, 'SHARES', { page: 2, limit: 500 });
    });

    const rowsFrom = (start, count) => Array.from({ length: count }, (_unused, index) => ({
        address: `holder-${start + index}`,
        amount: '1',
    }));

    // total 1001 over a 500-row limit is three pages: 500, 500 and 1.
    function threePageHolders(pageTwo, pageThree) {
        return vi.fn(async (_tick, opts) => {
            if (opts.page === 1) return { total: 1001, data: rowsFrom(0, 500) };
            if (opts.page === 2) return pageTwo;
            return pageThree;
        });
    }

    async function readAll(getHolders) {
        return holdersFor({
            sdkRegistry: { get: () => ({ getHolders }) },
            chainId: 'bitcoin-mainnet',
            tick: 'SHARES',
            all: true,
        });
    }

    it('assembles exactly total rows when every later page is complete', async () => {
        const getHolders = threePageHolders(
            { total: 1001, data: rowsFrom(500, 500) },
            { total: 1001, data: rowsFrom(1000, 1) },
        );

        const result = await readAll(getHolders);

        expect(result.total).toBe(1001);
        expect(result.data).toHaveLength(1001);
        expect(result.data[1000].address).toBe('holder-1000');
        expect(getHolders).toHaveBeenCalledTimes(3);
    });

    it('refuses a partial holder list when a later page comes back empty', async () => {
        const getHolders = threePageHolders(
            { total: 1001, data: [] },
            { total: 1001, data: rowsFrom(1000, 1) },
        );

        let result;
        let error;
        try {
            result = await readAll(getHolders);
        } catch (caught) {
            error = caught;
        }

        expect(result).toBeUndefined();
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/partial holders/i);
        expect(error.message).toMatch(/page 2/);
    });

    it('refuses a short non-last page', async () => {
        const getHolders = threePageHolders(
            { total: 1001, data: rowsFrom(500, 499) },
            { total: 1001, data: rowsFrom(1000, 1) },
        );

        await expect(readAll(getHolders)).rejects.toThrow(/partial holders.*page 2/i);
    });

    it('refuses a last page that holds fewer rows than total implies', async () => {
        const getHolders = threePageHolders(
            { total: 1001, data: rowsFrom(500, 500) },
            { total: 1001, data: [] },
        );

        await expect(readAll(getHolders)).rejects.toThrow(/partial holders.*page 3/i);
    });

    it('refuses a later page that is not an array and carries no data array', async () => {
        const nonArrayPage = threePageHolders(
            null,
            { total: 1001, data: rowsFrom(1000, 1) },
        );
        await expect(readAll(nonArrayPage)).rejects.toThrow(/partial holders.*page 2/i);

        const objectWithoutData = threePageHolders(
            { total: 1001, data: rowsFrom(500, 500) },
            { total: 1001, rows: rowsFrom(1000, 1) },
        );
        await expect(readAll(objectWithoutData)).rejects.toThrow(/partial holders.*page 3/i);
    });
});
