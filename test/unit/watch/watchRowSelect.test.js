// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { selectWatchRows } from '../../../packages/core/src/watch/buildWatchRows.js';

function row(tick, overrides = {}) {
    return {
        chainId: 'bitcoin-mainnet',
        tick,
        kind: 'token',
        quantity: '100000000',
        divisibility: 8,
        fiatRate: 1,
        ...overrides,
    };
}

describe('selectWatchRows', () => {
    it('keeps only pinned rows in input order without mutating the input', () => {
        const rows = [
            row('A', { quantity: '1' }),
            row('B', { quantity: '1' }),
            row('C', { quantity: '1' }),
        ];
        const original = structuredClone(rows);

        expect(selectWatchRows(rows, {
            pinnedOnly: true,
            pinnedKeys: new Set(['bitcoin-mainnet:C', 'bitcoin-mainnet:A']),
            hideSmallBalances: true,
            smallBalanceFiat: '1',
        })).toEqual({ rows: [rows[0], rows[2]], capped: false });
        expect(rows).toEqual(original);
    });

    it('drops a small row when small balances are hidden', () => {
        const small = row('SMALL', { quantity: '1' });
        const large = row('LARGE');

        expect(selectWatchRows([small, large], {
            hideSmallBalances: true,
            smallBalanceFiat: '1',
        })).toEqual({ rows: [large], capped: false });
    });

    it('keeps a pinned small row', () => {
        const small = row('SMALL', { quantity: '1' });

        expect(selectWatchRows([small], {
            hideSmallBalances: true,
            smallBalanceFiat: '1',
            pinnedKeys: new Set(['bitcoin-mainnet:SMALL']),
        })).toEqual({ rows: [small], capped: false });
    });

    it('keeps an unavailable row', () => {
        const unavailable = row('OFFLINE', { quantity: '0', unavailable: 'all' });

        expect(selectWatchRows([unavailable], {
            hideSmallBalances: true,
            smallBalanceFiat: '1',
        })).toEqual({ rows: [unavailable], capped: false });
    });

    it('keeps all 50 rows without reporting a cap', () => {
        const rows = Array.from({ length: 50 }, (_, index) => row(`T${index}`));

        const selected = selectWatchRows(rows, {});

        expect(selected.rows).toEqual(rows);
        expect(selected.rows).not.toBe(rows);
        expect(selected.capped).toBe(false);
    });

    it('keeps the first 50 of 51 rows and reports the cap', () => {
        const rows = Array.from({ length: 51 }, (_, index) => row(`T${index}`));

        expect(selectWatchRows(rows, {})).toEqual({
            rows: rows.slice(0, 50),
            capped: true,
        });
    });
});
