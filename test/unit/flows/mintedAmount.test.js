// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MINT_ADDRESS_MAX counts valid mints authored by one address. These tests
// keep foreign tokens, destinations, invalid rows and decimal rounding out of
// that cumulative amount, and verify that the read covers every result page.

import { describe, expect, it, vi } from 'vitest';
import {
    mintedAmountForAddress,
    sumMintedAmount,
} from '../../../packages/core/src/flows/mintedAmount.js';

const ADDRESS = 'bc1qsource';
const row = (amount, overrides = {}) => ({
    action: 'MINT',
    status: 'valid',
    source: ADDRESS,
    tick: 'CAP',
    amount,
    ...overrides,
});

describe('sumMintedAmount', () => {
    it('sums only valid mints authored by the exact source for the exact ticker', () => {
        expect(sumMintedAmount([
            row('0.1'),
            row('0.2', { destination: 'bc1qsomeoneelse' }),
            row('50', { status: 'invalid: cap reached' }),
            row('60', { source: 'bc1qother' }),
            row('70', { tick: 'OTHER' }),
            row('80', { action: 'SEND' }),
        ], { address: ADDRESS, tick: 'CAP' })).toEqual({ amount: '0.3', count: 2 });
    });

    it('rejects an unreadable amount on a row declared valid', () => {
        expect(() => sumMintedAmount([row('not-a-number')], {
            address: ADDRESS,
            tick: 'CAP',
        })).toThrow(/unreadable amount/);
    });
});

describe('mintedAmountForAddress', () => {
    it('reads every explorer page and sums exact divisible amounts', async () => {
        const getMints = vi.fn(async (_query, _type, opts) => ({
            total: 3,
            data: opts.page === 1
                ? [row('0.00000001'), row('1.2')]
                : [row('2.3')],
        }));
        const result = await mintedAmountForAddress({
            sdkRegistry: { get: () => ({ getMints }) },
            chainId: 'bitcoin-mainnet',
            address: ADDRESS,
            tick: 'CAP',
            limit: 2,
        });
        expect(result).toEqual({ amount: '3.50000001', count: 3 });
        expect(getMints).toHaveBeenNthCalledWith(1, ADDRESS, 'address', {
            page: 1, limit: 2, sortorder: 'asc',
        });
        expect(getMints).toHaveBeenNthCalledWith(2, ADDRESS, 'address', {
            page: 2, limit: 2, sortorder: 'asc',
        });
    });

    it('validates the read boundary', async () => {
        await expect(mintedAmountForAddress({})).rejects.toThrow(/sdkRegistry/);
        await expect(mintedAmountForAddress({
            sdkRegistry: { get: () => ({}) }, chainId: 'c', address: ADDRESS, tick: 'CAP',
        })).rejects.toThrow(/getMints/);
    });
});
