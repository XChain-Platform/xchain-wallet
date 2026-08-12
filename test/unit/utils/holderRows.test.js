// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-76: ManageToken accepted only a bare array from
// getHoldersForToken, but the explorer answers with an envelope
// (`{ tick, supply, total, data: [...] }`), so every token showed
// "Holders 0" / "No holders yet" - including one whose only holder was the
// wallet's own address. The first case is that exact live payload.

import { describe, it, expect } from 'vitest';
import { extractHolderRows } from '../../../packages/core/src/shared/utils/holderRows.js';

describe('extractHolderRows', () => {
    it('unwraps the explorer envelope /RBTC/api/holders/<tick> returns', () => {
        const live = {
            coin_price: '0',
            data: [{ address: 'n2XDwuR1qYxWptiebLzZSZZaoYsZR2CXK6', amount: '5000' }],
            decimals: 0,
            supply: '5000',
            tick: 'S18PROBE',
            total: 1,
        };
        expect(extractHolderRows(live)).toHaveLength(1);
        expect(extractHolderRows(live)[0].amount).toBe('5000');
    });

    it('passes a bare array straight through', () => {
        const rows = [{ address: 'a', amount: '1' }];
        expect(extractHolderRows(rows)).toBe(rows);
    });

    it('accepts the rows and holders envelopes too', () => {
        expect(extractHolderRows({ rows: [{ address: 'a' }] })).toHaveLength(1);
        expect(extractHolderRows({ holders: [{ address: 'a' }, { address: 'b' }] })).toHaveLength(2);
    });

    it('returns [] for empty, missing or unrecognized shapes', () => {
        expect(extractHolderRows(null)).toEqual([]);
        expect(extractHolderRows(undefined)).toEqual([]);
        expect(extractHolderRows({})).toEqual([]);
        expect(extractHolderRows({ data: 'nope' })).toEqual([]);
        expect(extractHolderRows({ error: 'TICK_NOT_FOUND' })).toEqual([]);
    });
});
