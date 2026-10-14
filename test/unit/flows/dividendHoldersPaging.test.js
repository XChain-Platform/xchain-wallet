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
});
