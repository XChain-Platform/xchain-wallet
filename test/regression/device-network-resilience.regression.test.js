// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: device network resilience.
//
//   [P0] 2026-10-13: Concurrent price reads each retry an HTTP 429,
//        amplifying one provider refusal into a request storm.
//
//   [P1] 2026-10-13: A failed price refresh discards the last known
//        prices and leaves native-coin values blank.

import { describe, expect, it, vi } from 'vitest';
import { createPriceOracle } from '../../packages/core/src/flows/priceOracle.js';
import { fetchWithRetry } from '../../packages/core/src/shared/utils/fetchWithRetry.js';

function response(data, status = 200, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        json: vi.fn(async () => data),
    };
}

describe('regression/device-network-resilience', () => {
    it('[REGRESSION P0] coalesces concurrent GETs across one HTTP 429 retry window', async () => {
        let calls = 0;
        const sleeps = [];
        const fetchImpl = vi.fn(async () => {
            calls += 1;
            if (calls === 1) return response({}, 429, { 'Retry-After': '3' });
            return response({ bitcoin: { usd: 65000 } });
        });
        const policy = {
            maxRetries: 1,
            baseDelayMs: 1,
            random: () => 0.5,
            sleep: async (ms) => { sleeps.push(ms); },
        };

        const results = await Promise.all(Array.from(
            { length: 6 },
            () => fetchWithRetry(fetchImpl, 'https://prices.test/simple', {}, policy),
        ));

        expect(results.every((result) => result.status === 200)).toBe(true);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(sleeps).toEqual([3000]);
    });

    it('[REGRESSION P1] returns cached native prices when a refresh provider fails', async () => {
        let time = 0;
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(response({
                dogecoin: {
                    usd: 0.2,
                    usd_market_cap: 100,
                    usd_24h_change: 3,
                },
            }))
            .mockResolvedValueOnce(response({}, 400));
        const oracle = createPriceOracle({ fetch: fetchImpl, now: () => time });
        const request = { chainIds: ['dogecoin-mainnet'] };
        const first = await oracle.getNativePrices(request);

        time = 6 * 60 * 1000;
        const duringFailure = await oracle.getNativePrices(request);

        expect(duringFailure.prices).toEqual(first.prices);
        expect(duringFailure.error).toBe('HTTP 400');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
});
