// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// D-75: ManageToken's "You hold" read 0 for every token because it
// parsed a flat row array (or a `rows` / `data` envelope) while
// getWalletBalances resolves to `Record<chainId, entry[]>`. These cases pin
// the shape the call actually returns - the fixtures below are the real
// walletBalances output shape (see flows/balances.js AddressBalancesEntry).

import { describe, it, expect } from 'vitest';
import { sumTickOnChain } from '../../../packages/core/src/shared/utils/walletBalanceShape.js';

const CHAIN = 'bitcoin-regtest';

/** @param {string} address @param {Array<[string, string]>} tokens @param {string} [nativeQty] */
function entry(address, tokens, nativeQty = '0') {
    return {
        address,
        addressType: 'p2pkh',
        derivationPath: "m/0'/0/0",
        label: null,
        error: null,
        balances: {
            native: { tick: 'BTC', divisibility: 8, quantity: nativeQty },
            tokens: tokens.map(([tick, quantity]) => ({ tick, quantity, divisibility: 0 })),
        },
    };
}

describe('sumTickOnChain', () => {
    it('reads the per-chain map getWalletBalances actually returns', () => {
        const byChain = { [CHAIN]: [entry('n2XDwu', [['S18PROBE', '5000']])] };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('5000');
    });

    it('sums a tick spread across several addresses on the chain', () => {
        const byChain = {
            [CHAIN]: [
                entry('addrA', [['S18PROBE', '3000']]),
                entry('addrB', [['S18PROBE', '1500'], ['OTHER', '99']]),
                entry('addrC', [['OTHER', '7']]),
            ],
        };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('4500');
    });

    it('counts each ADDRESS once when two records name it (D-67 rule)', () => {
        const byChain = {
            [CHAIN]: [
                entry('dupAddr', [['S18PROBE', '5000']]),
                entry('dupAddr', [['S18PROBE', '5000']]),
            ],
        };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('5000');
    });

    it('ignores other chains', () => {
        const byChain = {
            [CHAIN]: [entry('addrA', [['S18PROBE', '1000']])],
            'litecoin-regtest': [entry('addrL', [['S18PROBE', '4000']])],
        };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('1000');
    });

    it('matches the ticker case-insensitively', () => {
        const byChain = { [CHAIN]: [entry('addrA', [['S18PROBE', '42']])] };
        expect(sumTickOnChain(byChain, CHAIN, 's18probe')).toBe('42');
    });

    it('resolves the native coin ticker too', () => {
        const byChain = { [CHAIN]: [entry('addrA', [], '397493306')] };
        expect(sumTickOnChain(byChain, CHAIN, 'BTC')).toBe('397493306');
    });

    it('can be scoped to one address', () => {
        const byChain = {
            [CHAIN]: [
                entry('addrA', [['S18PROBE', '3000']]),
                entry('addrB', [['S18PROBE', '1500']]),
            ],
        };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE', { address: 'addrB' })).toBe('1500');
    });

    it('returns 0 for a tick the wallet does not hold', () => {
        const byChain = { [CHAIN]: [entry('addrA', [['OTHER', '5']])] };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('0');
    });

    it('survives missing, empty and malformed input', () => {
        expect(sumTickOnChain(null, CHAIN, 'S18PROBE')).toBe('0');
        expect(sumTickOnChain({}, CHAIN, 'S18PROBE')).toBe('0');
        expect(sumTickOnChain({ [CHAIN]: 'nope' }, CHAIN, 'S18PROBE')).toBe('0');
        expect(sumTickOnChain({ [CHAIN]: [null, { address: 'a' }] }, CHAIN, 'S18PROBE')).toBe('0');
        expect(sumTickOnChain({ [CHAIN]: [entry('a', [['S18PROBE', 'not-a-number']])] }, CHAIN, 'S18PROBE')).toBe('0');
        expect(sumTickOnChain({ [CHAIN]: [entry('a', [['S18PROBE', '5000']])] }, CHAIN, '')).toBe('0');
    });

    it('skips an address whose fetch failed rather than throwing', () => {
        const failed = { address: 'addrFail', balances: null, error: 'boom' };
        const byChain = { [CHAIN]: [failed, entry('addrB', [['S18PROBE', '600']])] };
        expect(sumTickOnChain(byChain, CHAIN, 'S18PROBE')).toBe('600');
    });
});
