// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    sampleMatchesFor,
    sampleOrderbookFor,
} from '../../../packages/core/src/market/sampleMarketData.js';

describe('market/sampleMarketData bounded generation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    // A pinned generator hashes every pair to the 1e-7 midpoint, so the bounds
    // the walk is clamped to are 0.4x and 2.2x of that.
    const pricesOf = (rows) => rows.map((r) => (r.give_tick === 'B'
        ? Number(r.give_amount) / Number(r.get_amount)
        : Number(r.get_amount) / Number(r.give_amount)));
    const inBounds = (price) => price >= 0.4e-7 * 0.999 && price <= 2.2e-7 * 1.001;

    it('keeps a walk with its generator pinned low inside the price bounds', () => {
        vi.spyOn(Math, 'imul').mockReturnValue(0);

        const prices = pricesOf(sampleMatchesFor('A', 'B'));

        expect(prices).toHaveLength(80);
        expect(prices.every(inBounds)).toBe(true);
    });

    it('keeps a walk with its generator alternating inside the price bounds', () => {
        let calls = 0;
        const hashMultiplications = 'A::B'.length * 2;
        vi.spyOn(Math, 'imul').mockImplementation(() => {
            calls += 1;
            if (calls <= hashMultiplications) return 0;
            return calls % 2 === 1 ? 0 : -1;
        });

        const prices = pricesOf(sampleMatchesFor('A', 'B'));

        expect(prices).toHaveLength(80);
        expect(prices.every(inBounds)).toBe(true);
    });

    it('renders non-finite generated prices as zero', () => {
        vi.spyOn(Math, 'pow').mockReturnValue(Infinity);

        const book = sampleOrderbookFor('A', 'B');

        expect([...book.bids, ...book.asks].every(([price]) => price === '0')).toBe(true);
    });
});

describe('market/sampleMarketData demo pairs never read as a loss', () => {
    it('closes the last day above where it opened for every pair', async () => {
        const { daySeriesFromMatches } = await import('../../../packages/core/src/shared/routes/MarketsList.jsx');
        // The demo's own sample markets (MarketsList SAMPLE_MARKETS), then a sweep.
        const pairs = [
            'PEPECASH', 'XCP', 'RAREPEPE', 'BITCRYSTAL', 'LTBCOIN', 'MEMECASH', 'WAVEY', 'TOKENLY',
            'PEPECREATURE', 'COIN',
        ].map((tick) => [tick, 'BTC']).concat([
            ['LTBPLUS', 'LTC'], ['PEPELITE', 'LTC'], ['LITECASH', 'LTC'],
            ['DOGEFREN', 'DOGE'], ['WOWTOKEN', 'DOGE'], ['SHIBOGECOIN', 'DOGE'],
        ]);
        for (const base of ['BTC', 'LTC', 'DOGE', 'XCP']) {
            for (let i = 0; i < 300; i += 1) pairs.push([`TICK${i}`, base]);
        }
        const failures = [];
        for (const [tick1, tick2] of pairs) {
            const day = daySeriesFromMatches(sampleMatchesFor(tick1, tick2), tick1, tick2);
            if (!day || !(day.at(-1) > day[0])) failures.push(`${tick1}/${tick2} day`);
        }
        expect(failures.slice(0, 5)).toEqual([]);
        expect(failures).toHaveLength(0);
    });
});
