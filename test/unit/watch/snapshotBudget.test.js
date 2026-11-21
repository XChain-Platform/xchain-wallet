// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fitSnapshotBudget } from '../../../packages/core/src/watch/buildWatchSnapshot.js';

const jsonBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;

function snapshotWith(rows) {
    return {
        v: 1,
        builtAt: 1_795_200_000_000,
        rows,
        capped: false,
        receive: [{ chainId: 'bitcoin', address: 'bc1qexample' }],
        settings: { enabled: true, showTotal: false },
    };
}

describe('fitSnapshotBudget', () => {
    it('drops ASCII rows from the tail until the serialized snapshot fits', () => {
        const input = snapshotWith([
            { id: 'first', displayName: 'Bitcoin', amountText: '1 BTC' },
            { id: 'second', displayName: 'Dogecoin', amountText: '2 DOGE' },
            { id: 'third', displayName: 'Pepecoin', amountText: '3 PEP' },
        ]);
        const expected = { ...input, rows: input.rows.slice(0, 2), capped: true };
        const result = fitSnapshotBudget(input, jsonBytes(expected));

        expect(result).toEqual(expected);
        expect(jsonBytes(result)).toBeLessThanOrEqual(jsonBytes(expected));
    });

    it('measures multi-byte display names as UTF-8 bytes', () => {
        const input = snapshotWith([
            { id: 'first', displayName: 'Bitcoin', amountText: '1 BTC' },
            { id: 'second', displayName: '東京市場🚀'.repeat(8), amountText: '2 TOK' },
        ]);
        const characterLengthBudget = JSON.stringify(input).length;

        expect(jsonBytes(input)).toBeGreaterThan(characterLengthBudget);
        const result = fitSnapshotBudget(input, characterLengthBudget);
        expect(result.rows).toEqual([input.rows[0]]);
        expect(result.capped).toBe(true);
        expect(jsonBytes(result)).toBeLessThanOrEqual(characterLengthBudget);
    });

    it('returns a new unmodified snapshot when it is already within budget', () => {
        const input = snapshotWith([
            { id: 'first', displayName: 'Bitcoin', amountText: '1 BTC' },
        ]);
        const result = fitSnapshotBudget(input, jsonBytes(input));

        expect(result).toEqual(input);
        expect(result).not.toBe(input);
        expect(result.rows).not.toBe(input.rows);
        expect(result.receive).toBe(input.receive);
        expect(result.settings).toBe(input.settings);
        expect(result.capped).toBe(false);
    });

    it('leaves fixed blocks unchanged when they exceed the budget without rows', () => {
        const input = snapshotWith([]);
        const budget = jsonBytes(input) - 1;
        const result = fitSnapshotBudget(input, budget);

        expect(result).toEqual(input);
        expect(result).not.toBe(input);
        expect(result.rows).not.toBe(input.rows);
        expect(result.capped).toBe(false);
        expect(jsonBytes(result)).toBeGreaterThan(budget);
    });

    it('does not mutate its input while dropping rows', () => {
        const rows = Object.freeze([
            Object.freeze({ id: 'first', displayName: 'Bitcoin', amountText: '1 BTC' }),
            Object.freeze({ id: 'second', displayName: 'Dogecoin', amountText: '2 DOGE' }),
        ]);
        const input = Object.freeze(snapshotWith(rows));
        const before = JSON.stringify(input);

        const result = fitSnapshotBudget(input, jsonBytes({
            ...input,
            rows: [rows[0]],
            capped: true,
        }));

        expect(result.rows).toEqual([rows[0]]);
        expect(JSON.stringify(input)).toBe(before);
        expect(input.rows).toHaveLength(2);
        expect(input.capped).toBe(false);
    });
});
