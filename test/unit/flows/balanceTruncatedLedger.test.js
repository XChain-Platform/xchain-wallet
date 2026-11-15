// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The `/balances/` ledger is paged, and the body's `total` counts every row.
// A page that holds fewer rows than `total` leaves the later ticks unread, and
// those must read as unknown rather than as not held.

import { describe, it, expect } from 'vitest';
import { addressBalances } from '../../../packages/core/src/flows/balances.js';

const DESCRIPTORS = [{ id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' }];
const chainRegistry = {
    descriptorFor: (id) => DESCRIPTORS.find((d) => d.id === id) || null,
    chainIdFor: (coin, networkKind) => (
        DESCRIPTORS.find((d) => d.coin === coin && d.networkKind === networkKind)?.id ?? null
    ),
};

const ROWS = [
    { tick: 'AAA', amount: '5', decimals: 0 },
    { tick: 'BBB', amount: '7', decimals: 0 },
];

function sdkReturning(ledger) {
    return {
        get: () => ({
            getAddress: async () => ({ balances: { confirmed: '1.00000000' } }),
            getBalances: async () => ledger,
        }),
    };
}

const read = (ledger) => addressBalances({
    sdkRegistry: sdkReturning(ledger), chainRegistry, chainId: 'bitcoin-regtest', address: 'n2XDwu',
});

describe('a token ledger page shorter than its total', () => {
    it('marks the token half unavailable and keeps the rows it did read', async () => {
        const shape = await read({ total: 501, data: ROWS });
        expect(shape.unavailable).toContain('tokens');
        expect(shape.unavailableReason).toMatch(/only part of the token list/);
        expect(shape.tokens.map((t) => t.tick)).toEqual(['AAA', 'BBB']);
        expect(shape.native).toBeTruthy();
    });

    it('does not mark a complete page, whether total is a number or a string', async () => {
        for (const total of [2, '2', 0, null, undefined, 'x']) {
            const shape = await read({ total, data: ROWS });
            expect(shape.unavailable, `total ${String(total)}`).toBeUndefined();
        }
    });

    it('does not mark an empty ledger whose total is zero', async () => {
        const shape = await read({ total: 0, data: [] });
        expect(shape.unavailable).toBeUndefined();
        expect(shape.tokens).toEqual([]);
    });
});
