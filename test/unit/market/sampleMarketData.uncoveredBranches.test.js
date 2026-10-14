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

    it('clamps a sustained downward walk to the lower price bound', () => {
        vi.spyOn(Math, 'imul').mockReturnValue(0);

        const rows = sampleMatchesFor('A', 'B');

        expect(rows.some(({ get_amount: amount }) => amount === '0.0000004000')).toBe(true);
    });

    it('clamps a sustained upward walk to the upper price bound', () => {
        let calls = 0;
        const hashMultiplications = 'A::B'.length * 2;
        vi.spyOn(Math, 'imul').mockImplementation(() => {
            calls += 1;
            if (calls <= hashMultiplications) return 0;
            return calls % 2 === 1 ? 0 : -1;
        });

        const rows = sampleMatchesFor('A', 'B');

        expect(rows.some(({ give_amount: amount }) => amount === '0.0001119800')).toBe(true);
    });

    it('renders non-finite generated prices as zero', () => {
        vi.spyOn(Math, 'pow').mockReturnValue(Infinity);

        const book = sampleOrderbookFor('A', 'B');

        expect([...book.bids, ...book.asks].every(([price]) => price === '0')).toBe(true);
    });
});
