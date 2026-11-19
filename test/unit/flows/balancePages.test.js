// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An address that holds more token rows than one `/balances/` page serves is
// read through every page before it is shaped, on the per-address path and on
// the batch path, and a walk that cannot finish stays marked unavailable.

import { beforeEach, describe, expect, it } from 'vitest';
import { addressBalances, walletBalances, _resetBatchSupportMemo } from '../../../packages/core/src/flows/balances.js';
import { completeBalancePages, BALANCES_MAX_PAGES } from '../../../packages/core/src/flows/balancePages.js';

const CHAIN_ID = 'bitcoin-regtest';
const ADDRESS = 'bcrt1q4neq4jcky263n30yg42ypehfapef6zycf7qefy';
const DESCRIPTOR = { id: CHAIN_ID, coin: 'bitcoin', networkKind: 'regtest' };
const chainRegistry = {
    descriptorFor: (id) => (id === CHAIN_ID ? DESCRIPTOR : null),
    chainIdFor: (coin, network) => (coin === 'bitcoin' && network === 'regtest' ? CHAIN_ID : null),
    get(id) { return this.descriptorFor(id); },
};
const addressBody = { address: ADDRESS, balances: { confirmed: '1.00000000', pending: '0.00000000' }, tracker_available: true };

const ledger = (count) => Array.from({ length: count }, (_row, i) => ({
    tick: `T${String(i).padStart(5, '0')}`, amount: '1', decimals: 0,
}));

// An explorer stand-in that serves `rows` by page and limit, like the real route.
function pagedSdk(rows, { failPage = null, calls = [] } = {}) {
    return {
        calls,
        getAddress: async () => addressBody,
        getBalances: async (_address, opts = {}) => {
            const limit = opts.limit ?? 500;
            const page = opts.page ?? 1;
            calls.push({ page, limit });
            if (page === failPage) throw new Error('explorer hiccup');
            return { total: rows.length, data: rows.slice((page - 1) * limit, page * limit) };
        },
    };
}

const readOne = (sdk) => addressBalances({
    sdkRegistry: { get: () => sdk }, chainRegistry, chainId: CHAIN_ID, address: ADDRESS,
});

describe('a token ledger longer than one page', () => {
    it('reads every page and reports every tick', async () => {
        const sdk = pagedSdk(ledger(1200));
        const shape = await readOne(sdk);
        expect(shape.unavailable).toBeUndefined();
        expect(shape.tokens).toHaveLength(1200);
        expect(shape.tokens[1199].tick).toBe('T01199');
        expect(sdk.calls).toEqual([{ page: 1, limit: 500 }, { page: 2, limit: 500 }, { page: 3, limit: 500 }]);
    });

    it('stays unavailable, with the rows it read, when a later page fails', async () => {
        const shape = await readOne(pagedSdk(ledger(1200), { failPage: 2 }));
        expect(shape.unavailable).toContain('tokens');
        expect(shape.unavailableReason).toMatch(/only part of the token list/);
        expect(shape.tokens).toHaveLength(500);
    });

    it('does not walk a ledger past the page ceiling', async () => {
        const sdk = pagedSdk(ledger(500 * (BALANCES_MAX_PAGES + 1)));
        const shape = await readOne(sdk);
        expect(shape.unavailable).toContain('tokens');
        expect(sdk.calls).toHaveLength(1);
    });

    it('makes no extra request for a ledger that fits one page', async () => {
        const sdk = pagedSdk(ledger(500));
        const shape = await readOne(sdk);
        expect(shape.unavailable).toBeUndefined();
        expect(sdk.calls).toHaveLength(1);
    });

    it('does not count a row twice when it shifts onto the next page mid-walk', async () => {
        const rows = ledger(600);
        // Every later page starts one row early, as if a row had been removed.
        const sdk = {
            getBalances: async (_a, { page, limit }) => ({
                total: 600, data: rows.slice((page - 1) * limit - 1, page * limit - 1),
            }),
        };
        const first = { total: 600, data: rows.slice(0, 100) };
        const full = await completeBalancePages({ sdk, address: ADDRESS, first, opts: {} });
        expect(full.data).toHaveLength(599);
        expect(new Set(full.data.map((row) => row.tick)).size).toBe(599);
    });
});

describe('the batch route with a ledger longer than its slot', () => {
    beforeEach(() => { _resetBatchSupportMemo(); });

    it('reads the rest of a truncated slot per address and leaves a whole slot alone', async () => {
        const rows = ledger(700);
        const per = pagedSdk(rows);
        const sdk = {
            ...per,
            getBalancesBatch: async () => ({
                [ADDRESS]: { balances: { total: 700, data: rows.slice(0, 500) }, address: addressBody, error: null },
            }),
        };
        const vault = {
            wallets: { get: async () => ({ id: 'w1', importedKeys: [] }), list: async () => [] },
            accounts: { findBy: async () => [{ id: 'acct-1', walletId: 'w1' }], get: async () => ({ id: 'acct-1', walletId: 'w1' }) },
            addresses: { list: async () => [{ id: 'a0', accountId: 'acct-1', chain: 'bitcoin', network: 'regtest', source: 'hd', address: ADDRESS }] },
        };
        const res = await walletBalances({ vault, walletId: 'w1', chainRegistry, sdkRegistry: { get: () => sdk } });
        const entry = res[CHAIN_ID].find((e) => e.address === ADDRESS);
        expect(entry.balances.unavailable).toBeUndefined();
        expect(entry.balances.tokens).toHaveLength(700);
        expect(per.calls).toEqual([{ page: 2, limit: 500 }]);
    });
});
