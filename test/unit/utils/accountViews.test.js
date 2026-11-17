// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G131: one account per account number across networks, with Networks,
// Accounts and Addresses as separate views over the same entries.

import { describe, expect, it } from 'vitest';
import {
    accountAddressRows,
    accountRowsByIndex,
    addressRows,
    indexesMissingChain,
    selectedAccountEntries,
} from '../../../packages/core/src/shared/utils/accountViews.js';

const CHAINS = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const entry = (chainId, accountIndex) => ({ chainId, accountIndex, address: `${chainId}-${accountIndex}` });
const twoAccounts = [
    ...CHAINS.map((id) => entry(id, 0)),
    ...CHAINS.map((id) => entry(id, 1)),
];

describe('accountRowsByIndex', () => {
    it('gives one row per account number, never one per network', () => {
        const rows = accountRowsByIndex({ indexes: [0, 1], addresses: twoAccounts, enabledChainIds: CHAINS });
        expect(rows).toEqual([
            { index: 0, addressCount: 3, networkCount: 3 },
            { index: 1, addressCount: 3, networkCount: 3 },
        ]);
    });

    it('counts only the networks that are on', () => {
        const rows = accountRowsByIndex({ indexes: [0, 1], addresses: twoAccounts, enabledChainIds: ['bitcoin-mainnet'] });
        expect(rows).toEqual([
            { index: 0, addressCount: 1, networkCount: 1 },
            { index: 1, addressCount: 1, networkCount: 1 },
        ]);
    });

    it('keeps an account asked for before any address is read, at zero', () => {
        const rows = accountRowsByIndex({ indexes: [1, 0, 1], addresses: CHAINS.map((id) => entry(id, 0)), enabledChainIds: CHAINS });
        expect(rows.map((r) => [r.index, r.addressCount])).toEqual([[0, 3], [1, 0]]);
    });
});

describe('addressRows', () => {
    it('flattens by network, then account number in the enabled order', () => {
        const rows = addressRows({ indexes: [1, 0], addresses: twoAccounts, enabledChainIds: ['dogecoin-mainnet', 'bitcoin-mainnet'] });
        expect(rows.map((row) => [row.chainId, row.accountIndex])).toEqual([
            ['dogecoin-mainnet', 0],
            ['dogecoin-mainnet', 1],
            ['bitcoin-mainnet', 0],
            ['bitcoin-mainnet', 1],
        ]);
    });

    it('leaves out an account that is off and one with nothing read', () => {
        const rows = addressRows({ indexes: [0, 1, 2], addresses: twoAccounts, enabledChainIds: CHAINS, offIndexes: [0] });
        expect(new Set(rows.map((row) => row.accountIndex))).toEqual(new Set([1]));
    });
});

describe('selectedAccountEntries', () => {
    it('saves every address on a network that is on, for an account that is on', () => {
        const saved = selectedAccountEntries({ addresses: twoAccounts, enabledChainIds: ['bitcoin-mainnet', 'litecoin-mainnet'], offIndexes: [1] });
        expect(saved).toEqual([entry('bitcoin-mainnet', 0), entry('litecoin-mainnet', 0)]);
    });
});

describe('indexesMissingChain', () => {
    it('names the account numbers a network turned on still has to read', () => {
        const addresses = [entry('bitcoin-mainnet', 0), entry('bitcoin-mainnet', 1), entry('litecoin-mainnet', 0)];
        expect(indexesMissingChain({ chainId: 'litecoin-mainnet', indexes: [0, 1, 2], addresses })).toEqual([1, 2]);
        expect(indexesMissingChain({ chainId: 'bitcoin-mainnet', indexes: [0, 1], addresses })).toEqual([]);
    });
});

describe('accountAddressRows', () => {
    it('flattens one account\'s addresses in the given network order and path order', () => {
        const byChain = {
            'litecoin-mainnet': [{ accountId: 'a1', address: 'L1', derivationPath: "m/84'/2'/0'/0/0" }],
            'bitcoin-mainnet': [
                { accountId: 'a1', address: 'B10', derivationPath: "m/84'/0'/0'/0/10" },
                { accountId: 'a2', address: 'other', derivationPath: "m/84'/0'/1'/0/0" },
                { accountId: 'a1', address: 'B2', derivationPath: "m/84'/0'/0'/0/2" },
            ],
            'dogecoin-mainnet': [{ accountId: 'a2', address: 'D', derivationPath: "m/44'/3'/1'/0/0" }],
        };
        const rows = accountAddressRows(byChain, 'a1', CHAINS);
        expect(rows.map(({ chainId, record }) => [chainId, record.address])).toEqual([
            ['bitcoin-mainnet', 'B2'],
            ['bitcoin-mainnet', 'B10'],
            ['litecoin-mainnet', 'L1'],
        ]);
    });

    it('reads a missing map as no addresses', () => {
        expect(accountAddressRows(null, 'a1')).toEqual([]);
    });
});
