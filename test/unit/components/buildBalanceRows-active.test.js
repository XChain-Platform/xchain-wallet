// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: buildBalanceRows active-address scoping. Without activeByChain it
// sums every address (legacy aggregate); with it, the chain's row reflects
// only the active address's native + token balances.

import { describe, it, expect } from 'vitest';
import { buildBalanceRows } from '../../../packages/core/src/shared/components/BalanceList.jsx';

const chainRegistry = {
    get: (chainId) => (chainId === 'bitcoin-regtest'
        ? { id: 'bitcoin-regtest', coin: 'bitcoin', displayName: 'Bitcoin' }
        : null),
};

// Two addresses on one chain: A holds 100 sats native + 5 FOO; B holds 50.
const balances = {
    'bitcoin-regtest': [
        {
            address: 'addr_A',
            balances: {
                native: { quantity: '100', divisibility: 8, tick: 'BTC' },
                tokens: [{ tick: 'FOO', quantity: '5', divisibility: 0 }],
            },
        },
        {
            address: 'addr_B',
            balances: { native: { quantity: '50', divisibility: 8, tick: 'BTC' }, tokens: [] },
        },
    ],
};

describe('buildBalanceRows active-address scoping', () => {
    it('aggregates across all addresses when activeByChain is omitted', () => {
        const rows = buildBalanceRows(balances, chainRegistry);
        const native = rows.find((r) => r.kind === 'native');
        expect(native.quantity).toBe('150');
    });

    it('reflects only the active address when activeByChain is supplied', () => {
        const rows = buildBalanceRows(balances, chainRegistry, {
            'bitcoin-regtest': { address: 'addr_A' },
        });
        const native = rows.find((r) => r.kind === 'native');
        expect(native.quantity).toBe('100');
        const foo = rows.find((r) => r.tick === 'FOO');
        expect(foo?.quantity).toBe('5');
    });

    it('excludes the non-active address tokens', () => {
        const rows = buildBalanceRows(balances, chainRegistry, {
            'bitcoin-regtest': { address: 'addr_B' },
        });
        const native = rows.find((r) => r.kind === 'native');
        expect(native.quantity).toBe('50');
        expect(rows.find((r) => r.tick === 'FOO')).toBeUndefined();
    });
});
