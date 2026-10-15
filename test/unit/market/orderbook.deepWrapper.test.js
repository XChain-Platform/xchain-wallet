// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { normalizeOrderbook } from '../../../packages/core/src/market/orderbook.js';

describe('market/orderbook nested explorer wrappers', () => {
    it('recursively unwraps multiple data envelopes', () => {
        const book = normalizeOrderbook({
            data: {
                data: [{
                    bids: [['2', '1.25']],
                    asks: [['3', '1.25']],
                }],
            },
        });

        expect(book.bids[0].cumulative).toBe('1.25');
        expect(book.asks[0].cumulative).toBe('1.25');
        expect(book.maxCumulative).toBe('1.25');
    });
});
