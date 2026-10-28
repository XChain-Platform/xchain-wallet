// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A market list hydrates each row's lifecycle state with one detail read per
// row. Hundreds of reads at once meet the explorer's rate limit, and a
// failed read shows the row stale, so the reads run a few at a time.

import { describe, expect, it, vi } from 'vitest';
import { withMarketExpiry } from '../../../packages/core/src/flows/marketExpiry.js';

describe('market lifecycle hydration at scale', () => {
    it('reads a few row details at a time, not every row at once', async () => {
        let inFlight = 0;
        let peak = 0;
        const sdk = {
            explorer: { coin: 'TLTC' },
            getStatus: vi.fn(async () => ({
                last_block: { TLTC: 10 }, chain_tip: { TLTC: 10 }, last_block_time: { TLTC: 1_000 },
            })),
            getAction: vi.fn(async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise((resolve) => { setTimeout(resolve, 1); });
                inFlight -= 1;
                return { state: { status: 'open' } };
            }),
        };
        const rows = Array.from({ length: 300 }, (_, i) => ({ action_index: i + 1 }));

        const response = await withMarketExpiry(sdk, { data: rows, total: 300 }, 'swap', { hydrate: true });

        expect(response.data).toHaveLength(300);
        expect(response.data.every((row) => row.state?.status === 'open')).toBe(true);
        expect(response.data.map((row) => row.action_index)).toEqual(rows.map((row) => row.action_index));
        expect(sdk.getAction).toHaveBeenCalledTimes(300);
        expect(peak).toBeLessThanOrEqual(8);
    });
});
