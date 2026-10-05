// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { sampleOrderbookFor } from '../../../packages/core/src/market/sampleMarketData.js';

function expectSideShape(side) {
    for (const entry of side) {
        expect(entry).toHaveLength(2);
        expect(entry.every((value) => typeof value === 'string')).toBe(true);
        expect(entry[1]).toMatch(/^\d+$/);
        expect(Number(entry[1])).toBeGreaterThanOrEqual(10);
        expect(Number(entry[1])).toBeLessThan(510);
    }
}

describe('sampleOrderbookFor', () => {
    it('returns twelve well-formed bids and asks', () => {
        const { bids, asks } = sampleOrderbookFor('BTC', 'XCP');

        expect(bids).toHaveLength(12);
        expect(asks).toHaveLength(12);
        expectSideShape(bids);
        expectSideShape(asks);
    });

    it('places every ask above every bid', () => {
        const { bids, asks } = sampleOrderbookFor('BTC', 'XCP');
        const highestBid = Math.max(...bids.map(([price]) => Number(price)));
        const lowestAsk = Math.min(...asks.map(([price]) => Number(price)));

        expect(lowestAsk).toBeGreaterThan(highestBid);
    });

    it('returns byte-identical data for the same tick pair', () => {
        const first = JSON.stringify(sampleOrderbookFor('BTC', 'XCP'));
        const second = JSON.stringify(sampleOrderbookFor('BTC', 'XCP'));

        expect(second).toBe(first);
    });

    it('returns different data for a different tick pair', () => {
        const first = sampleOrderbookFor('BTC', 'XCP');
        const second = sampleOrderbookFor('ETH', 'XCP');

        expect(second).not.toEqual(first);
    });
});
